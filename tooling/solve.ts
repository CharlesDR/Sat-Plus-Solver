/**
 * `pnpm solve`: solves one factory from the command line and prints the plan.
 *
 *   pnpm solve --target "Iron Plate:60" [--target ...] [--import "Iron Ingot:30"]
 *              [--objective resources,machines,...] [--tolerance 0.01%] [--whole-machines]
 *              [--cost-imports] [--alternates] [--compare-alternates] [--exclude <recipe-id>]
 *              [--budget "<node-id>=<count>"] [--model <model.json>] [--json]
 *
 * Items are matched by id or by name (case-insensitive). An import without a
 * rate is unlimited. `--budget` overrides the map pool for one node class.
 * `--objective` takes a comma-separated stack (resources, scarcity, machines,
 * power, output, types; or o1–o6), solved in order within `--tolerance`
 * (a percentage). Alternates are off unless `--alternates` is given;
 * `--compare-alternates` solves both ways and lists the alternates that help.
 * The model is data/generated/model.json, built in memory when it is missing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Model } from '@sps/data';
import {
  compareAlternates,
  createHighsBackend,
  formatRate,
  recipeTable,
  solve,
  summarizePlan,
  type AlternatesReport,
  type ImportCap,
  type ItemRate,
  type LpBackend,
  type ObjectiveId,
  type SolveRequest,
  type SolveResult,
  type SummaryFlow,
} from '@sps/solver';
import { ROOT, runPipeline } from './build-data';

export const USAGE = `Usage: pnpm solve --target "Item:rate" [--target ...] [--import "Item[:cap]"]
                  [--objective resources,machines,...] [--tolerance <percent>] [--whole-machines]
                  [--cost-imports] [--alternates] [--compare-alternates] [--exclude <recipe-id>]
                  [--budget "<node-id>=<count>"] [--model <model.json>] [--json]
Objectives: resources (o1), scarcity (o2), machines (o3), power (o4), output (o5), types (o6).`;

export class CliError extends Error {}

const OBJECTIVES: Record<string, ObjectiveId> = {
  resources: 'resources',
  o1: 'resources',
  scarcity: 'scarcity',
  o2: 'scarcity',
  machines: 'machines',
  o3: 'machines',
  power: 'power',
  o4: 'power',
  output: 'output',
  o5: 'output',
  types: 'resourceTypes',
  resourcetypes: 'resourceTypes',
  o6: 'resourceTypes',
};

export interface CliArgs {
  request: SolveRequest;
  json: boolean;
  /** Solve with alternates off and on and report which help. */
  compareAlternates: boolean;
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
        tolerance: { type: 'string' },
        'whole-machines': { type: 'boolean' },
        'cost-imports': { type: 'boolean' },
        alternates: { type: 'boolean' },
        'no-alternates': { type: 'boolean' },
        'compare-alternates': { type: 'boolean' },
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
  let stack: ObjectiveId[] = ['resources'];
  if (parsed.objective !== undefined) {
    stack = parsed.objective.split(',').map((name) => {
      const o = OBJECTIVES[name.trim().toLowerCase()];
      if (!o)
        throw new CliError(
          `Unknown --objective "${name.trim()}" (resources, scarcity, machines, power, output or types).`,
        );
      return o;
    });
  }
  let tolerance: number | undefined;
  if (parsed.tolerance !== undefined) {
    const t = parsed.tolerance.trim().replace(/%$/, '');
    const n = Number(t);
    if (t === '' || !Number.isFinite(n))
      throw new CliError(`--tolerance "${parsed.tolerance}" must be a percentage, like 0.5%.`);
    // Out-of-range values go to the solver, which rejects them with its own message.
    tolerance = n / 100;
  }
  if (parsed.alternates && parsed['no-alternates'])
    throw new CliError('--alternates and --no-alternates contradict each other.');
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
      ...(stack.length === 1 ? { objective: stack[0]! } : { objectives: stack }),
      ...(tolerance !== undefined ? { tolerance } : {}),
      ...(parsed['whole-machines'] ? { wholeMachines: true } : {}),
      ...(parsed['cost-imports'] ? { costImports: true } : {}),
      nodeBudget,
      ...(imports.length ? { imports } : {}),
      recipes: { alternates: parsed.alternates ?? false, exclude: parsed.exclude ?? [] },
    },
    json: parsed.json ?? false,
    compareAlternates: parsed['compare-alternates'] ?? false,
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

