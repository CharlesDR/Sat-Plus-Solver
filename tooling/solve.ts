/**
 * `pnpm solve`: solves one factory from the command line and prints the plan.
 *
 *   pnpm solve --target "Iron Plate:60" [--target ...] [--import "Iron Ingot:30"]
 *              [--objective resources|scarcity] [--no-alternates] [--exclude <recipe-id>]
 *              [--budget "<node-id>=<count>"] [--model <model.json>] [--json]
 *
 * Items are matched by id or by name (case-insensitive). An import without a
 * rate is unlimited. `--budget` overrides the map pool for one node class.
 * The model is data/generated/model.json, built in memory when it is missing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Model } from '@sps/data';
import {
  createHighsBackend,
  solve,
  type ImportCap,
  type ItemRate,
  type LpBackend,
  type ObjectiveId,
  type SolveRequest,
  type SolveResult,
} from '@sps/solver';
import { ROOT, runPipeline } from './build-data';

export const USAGE = `Usage: pnpm solve --target "Item:rate" [--target ...] [--import "Item[:cap]"]
                  [--objective resources|scarcity] [--no-alternates] [--exclude <recipe-id>]
                  [--budget "<node-id>=<count>"] [--model <model.json>] [--json]`;

export class CliError extends Error {}

const OBJECTIVES: Record<string, ObjectiveId> = {
  resources: 'resources',
  o1: 'resources',
  scarcity: 'scarcity',
  o2: 'scarcity',
};

export interface CliArgs {
  request: SolveRequest;
  json: boolean;
  modelPath?: string;
}

/** Parses argv (without node and the script) into a request against `model`. */
export function parseCli(argv: string[], model: Model): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        target: { type: 'string', multiple: true, short: 't' },
        import: { type: 'string', multiple: true, short: 'i' },
        objective: { type: 'string', short: 'o' },
        'no-alternates': { type: 'boolean' },
        exclude: { type: 'string', multiple: true },
        budget: { type: 'string', multiple: true },
        model: { type: 'string' },
        json: { type: 'boolean' },
      },
      allowPositionals: false,
    }).values;
  } catch (e) {
    throw new CliError((e as Error).message);
  }
  const item = itemResolver(model);
  const targets: ItemRate[] = (parsed.target ?? []).map((t) => {
    const [name, rate] = splitLast(t, ':');
    if (rate === undefined)
      throw new CliError(`--target "${t}" needs a rate, like "Iron Plate:60".`);
    return { item: item(name), rate: number(rate, `--target "${t}"`) };
  });
  if (!targets.length) throw new CliError('At least one --target is required.');
  const imports: ImportCap[] = (parsed.import ?? []).map((t) => {
    const [name, cap] = splitLast(t, ':');
    const known = tryItem(model, t);
    if (known) return { item: known, cap: Infinity };
    return { item: item(name), cap: cap === undefined ? Infinity : number(cap, `--import "${t}"`) };
  });
  let objective: ObjectiveId = 'resources';
  if (parsed.objective !== undefined) {
    const o = OBJECTIVES[parsed.objective.toLowerCase()];
    if (!o)
      throw new CliError(`Unknown --objective "${parsed.objective}" (resources or scarcity).`);
    objective = o;
  }
  const recipeIds = new Set(model.recipes.map((r) => r.id));
  for (const id of parsed.exclude ?? [])
    if (!recipeIds.has(id)) throw new CliError(`Unknown recipe id "${id}" in --exclude.`);
  let nodeBudget: SolveRequest['nodeBudget'] = 'pool';
  if (parsed.budget?.length) {
    const caps: Record<string, number> = Object.fromEntries(
      model.nodes.map((n) => [n.id, n.count]),
    );
    for (const b of parsed.budget) {
      const [node, count] = splitLast(b, '=');
      if (count === undefined || !(node in caps))
        throw new CliError(`--budget "${b}" must be "<node-id>=<count>" with a known node id.`);
      caps[node] = number(count, `--budget "${b}"`);
    }
    nodeBudget = caps;
  }
  return {
    request: {
      targets,
      objective,
      nodeBudget,
      ...(imports.length ? { imports } : {}),
      recipes: { alternates: !parsed['no-alternates'], exclude: parsed.exclude ?? [] },
    },
    json: parsed.json ?? false,
    ...(parsed.model !== undefined ? { modelPath: parsed.model } : {}),
  };
}

function splitLast(s: string, sep: string): [string, string | undefined] {
  const k = s.lastIndexOf(sep);
  return k < 0 ? [s.trim(), undefined] : [s.slice(0, k).trim(), s.slice(k + 1).trim()];
}

function number(s: string, where: string): number {
  if (/^(inf|infinity|unlimited)$/i.test(s)) return Infinity;
  const n = Number(s);
  if (s === '' || !Number.isFinite(n) || n < 0)
    throw new CliError(`${where}: "${s}" is not a rate ≥ 0.`);
  return n;
}

