/**
 * Build marks (docs/ARCHITECTURE.md §4.8, A44): "Mark as built" stores a
 * factory's plan as it stands in the game, and every resolution checks the
 * mark against today's world. Each deficit is its own flag; the check is
 * arithmetic only (the built plan is run as a manual plan, §4.7). Pure: the
 * time of marking is passed in.
 */
import type { Model } from '@sps/data';
import type { ImportCap, ItemRate, SolveRequest, SolveResult } from '@sps/solver';
import type { BuiltSnapshot, Factory, ManualEntry, World } from './document';
import { WorldEditError } from './editing';
import { hashString, stableStringify } from './hash';
import { manualOutcome } from './manual';
import type {
  BuildCause,
  BuildCheck,
  BuildFlag,
  FactoryResult,
  LedgerRow,
  RecipeChange,
} from './types';

/** What each build flag is called in the app and in diagnostics (A44). */
export const BUILD_FLAG_LABELS: Readonly<Record<BuildFlag['kind'], string>> = {
  'inputs-short': "Can't get enough inputs",
  'needs-expansion': 'Needs expansion',
  'over-resource-limit': 'Over a resource limit',
  'recipe-gone': 'Recipe no longer exists',
  'plan-changed': 'Plan changed',
  'can-reduce': 'Can be reduced',
  'data-changed': 'Game data changed',
};

/** Below this (machines or per minute), a count or a flow is rounding noise. */
const EPS = 1e-9;
/** Relative tolerance before a count or a rate counts as changed (A44). */
const REL = 1e-6;

const byItem = (a: ItemRate, b: ItemRate) => (a.item < b.item ? -1 : a.item > b.item ? 1 : 0);
const differ = (a: number, b: number) =>
  Math.abs(a - b) > REL * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * A plan as recipe groups, the entries manual mode freezes (A36): heaters
 * by boiler throughput. Sorted by recipe; empty unless the plan solved.
 */
export function planEntries(result: SolveResult): ManualEntry[] {
  if (result.status !== 'ok') return [];
  return result.recipes
    .map((r) => ({ recipe: r.id, machines: r.machines * (r.boilerLoad ?? 1) }))
    .filter((e) => e.machines > EPS)
    .sort((a, b) => (a.recipe < b.recipe ? -1 : a.recipe > b.recipe ? 1 : 0));
}

/** What a factory's result offers to mark as built. */
export type BuildSource = Pick<FactoryResult, 'id' | 'status' | 'plan' | 'request' | 'ledger'>;

/** Hashes of what a build mark is checked against: the factory's own settings, the world's, and its link boundary. */
export function buildFingerprint(
  world: World,
  factory: Factory,
  request: Pick<SolveRequest, 'demand' | 'imports'>,
): BuiltSnapshot['fingerprint'] {
  const hash = (v: unknown) => hashString(stableStringify(v));
  return {
    factory: hash({
      request: factory.request,
      unassignedImports: factory.unassignedImports,
      resources: factory.resources,
      tweaks: factory.tweaks,
      manual: factory.manual,
    }),
    world: hash({ defaults: world.defaults, nodePool: world.nodePool }),
    links: hash({ demand: request.demand ?? [], imports: request.imports ?? [] }),
  };
}

const rows = (ledger: readonly LedgerRow[], rate: (r: LedgerRow) => number): ItemRate[] =>
  ledger
    .map((r) => ({ item: r.item, rate: rate(r) }))
    .filter((r) => r.rate > EPS)
    .sort(byItem);

function setBuilt(world: World, id: string, built: BuiltSnapshot | undefined): World {
  const f = world.factories.find((x) => x.id === id);
  if (!f) throw new WorldEditError(`Unknown factory "${id}".`);
  if (!built && !f.built) return world;
  const next = { ...f };
  if (built) next.built = built;
  else delete next.built;
  return { ...world, factories: world.factories.map((x) => (x.id === id ? next : x)) };
}

/**
 * Marks a factory as built (A44): stores its current plan and boundary
 * flows. Marking again replaces the mark. A factory whose solve failed has
 * no plan to mark.
 */
export function markBuilt(
  world: World,
  source: BuildSource,
  dataHash: string,
  markedAt: string,
): World {
  const f = world.factories.find((x) => x.id === source.id);
  if (!f) throw new WorldEditError(`Unknown factory "${source.id}".`);
  if (source.status === 'infeasible')
    throw new WorldEditError(`${f.name} has no plan to mark as built.`);
  return setBuilt(world, f.id, {
    entries: source.plan.map((e) => ({ recipe: e.recipe, machines: e.machines })),
    inputs: rows(source.ledger, (r) => r.imported + r.unmet),
    outputs: rows(source.ledger, (r) => r.target + r.exported),
    dataHash,
    markedAt,
    fingerprint: buildFingerprint(world, f, source.request),
  });
}

/**
 * Marks every factory with a plan as built, in one edit. Returns the ids of
 * the factories left unmarked because their solve failed.
 */
export function markAllBuilt(
  world: World,
  sources: readonly BuildSource[],
  dataHash: string,
  markedAt: string,
): { world: World; skipped: string[] } {
  let out = world;
  const skipped: string[] = [];
  for (const s of [...sources].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (s.status === 'infeasible' || !world.factories.some((f) => f.id === s.id)) {
      skipped.push(s.id);
      continue;
    }
    out = markBuilt(out, s, dataHash, markedAt);
  }
  return { world: out, skipped };
}

