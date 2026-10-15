/**
 * `pnpm world solve <world>`: resolves a world (docs/ARCHITECTURE.md §4) from
 * the command line exactly as the site does and prints its factory, link,
 * item-ledger, power and node tables.
 *
 *   pnpm world solve <world.json | share link | -> [--model <model.json>] [--json | --summary]
 *
 * The world is a saved `World` file (any version; it is migrated first), a
 * live-site share link (`…#w=<payload>`, quoted in the shell), or `-` for
 * either on stdin. `--summary` prints only targets, byproducts, raw inputs
 * and power. The model is data/generated/model.json, built in memory when it
 * is missing.
 */
import { readFileSync } from 'node:fs';
import { decompressFromEncodedURIComponent } from 'lz-string';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MW_ITEM_ID, type Model } from '@sps/data';
import { createHighsBackend, formatRate, solve, type LpBackend } from '@sps/solver';
import {
  WorldMigrationError,
  migrateWorld,
  resolveWorld,
  type World,
  type WorldResult,
} from '@sps/world';
import { CliError, loadModel } from './solve';

export const USAGE = `Usage: pnpm world solve <world.json | share link | -> [--model <model.json>] [--json | --summary]`;

const fmt = formatRate;

/** Text table; the first `textColumns` columns are left-aligned, the rest right-aligned. */
function table(head: string[], rows: string[][], textColumns = 1): string {
  const width = head.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c]!.length)));
  const line = (r: string[]) =>
    r
      .map((v, c) => (c < textColumns ? v.padEnd(width[c]!) : v.padStart(width[c]!)))
      .join('  ')
      .trimEnd();
  return [line(head), width.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

/** Renders a resolved world as plain-text tables. */
export function renderWorld(model: Model, world: World, result: WorldResult): string {
  const itemName = new Map(model.items.map((i) => [i.id, i.name]));
  const item = (id: string) => itemName.get(id) ?? id;
  const factoryName = new Map(world.factories.map((f) => [f.id, f.name]));
  const factory = (id: string) => factoryName.get(id) ?? id;
  const groupName = new Map(world.groups.map((g) => [g.id, g.name]));
  const out: string[] = [];

  out.push(
    'Factories',
    table(
      ['Factory', 'Group', 'Status', 'Targets', 'Draw MW', 'Gen MW', 'Machines', 'Node NNE'],
      result.factories.map((f) => [
        f.name,
        f.groupId !== undefined ? (groupName.get(f.groupId) ?? f.groupId) : '',
        f.status,
        f.request.targets.map((t) => `${item(t.item)} ${fmt(t.rate)}`).join(', '),
        fmt(f.power.consumptionMW),
        fmt(f.power.generationMW),
        String(f.machines),
        fmt(f.result.nodes.reduce((s, n) => s + n.nne, 0)),
      ]),
      4,
    ),
  );

  if (result.links.length)
    out.push(
      '',
      'Links',
      table(
        [
          'Link',
          'From',
          'To',
          'Item',
          'Mode',
          'Requested',
          'Delivered',
          'Used',
          'Short',
          'Transport',
        ],
        result.links.map((l) => [
          l.id,
          factory(l.from),
          factory(l.to),
          item(l.item),
          l.mode,
          fmt(l.requested),
          fmt(l.delivered),
          fmt(l.used),
          fmt(l.short),
          l.transport
            ? `${l.transport.kind}${l.transport.tier !== undefined ? ` Mk${l.transport.tier}` : ''}` +
              (l.carriers !== undefined ? ` ×${l.carriers}` : '')
            : '',
        ]),
        5,
      ),
    );

  out.push(
    '',
    'Item ledger (per min; surplus is available supply, unmet is unassigned imports plus short links)',
    table(
      ['Item', 'Produced', 'Consumed', 'Target', 'Surplus', 'Unmet'],
      result.ledger.map((r) => [
        item(r.item),
        fmt(r.produced),
        fmt(r.consumed),
        fmt(r.target),
        fmt(r.surplus),
        fmt(r.unmet),
      ]),
    ),
  );

  if (result.groups.length)
    out.push(
      '',
      'Groups',
      table(
        ['Group', 'Factories', 'Draw MW', 'Gen MW', 'Machines'],
        result.groups.map((g) => [
          g.name,
          g.factories.map(factory).join(', '),
          fmt(g.power.consumptionMW),
          fmt(g.power.generationMW),
          String(g.machines),
        ]),
        2,
      ),
    );

  const p = result.power;
  out.push(
    '',
    `Power: ${fmt(p.consumptionMW)} MW draw, ${fmt(p.generationMW)} MW generated, net ${fmt(p.netMW)} MW` +
      (p.deficitMW > 0 ? `, deficit ${fmt(p.deficitMW)} MW` : ''),
  );

  const nodes = result.nodePool.filter((n) => n.used > 0);
  if (nodes.length)
    out.push(
      '',
      'Nodes',
      table(
        ['Node', 'Pool', 'Used', 'By factory', 'Over'],
        nodes.map((n) => [
          `${item(n.resource)} (${n.purity})`,
          fmt(n.pool),
          fmt(n.used),
          n.byFactory.map((u) => `${factory(u.factory)} ${fmt(u.used)}`).join(', '),
          n.overAllocated ? 'yes' : '',
        ]),
        1,
      ),
    );

  if (result.diagnostics.length) {
    out.push('');
    for (const d of result.diagnostics) out.push(`${d.severity}: ${d.message}`);
  }
  return out.join('\n') + '\n';
}

/**
 * The compact summary (scenario tooling): world targets, byproducts left over,
 * raw inputs (extraction plus unmet demand) and power, one line per item.
 */
export function renderWorldSummary(model: Model, world: World, result: WorldResult): string {
  const itemName = new Map(model.items.map((i) => [i.id, i.name]));
  const item = (id: string) => itemName.get(id) ?? id;
  const line = (rows: { item: string; rate: number }[]) =>
    rows.length
      ? rows
          .map((r) => `${item(r.item)} ${fmt(r.rate)}`)
          .sort()
          .join(', ')
      : '-';
  const out: string[] = [];
  const failed = result.factories.filter((f) => f.status === 'infeasible').map((f) => f.name);
  out.push(
    `${world.meta.name ?? 'World'}: ${result.factories.length} factories, ${result.machines} machines` +
      (failed.length ? `, failed: ${failed.join(', ')}` : ''),
  );
  out.push(
    `Targets: ${line(result.ledger.filter((r) => r.target > 0).map((r) => ({ item: r.item, rate: r.target })))}`,
  );
  out.push(
    `Byproducts: ${line(result.ledger.filter((r) => r.surplus > 1e-6 && r.item !== MW_ITEM_ID).map((r) => ({ item: r.item, rate: r.surplus })))}`,
  );
  const raw = new Map<string, number>();
  for (const f of result.factories)
    for (const e of f.extraction) raw.set(e.item, (raw.get(e.item) ?? 0) + e.rate);
  out.push(`Raw: ${line([...raw].map(([i, rate]) => ({ item: i, rate })))}`);
  const unmet = result.ledger.filter((r) => r.unmet > 1e-6);
  if (unmet.length) out.push(`Unmet: ${line(unmet.map((r) => ({ item: r.item, rate: r.unmet })))}`);
  const p = result.power;
  out.push(
    `Power: ${fmt(p.consumptionMW)} MW draw, ${fmt(p.generationMW)} MW generated` +
      (p.deficitMW > 0 ? `, deficit ${fmt(p.deficitMW)} MW` : ''),
  );
  for (const d of result.diagnostics) if (d.severity === 'error') out.push(`error: ${d.message}`);
  return out.join('\n') + '\n';
}

/**
 * The world JSON in `source`: a share link (anything with `#w=`), else the
 * text itself when `fromStdin`, else a file path.
 */
export function readWorldSource(source: string, stdin?: string): unknown {
  const text = source === '-' ? (stdin ?? '') : source;
  const at = text.indexOf('#w=');
  if (at >= 0) {
    const json = decompressFromEncodedURIComponent(text.slice(at + 3).trim());
    if (!json) throw new CliError('The share link is damaged or incomplete.');
    return JSON.parse(json);
  }
  return JSON.parse(source === '-' ? text : readFileSync(source, 'utf8'));
}

/** Runs the CLI and returns its exit code and output, so tests can drive it. */
export async function runWorldCli(
  argv: string[],
  backend: LpBackend = createHighsBackend(),
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args: argv,
        options: {
          model: { type: 'string' },
          json: { type: 'boolean' },
          summary: { type: 'boolean' },
        },
        allowPositionals: true,
      });
    } catch (e) {
      throw new CliError((e as Error).message);
    }
    const [command, file, ...extra] = parsed.positionals;
    if (command !== 'solve' || file === undefined || extra.length)
      throw new CliError('Expected `solve <world.json | share link | ->`.');
    let world: World;
    try {
      world = migrateWorld(
        readWorldSource(file, file === '-' ? readFileSync(0, 'utf8') : undefined),
      );
    } catch (e) {
      if (e instanceof WorldMigrationError || e instanceof SyntaxError)
        throw new CliError(`${file}: ${e.message}`);
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new CliError(`World file not found: ${file}`);
      throw e;
    }
    const model = await loadModel(parsed.values.model);
    const stderr =
      world.meta.dataHash && world.meta.dataHash !== model.meta.dataHash
        ? `warning: ${file} was saved against game data ${world.meta.dataHash}; the model is ${model.meta.dataHash}.\n`
        : '';
    const result = await resolveWorld(world, model, (r) => solve(model, r, backend));
    const stdout = parsed.values.json
      ? JSON.stringify(result, (_, v: unknown) => (v === Infinity ? 'Infinity' : v), 2) + '\n'
      : parsed.values.summary
        ? renderWorldSummary(model, world, result)
        : renderWorld(model, world, result);
    const failed = result.diagnostics.some((d) => d.severity === 'error');
    return { code: failed ? 1 : 0, stdout, stderr };
  } catch (e) {
    if (e instanceof CliError) return { code: 2, stdout: '', stderr: `${e.message}\n\n${USAGE}\n` };
    throw e;
  }
}

// Not inside the CLI bundle, where every module shares the bundle's URL.
if (
  !process.env.SPS_CLI_BUNDLE &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  const argv = process.argv.slice(2).filter((a, k) => !(k === 0 && a === '--'));
  const { code, stdout, stderr } = await runWorldCli(argv);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exit(code);
}