function tryItem(model: Model, s: string): string | undefined {
  const q = s.trim().toLowerCase();
  return model.items.find((i) => i.id === q || i.name.toLowerCase() === q)?.id;
}

function itemResolver(model: Model): (name: string) => string {
  return (name) => {
    const id = tryItem(model, name);
    if (id) return id;
    const q = name.toLowerCase();
    const near = model.items
      .filter((i) => i.name.toLowerCase().includes(q))
      .map((i) => i.name)
      .sort()
      .slice(0, 5);
    throw new CliError(
      `Unknown item "${name}".` + (near.length ? ` Did you mean: ${near.join(', ')}?` : ''),
    );
  };
}

const fmt = (n: number) => {
  if (!Number.isFinite(n)) return String(n);
  if (n !== 0 && Math.abs(n) < 0.001) return n.toPrecision(3);
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Text table; the first `textColumns` columns are left-aligned, the rest (numbers) right-aligned. */
function table(head: string[], rows: string[][], textColumns = 1): string {
  const width = head.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c]!.length)));
  const line = (r: string[]) =>
    r
      .map((v, c) => (c < textColumns ? v.padEnd(width[c]!) : v.padStart(width[c]!)))
      .join('  ')
      .trimEnd();
  return [line(head), width.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

/** Renders a result as the plain-text plan table. */
export function renderPlan(model: Model, result: SolveResult): string {
  const item = new Map(model.items.map((i) => [i.id, i.name]));
  const machine = new Map(model.machines.map((m) => [m.id, m.name]));
  const node = new Map(model.nodes.map((n) => [n.id, n]));
  const name = (id: string) => item.get(id) ?? id;
  const out: string[] = [];
  out.push(
    `Status: ${result.status}    Objective: ${result.objective}` +
      (result.objectiveValue !== undefined ? ` = ${fmt(result.objectiveValue)}` : ''),
  );
  for (const d of result.diagnostics) out.push(`${d.severity}: ${d.message}`);
  if (result.status !== 'ok') return out.join('\n') + '\n';

  out.push('', 'Recipes');
  out.push(
    table(
      ['Recipe', 'Machine', 'Count', 'Build', 'MW'],
      result.recipes.map((r) => [
        r.name,
        machine.get(r.machine) ?? r.machine,
        fmt(r.machines),
        String(r.machinesCeil),
        fmt(r.powerMW),
      ]),
      2,
    ),
  );
  const flows = (title: string, rows: ItemRate[]) => {
    if (!rows.length) return;
    out.push(
      '',
      title,
      table(
        ['Item', 'Per min'],
        rows.map((r) => [name(r.item), fmt(r.rate)]),
      ),
    );
  };
  flows(
    'Targets',
    result.items.filter((i) => i.demand > 0).map((i) => ({ item: i.item, rate: i.demand })),
  );
  flows('Imports', result.imports);
  flows('Surplus and byproducts', result.surplus);
  if (result.nodes.length) {
    out.push(
      '',
      'Nodes',
      table(
        ['Node', 'Used', 'Budget', 'NNE'],
        result.nodes.map((n) => {
          const meta = node.get(n.node);
          const label = meta ? `${name(meta.resource)} (${meta.purity})` : n.node;
          return [label, fmt(n.used), fmt(n.budget), fmt(n.nne)];
        }),
      ),
    );
  }
  const p = result.power;
  out.push(
    '',
    `Power: ${fmt(p.consumptionMW)} MW draw, ${fmt(p.generationMW)} MW generated, net ${fmt(p.netMW)} MW`,
  );
  return out.join('\n') + '\n';
}

export function loadModel(path?: string): Promise<Model> | Model {
  const file = path ?? join(ROOT, 'data', 'generated', 'model.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Model;
  if (path) throw new CliError(`Model file not found: ${path}`);
  process.stderr.write('data/generated/model.json is missing; building the model in memory…\n');
  return runPipeline().then(({ result }) => {
    if (!result.model)
      throw new CliError('The data build failed. Run `pnpm build:data` for details.');
    return result.model;
  });
}

/** Runs the CLI and returns its exit code and output, so tests can drive it. */
export async function runCli(
  argv: string[],
  backend: LpBackend = createHighsBackend(),
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const modelArg = argv.findIndex((a) => a === '--model');
    const model = await loadModel(modelArg >= 0 ? argv[modelArg + 1] : undefined);
    const args = parseCli(argv, model);
    const result = await solve(model, args.request, backend);
    const stdout = args.json ? JSON.stringify(result, null, 2) + '\n' : renderPlan(model, result);
    return { code: result.status === 'ok' ? 0 : 1, stdout, stderr: '' };
  } catch (e) {
    if (e instanceof CliError) return { code: 2, stdout: '', stderr: `${e.message}\n\n${USAGE}\n` };
    throw e;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2).filter((a, k) => !(k === 0 && a === '--'));
  const { code, stdout, stderr } = await runCli(argv);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exit(code);
}