/** Removes a factory's build mark. */
export function clearBuilt(world: World, id: string): World {
  return setBuilt(world, id, undefined);
}

/**
 * "Restore build" (A44): manual mode with the built plan as the frozen plan
 * and no edits. A manual plan the factory had is replaced.
 */
export function restoreBuild(world: World, id: string): World {
  const f = world.factories.find((x) => x.id === id);
  if (!f) throw new WorldEditError(`Unknown factory "${id}".`);
  if (!f.built) throw new WorldEditError(`${f.name} is not marked as built.`);
  const next: Factory = {
    ...f,
    manual: {
      enabled: true,
      frozen: f.built.entries.map((e) => ({ ...e })),
      edits: [],
    },
  };
  return { ...world, factories: world.factories.map((x) => (x.id === id ? next : x)) };
}

/** Today's side of a build check. */
export interface BuildNow {
  /** The factory's effective request in the world. */
  request: SolveRequest;
  /** Today's plan as recipe groups; ignored unless `planned`. */
  plan: readonly ManualEntry[];
  /** Whether today's plan exists (the solve did not fail). */
  planned: boolean;
  /**
   * What the built plan may import per item: unassigned import caps, each
   * fixed link at what it delivers, and each pull link uncapped unless its
   * producer failed or is manual (then at what it delivers).
   */
  imports: ImportCap[];
}

/** Checks a factory's build mark against today's world (A44, §4.8). */
export function checkBuild(
  model: Pick<Model, 'recipes' | 'nodes' | 'meta'>,
  world: World,
  factory: Factory,
  built: BuiltSnapshot,
  now: BuildNow,
): BuildCheck {
  const known = new Set(model.recipes.map((r) => r.id));
  const flags: BuildFlag[] = [];

  // Can it still run as built? Run the built plan as a manual plan.
  const run = manualOutcome(model, built.entries, { ...now.request, imports: now.imports });
  if (run.missing.length)
    flags.push({
      kind: 'inputs-short',
      severity: 'error',
      items: run.missing.map((m) => ({ ...m })),
    });
  const want = new Map<string, number>();
  for (const t of [...now.request.targets, ...(now.request.demand ?? [])])
    want.set(t.item, (want.get(t.item) ?? 0) + t.rate);
  const got = new Map<string, number>();
  for (const t of run.targets) got.set(t.item, (got.get(t.item) ?? 0) + t.rate);
  for (const [item, rate] of run.forLinks) got.set(item, (got.get(item) ?? 0) + rate);
  const short = [...want]
    .map(([item, rate]) => ({ item, rate: rate - (got.get(item) ?? 0) }))
    .filter((s) => s.rate > REL * Math.max(1, want.get(s.item)!))
    .sort(byItem);
  if (short.length) flags.push({ kind: 'needs-expansion', severity: 'error', items: short });
  const limits = now.request.resourceLimits ?? {};
  const over = run.result.extraction
    .filter(
      (e) =>
        limits[e.item] !== undefined &&
        e.rate - limits[e.item]! > REL * Math.max(1, limits[e.item]!),
    )
    .map((e) => ({ item: e.item, rate: e.rate, limit: limits[e.item]! }));
  if (over.length) flags.push({ kind: 'over-resource-limit', severity: 'error', items: over });
  const gone = built.entries.filter((e) => !known.has(e.recipe)).map((e) => e.recipe);
  if (gone.length) flags.push({ kind: 'recipe-gone', severity: 'error', recipes: gone });

  // Does today's plan match the build? Whole buildings when it plans whole machines.
  if (now.planned) {
    const whole = now.request.wholeMachines === true;
    const count = (n: number) => (whole ? Math.ceil(n - REL) : n);
    const was = new Map(built.entries.map((e) => [e.recipe, count(e.machines)]));
    const is = new Map(now.plan.map((e) => [e.recipe, count(e.machines)]));
    const changes: RecipeChange[] = [...new Set([...was.keys(), ...is.keys()])]
      .sort()
      .map((recipe) => ({ recipe, built: was.get(recipe) ?? 0, now: is.get(recipe) ?? 0 }))
      .filter((c) => differ(c.built, c.now));
    if (changes.some((c) => c.now > c.built))
      flags.push({ kind: 'plan-changed', severity: 'warning', changes });
    else if (changes.length) flags.push({ kind: 'can-reduce', severity: 'info', changes });
  }

  const dataChanged =
    built.dataHash !== '' && model.meta.dataHash !== '' && built.dataHash !== model.meta.dataHash;
  if (dataChanged) flags.push({ kind: 'data-changed', severity: 'info' });

  const print = buildFingerprint(world, factory, now.request);
  const causes: BuildCause[] = [];
  if (print.factory !== built.fingerprint.factory) causes.push('factory-settings');
  if (print.world !== built.fingerprint.world) causes.push('world-settings');
  if (print.links !== built.fingerprint.links) causes.push('links');
  if (dataChanged) causes.push('game-data');

  const has = (s: BuildFlag['severity']) => flags.some((f) => f.severity === s);
  return {
    state: has('error') ? 'broken' : has('warning') ? 'differs' : flags.length ? 'note' : 'matches',
    flags,
    causes,
    markedAt: built.markedAt,
  };
}