const fmt = formatRate;

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

/** Renders a result as the plain-text plan table (rows from the shared `summarizePlan`). */
export function renderPlan(model: Model, result: SolveResult): string {
  const plan = summarizePlan(model, result);
  const out: string[] = [];
  if (result.objectives.length > 1) {
    out.push(`Status: ${plan.status}    Objectives: ${result.objectives.join(' > ')}`);
    for (const s of result.stages)
      out.push(
        `  ${s.objective} = ${fmt(s.value)} (optimum ${fmt(s.optimum)}` +
          (s.gap ? `, gap ${fmt(s.gap * 100)}%` : '') +
          ')',
      );
  } else
    out.push(
      `Status: ${plan.status}    Objective: ${plan.objective}` +
        (plan.objectiveValue !== undefined ? ` = ${fmt(plan.objectiveValue)}` : ''),
    );
  for (const d of plan.diagnostics) out.push(`${d.severity}: ${d.message}`);
  if (plan.status !== 'ok') return out.join('\n') + '\n';
  if (result.outputScale !== undefined)
    out.push(`Output scale: ${fmt(result.outputScale)} × the targets`);

  out.push('', 'Recipes');
  const recipes = recipeTable(plan);
  out.push(table(recipes.head, recipes.rows, 2));
  const flows = (title: string, rows: SummaryFlow[]) => {
    if (!rows.length) return;
    out.push(
      '',
      title,
      table(
        ['Item', 'Per min'],
        rows.map((r) => [r.name, fmt(r.rate)]),
      ),
    );
  };
  flows('Targets', plan.targets);
  flows('Imports', plan.imports);
  if (result.importCosts?.length) {
    const item = new Map(model.items.map((i) => [i.id, i.name]));
    const name = (id: string) => item.get(id) ?? id;
    const objectives = result.objectives.filter((o) => o !== 'output' && o !== 'resourceTypes');
    out.push(
      '',
      'Import costs (per 1/min at the imported rate, standalone plan)',
      table(
        ['Item', 'Resource types', 'At /min', ...objectives],
        result.importCosts.map((c) => [
          name(c.item),
          c.resourceTypes.map(name).join(', '),
          fmt(c.rate),
          ...objectives.map((o) => fmt(c.cost[o] ?? 0)),
        ]),
        2,
      ),
    );
  }
  flows('Surplus and byproducts', plan.byproducts);
  if (plan.nodes.length) {
    out.push(
      '',
      'Nodes',
      table(
        ['Node', 'Used', 'Budget', 'NNE'],
        plan.nodes.map((n) => [n.label, fmt(n.used), fmt(n.budget), fmt(n.nne)]),
      ),
    );
  }
  const p = plan.power;
  out.push(
    '',
    `Power: ${fmt(p.consumptionMW)} MW draw, ${fmt(p.generationMW)} MW generated, net ${fmt(p.netMW)} MW`,
  );
  return out.join('\n') + '\n';
}

/** Renders the alternates report: the alternates that help, then the plan that uses them. */
export function renderAlternates(model: Model, report: AlternatesReport): string {
  const recipe = new Map(model.recipes.map((r) => [r.id, r.name]));
  const out: string[] = [];
  if (report.without.status !== 'ok' && report.with.status === 'ok')
    out.push('Without alternates the request does not solve; with them it does.');
  out.push(
    report.used.length
      ? `Alternates that help: ${report.used.map((id) => recipe.get(id) ?? id).join(', ')}`
      : 'No alternate improves this plan.',
  );
  if (report.stages.length)
    out.push(
      '',
      table(
        ['Objective', 'Without', 'With'],
        report.stages.map((s) => [s.objective, fmt(s.without), fmt(s.with)]),
      ),
    );
  out.push('', 'Plan with alternates', renderPlan(model, report.with).trimEnd());
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
    if (args.compareAlternates) {
      const report = await compareAlternates(model, args.request, backend);
      const stdout = args.json
        ? JSON.stringify(report, null, 2) + '\n'
        : renderAlternates(model, report);
      return { code: report.with.status === 'ok' ? 0 : 1, stdout, stderr: '' };
    }
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
