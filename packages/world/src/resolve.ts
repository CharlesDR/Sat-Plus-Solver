/**
 * World resolution (docs/ARCHITECTURE.md §4.2–4.3): turns links into each
 * factory's demand and import caps, solves the factories in dependency order
 * through an injected `solveFactory`, iterates pull cycles to a fixed point,
 * and memoizes every solve. Pure: no I/O, no time, no randomness.
 */
import { MW_ITEM_ID, type Model } from '@sps/data';
import {
  MIN_RATE,
  OBJECTIVE_IDS,
  objectiveStack,
  type ImportCap,
  type ImportCost,
  type ItemRate,
  type ObjectiveId,
  type SolveRequest,
  type SolveResult,
} from '@sps/solver';
import { analyze } from './analytics';
import { factorySolveRequest, type Link, type ManualEntry, type World } from './document';
import { createSolveCache, solveKey, type SolveCache } from './hash';
import { manualEntries, manualOutcome, type ManualOutcome } from './manual';
import type { SolveFactory, WorldDiagnostic, WorldResult } from './types';

/** §4.3 step 3: most sweeps of a pull cycle before it is reported. */
export const CYCLE_ITERATION_LIMIT = 25;
/** §4.3 step 3: a cycle has converged when every pull rate moves less than this, relative. */
export const CYCLE_TOLERANCE = 1e-6;
/** Most resolution passes while linked import costs settle (as `solveCosted` in the solver). */
export const COST_PASSES = 4;

/** Default pipe capacity per tier, m³/min (A10): Mk1 300, Mk2 600. */
export const DEFAULT_PIPE_CAPACITIES: Readonly<Record<number, number>> = { 1: 300, 2: 600 };

export interface ResolveOptions {
  /** Pipe capacity per tier, m³/min (A10). Default 300 (Mk1) and 600 (Mk2). */
  pipeCapacities?: Readonly<Record<number, number>>;
  /** Called as each factory starts solving (memoized ones too), for a progress display. */
  onProgress?: (progress: ResolveProgress) => void;
}

/** Where a world solve is: the factory starting now, and how far the pass has got. */
export interface ResolveProgress {
  factory: string;
  /** Factories started in this pass, this one included; a pull cycle's sweeps count again. */
  step: number;
  /** Factories in the world. */
  factories: number;
  /** Resolution pass, from 1 (more while linked import costs settle). */
  pass: number;
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byItem = <T extends { item: string }>(a: T, b: T) =>
  a.item < b.item ? -1 : a.item > b.item ? 1 : 0;

/** One factory's last solve in a pass. */
export interface Solved {
  request: SolveRequest;
  key: string;
  result: SolveResult;
  /** Manual mode (A36): the plan's arithmetic, not a solve. */
  manual?: ManualOutcome;
}

/** The state a resolution pass leaves behind; `analyze` turns it into a `WorldResult`. */
export interface Pass {
  solved: Map<string, Solved>;
  /** Per link: the rate in its producer's request on the producer's last solve. */
  asked: Map<string, number>;
  /** Per link: what its consumer's plan drew through it on the consumer's last solve. */
  used: Map<string, number>;
  /** Per link out of a manual factory (A36): what it actually ships, at most what was asked. */
  delivered: Map<string, number>;
  /**
   * Surplus draws (A51): per sub-factory, per item, what its parent's plan
   * took from the sub-factory's surplus on the parent's last solve.
   */
  drawn: Map<string, Map<string, number>>;
  diagnostics: WorldDiagnostic[];
}

interface Context {
  world: World;
  model: Model;
  links: Link[];
  out: Map<string, Link[]>;
  in: Map<string, Link[]>;
  base: Map<string, SolveRequest>;
  /** Factories in manual mode (A36): their plans, which are not solved. */
  manual: Map<string, ManualEntry[]>;
  /** Sub-factory → its parent (A49), for parents that exist; cycles broken. */
  parent: Map<string, string>;
  /** Parent → its sub-factories, sorted. */
  children: Map<string, string[]>;
  /** Producer → items and objectives its linked consumers are costed under. */
  needs: Map<string, { items: Set<string>; objectives: Set<ObjectiveId> }>;
  run: (request: SolveRequest) => Promise<{ key: string; result: Solved['result'] }>;
  /** Reports a factory starting to solve (`ResolveOptions.onProgress`). */
  started: (factory: string) => void;
}

/**
 * Resolves the world (§4.3) and computes its analytics (§4.4–4.5).
 *
 * 1. Strongly connected components over `pull` links; solved consumers first,
 *    so pull demand propagates upstream. `fixed` links impose no order.
 * 2. A pull cycle is swept until every pull rate moves less than
 *    `CYCLE_TOLERANCE` (relative), at most `CYCLE_ITERATION_LIMIT` times;
 *    otherwise it is reported, with a hint to make one link fixed.
 * 3. A factory that fails does not stop the solve: its outgoing links are short.
 * 4. Every solve is memoized in `cache` by its effective request, so after an
 *    edit only that factory and the factories its pull demand reaches re-solve.
 * 5. With "cost imported inputs", a linked import costs the upstream plan's
 *    marginal cost (A18); passes repeat until those costs settle.
 */
export async function resolveWorld(
  world: World,
  model: Model,
  solveFactory: SolveFactory,
  cache: SolveCache = createSolveCache(),
  options: ResolveOptions = {},
): Promise<WorldResult> {
  const diagnostics: WorldDiagnostic[] = [];
  const factories = [...world.factories].sort(byId);
  const ids = new Set(factories.map((f) => f.id));
  const items = new Set(model.items.map((i) => i.id));
  const links = [...world.links].sort(byId).filter((l) => {
    const problem =
      !ids.has(l.from) || !ids.has(l.to)
        ? `connects an unknown factory (${!ids.has(l.from) ? l.from : l.to})`
        : l.from === l.to
          ? 'links a factory to itself'
          : !items.has(l.item)
            ? `carries an unknown item "${l.item}"`
            : l.mode.kind === 'fixed' &&
                (!Number.isFinite(l.mode.rate) ||
                  l.mode.rate < 0 ||
                  (l.mode.rate > 0 && l.mode.rate < MIN_RATE))
              ? `has an invalid rate ${l.mode.rate} (0 or at least ${MIN_RATE}/min)`
              : undefined;
    if (problem)
      diagnostics.push({
        code: 'invalid-link',
        severity: 'error',
        link: l.id,
        message: `Link ${l.id} ${problem}; it is ignored.`,
      });
    return !problem;
  });

  const stats = { solves: 0, cacheHits: 0, passes: 0 };
  let step = 0;
  let stepPass = 0;
  const ctx: Context = {
    world,
    model,
    links,
    out: group(links, (l) => l.from),
    in: group(links, (l) => l.to),
    base: new Map(factories.map((f) => [f.id, factorySolveRequest(world, model, f.id)])),
    manual: new Map(
      factories.flatMap((f) => (f.manual?.enabled ? [[f.id, manualEntries(f.manual)]] : [])),
    ),
    ...nesting(world, diagnostics),
    needs: new Map(),
    async run(request) {
      const { key, canonical } = solveKey(model.meta.dataHash, request);
      const hit = cache.get(key);
      if (hit && hit.canonical === canonical) {
        stats.cacheHits++;
        return { key, result: hit.result };
      }
      stats.solves++;
      const result = await solveFactory(request);
      cache.set(key, { canonical, result });
      return { key, result };
    },
    started(factory) {
      if (!options.onProgress) return;
      if (stepPass !== stats.passes) [step, stepPass] = [0, stats.passes];
      step++;
      options.onProgress({ factory, step, factories: factories.length, pass: stats.passes });
    },
  };
  for (const l of links) {
    const consumer = ctx.base.get(l.to)!;
    if (!consumer.costImports) continue;
    const need = ctx.needs.get(l.from) ?? { items: new Set(), objectives: new Set() };
    need.items.add(l.item);
    for (const o of objectiveStack(consumer)) need.objectives.add(o);
    ctx.needs.set(l.from, need);
  }

  let linked = new Map<string, Map<string, ImportCost>>();
  let pass: Pass;
  for (;;) {
    stats.passes++;
    pass = await resolvePass(ctx, linked);
    if (!ctx.needs.size) break;
    const next = linkedCosts(ctx, pass);
    if (sameLinked(next, linked)) break;
    if (stats.passes >= COST_PASSES) {
      diagnostics.push({
        code: 'import-cost-unsettled',
        severity: 'warning',
        factories: [...next.keys()].sort(),
        message:
          `Linked import costs did not settle after ${COST_PASSES} passes; ` +
          'plans use the costs of the last pass.',
      });
      break;
    }
    linked = next;
  }
  return analyze(ctx.world, model, links, pass, [...diagnostics, ...pass.diagnostics], stats, {
    pipeCapacities: options.pipeCapacities ?? DEFAULT_PIPE_CAPACITIES,
  });
}

function group<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

/**
 * The nesting tree (A49): each sub-factory's parent and each parent's
 * sub-factories. A parent that is unknown or part of a parent cycle is
 * dropped (the factory is solved as a top-level one) and reported.
 */
function nesting(
  world: World,
  diagnostics: WorldDiagnostic[],
): { parent: Map<string, string>; children: Map<string, string[]> } {
  const ids = new Set(world.factories.map((f) => f.id));
  const parent = new Map<string, string>();
  for (const f of [...world.factories].sort(byId)) {
    if (f.parentId === undefined) continue;
    if (!ids.has(f.parentId) || f.parentId === f.id) {
      diagnostics.push({
        code: 'invalid-parent',
        severity: 'warning',
        factory: f.id,
        message: `Factory ${f.id} sits inside an unknown factory ${f.parentId}; it is solved on its own.`,
      });
      continue;
    }
    parent.set(f.id, f.parentId);
  }
  // Break parent cycles at their smallest id, as groups do.
  for (const id of [...parent.keys()].sort()) {
    const seen: string[] = [];
    let at: string | undefined = id;
    while (at !== undefined && !seen.includes(at)) {
      seen.push(at);
      at = parent.get(at);
    }
    if (at === undefined) continue;
    const cycle = seen.slice(seen.indexOf(at)).sort();
    parent.delete(cycle[0]!);
    diagnostics.push({
      code: 'invalid-parent',
      severity: 'warning',
      factory: cycle[0]!,
      message: `Factories ${cycle.join(', ')} sit inside each other in a cycle; ${cycle[0]} is solved as a top-level factory.`,
    });
  }
  const children = new Map<string, string[]>();
  for (const [child, p] of [...parent].sort(([a], [b]) => (a < b ? -1 : 1)))
    children.set(p, [...(children.get(p) ?? []), child]);
  return { parent, children };
}

/** One resolution pass over the whole world with the given linked import costs. */
async function resolvePass(
  ctx: Context,
  linked: ReadonlyMap<string, ReadonlyMap<string, ImportCost>>,
): Promise<Pass> {
  const pass: Pass = {
    solved: new Map(),
    asked: new Map(),
    used: new Map(),
    delivered: new Map(),
    drawn: new Map(),
    diagnostics: [],
  };
  const pull = new Map<string, number>();
  /** Per parent: what each sub-factory's surplus offered on the parent's last solve (A51). */
  const offered = new Map<string, Offer[]>();

  const solveOne = async (id: string) => {
    ctx.started(id);
    const offers = surplusOffers(ctx, pass, id);
    offered.set(id, offers);
    for (const child of ctx.children.get(id) ?? []) pass.drawn.delete(child);
    const request = effectiveRequest(ctx, id, pull, linked.get(id), offers);
    for (const l of ctx.out.get(id) ?? []) {
      const r = l.mode.kind === 'fixed' ? l.mode.rate : (pull.get(l.id) ?? 0);
      pass.asked.set(l.id, r >= MIN_RATE ? r : 0);
    }
    const entries = ctx.manual.get(id);
    if (entries) {
      // Manual mode (A36): arithmetic on the frozen counts; links get what is left after targets.
      const manual = manualOutcome(ctx.model, entries, request);
      pass.solved.set(id, { request, key: 'manual', result: manual.result, manual });
      const left = new Map(manual.forLinks);
      for (const l of ctx.out.get(id) ?? []) {
        const give = Math.min(pass.asked.get(l.id) ?? 0, left.get(l.item) ?? 0);
        pass.delivered.set(l.id, give);
        left.set(l.item, (left.get(l.item) ?? 0) - give);
      }
      attribute(ctx.in.get(id) ?? [], offers, manual.result, pass, pull);
      return;
    }
    const { key, result } = await ctx.run(request);
    pass.solved.set(id, { request, key, result });
    attribute(ctx.in.get(id) ?? [], offers, result, pass, pull);
  };

  for (const scc of solveOrder(ctx)) {
    if (scc.length === 1) {
      await solveOne(scc[0]!);
      continue;
    }
    // A cycle (§4.3 step 3): pull links, or a parent drawing on its
    // sub-factories' surplus (A51). Sweep its members until the rates settle.
    const members = new Set(scc);
    const internal = ctx.links.filter(
      (l) => l.mode.kind === 'pull' && members.has(l.from) && members.has(l.to),
    );
    const rates = () => {
      const out = new Map<string, number>();
      for (const l of internal) out.set(l.id, pull.get(l.id) ?? 0);
      for (const id of scc)
        for (const o of offered.get(id) ?? []) out.set(`offer:${o.child}:${o.item}`, o.cap);
      for (const id of scc)
        for (const [item, rate] of pass.drawn.get(id) ?? []) out.set(`drawn:${id}:${item}`, rate);
      return out;
    };
    let converged = false;
    let iterations = 0;
    while (!converged && iterations < CYCLE_ITERATION_LIMIT) {
      iterations++;
      const before = rates();
      for (const id of scc) await solveOne(id);
      const after = rates();
      converged = [...new Set([...before.keys(), ...after.keys()])].every((k) => {
        const a = before.get(k) ?? 0;
        const b = after.get(k) ?? 0;
        return Math.abs(a - b) <= CYCLE_TOLERANCE * Math.max(1, Math.abs(a));
      });
    }
    if (!converged)
      pass.diagnostics.push({
        code: 'cycle-not-converged',
        severity: 'error',
        factories: [...scc],
        links: internal.map((l) => l.id),
        iterations,
        message: internal.length
          ? `The pull links between ${scc.join(', ')} did not settle after ${iterations} iterations. ` +
            `Make one of them fixed (${internal.map((l) => l.id).join(', ')}).`
          : `The surplus drawn between ${scc.join(', ')} did not settle after ${iterations} iterations.`,
      });
  }
  return pass;
}

/** What one sub-factory's surplus offers its parent (A51). */
interface Offer {
  child: string;
  item: string;
  cap: number;
}

/**
 * What `id`'s sub-factories leave as surplus, per item, on their latest
 * solve in this pass (A51): the parent may draw on it without a link. A
 * sub-factory not solved yet, or failed, offers nothing. Sorted by child,
 * then item.
 */
function surplusOffers(ctx: Context, pass: Pass, id: string): Offer[] {
  const out: Offer[] = [];
  for (const child of ctx.children.get(id) ?? []) {
    const r = pass.solved.get(child)?.result;
    if (r?.status !== 'ok') continue;
    for (const f of [...r.items].sort(byItem))
      if (f.surplus >= MIN_RATE && f.item !== MW_ITEM_ID)
        out.push({ child, item: f.item, cap: f.surplus });
  }
  return out;
}

/**
 * A factory's request in the world: its own request, plus outgoing link
 * rates as demand and incoming links and sub-factory surplus (A51) as import
 * caps (§4.2), plus linked import costs and the marginal costs its linked
 * consumers need. What a sub-factory sends its parent counts toward its own
 * target of that item (A50).
 */
function effectiveRequest(
  ctx: Context,
  id: string,
  pull: ReadonlyMap<string, number>,
  costs: ReadonlyMap<string, ImportCost> | undefined,
  offers: readonly Offer[] = [],
): SolveRequest {
  const base = ctx.base.get(id)!;
  const parent = ctx.parent.get(id);
  const demand = new Map<string, number>();
  const toParent = new Map<string, number>();
  for (const l of ctx.out.get(id) ?? []) {
    const r = l.mode.kind === 'fixed' ? l.mode.rate : (pull.get(l.id) ?? 0);
    // Below MIN_RATE is solver noise, and the solver rejects it as a demand.
    if (r < MIN_RATE) continue;
    demand.set(l.item, (demand.get(l.item) ?? 0) + r);
    if (l.to === parent) toParent.set(l.item, (toParent.get(l.item) ?? 0) + r);
  }
  const caps = new Map<string, number>();
  for (const i of base.imports ?? []) caps.set(i.item, (caps.get(i.item) ?? 0) + i.cap);
  for (const l of ctx.in.get(id) ?? []) {
    const cap = l.mode.kind === 'fixed' ? l.mode.rate : Infinity;
    caps.set(l.item, (caps.get(l.item) ?? 0) + cap);
  }
  for (const o of offers) caps.set(o.item, (caps.get(o.item) ?? 0) + o.cap);
  const rest: SolveRequest = { ...base };
  delete (rest as { imports?: unknown }).imports;
  if (toParent.size) rest.targets = countSent(base.targets, toParent);
  const need = ctx.needs.get(id);
  const given = base.costImports && costs ? [...costs.values()].sort(byItem) : [];
  return {
    ...rest,
    ...(demand.size ? { demand: toRates(demand) } : {}),
    ...(caps.size
      ? {
          imports: [...caps].map(([item, cap]): ImportCap => ({ item, cap })).sort(byItem),
        }
      : {}),
    ...(given.length ? { importCosts: given } : {}),
    ...(need
      ? {
          marginalCosts: {
            items: [...need.items].sort(),
            objectives: OBJECTIVE_IDS.filter((o) => need.objectives.has(o)),
          },
        }
      : {}),
  };
}

/**
 * A sub-factory's targets less what it already sends its parent (A50): it
 * makes the larger of the two, not their sum. A target used up is dropped.
 */
function countSent(targets: readonly ItemRate[], sent: ReadonlyMap<string, number>): ItemRate[] {
  const left = new Map(sent);
  const out: ItemRate[] = [];
  for (const t of targets) {
    const take = Math.min(t.rate, left.get(t.item) ?? 0);
    left.set(t.item, (left.get(t.item) ?? 0) - take);
    const rate = t.rate - take;
    if (rate >= MIN_RATE) out.push({ item: t.item, rate });
  }
  return out;
}

const toRates = (m: ReadonlyMap<string, number>): ItemRate[] =>
  [...m].map(([item, rate]) => ({ item, rate })).sort(byItem);

/**
 * Splits a consumer's import of each linked item over its sources: fixed
 * links first (by id, each up to its rate), then its sub-factories' surplus
 * (A51, by child, each up to what it offered), then the pull links in equal
 * shares; whatever is left came from unassigned imports. Sets each link's
 * `used`, each pull link's resolved rate and each surplus draw.
 */
function attribute(
  incoming: readonly Link[],
  offers: readonly Offer[],
  result: Solved['result'],
  pass: Pass,
  pull: Map<string, number>,
): void {
  const imported = new Map(
    result.status === 'ok' ? result.imports.map((i) => [i.item, i.rate]) : [],
  );
  const byItemLinks = group(incoming, (l) => l.item);
  const byItemOffers = group(offers, (o) => o.item);
  const items = [...new Set([...byItemLinks.keys(), ...byItemOffers.keys()])].sort();
  for (const item of items) {
    const links = byItemLinks.get(item) ?? [];
    let left = imported.get(item) ?? 0;
    for (const l of links) {
      if (l.mode.kind !== 'fixed') continue;
      const u = Math.min(l.mode.rate, left);
      pass.used.set(l.id, u);
      left -= u;
    }
    for (const o of byItemOffers.get(item) ?? []) {
      const u = Math.min(o.cap, left);
      left -= u;
      if (u <= 0) continue;
      const m = pass.drawn.get(o.child) ?? new Map<string, number>();
      m.set(item, u);
      pass.drawn.set(o.child, m);
    }
    const pulls = links.filter((l) => l.mode.kind === 'pull');
    for (const l of pulls) {
      const share = left / pulls.length;
      pass.used.set(l.id, share);
      pull.set(l.id, share);
    }
  }
}

/**
 * Strongly connected components over pull links and surplus draws (Tarjan),
 * in solve order: an SCC comes after every SCC its pull links feed, so
 * consumers go first, and a parent after its sub-factories (A51).
 * Ties go to the smallest factory id; members are sorted. Deterministic.
 */
function solveOrder(ctx: Context): string[][] {
  const ids = [...ctx.base.keys()].sort();
  const next = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const l of ctx.links) if (l.mode.kind === 'pull') next.get(l.from)!.push(l.to);
  // A parent draws on its sub-factories' surplus (A51), so it comes after them.
  for (const [child, parent] of ctx.parent) next.get(parent)!.push(child);
  for (const v of next.values()) v.sort();

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const sccs: string[][] = [];
  const visit = (v: string) => {
    index.set(v, index.size);
    low.set(v, index.get(v)!);
    stack.push(v);
    onStack.add(v);
    for (const w of next.get(v)!) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc.sort());
    }
  };
  for (const id of ids) if (!index.has(id)) visit(id);

  // Kahn over the condensation, consumers (no unsolved successor) first.
  const of = new Map<string, number>();
  sccs.forEach((s, k) => s.forEach((id) => of.set(id, k)));
  const succ = sccs.map(() => new Set<number>());
  const pred = sccs.map(() => new Set<number>());
  for (const [from, tos] of next)
    for (const to of tos) {
      const a = of.get(from)!;
      const b = of.get(to)!;
      if (a !== b) {
        succ[a]!.add(b);
        pred[b]!.add(a);
      }
    }
  const left = succ.map((s) => s.size);
  const ready = sccs.map((_, k) => k).filter((k) => left[k] === 0);
  const order: string[][] = [];
  while (ready.length) {
    ready.sort((a, b) => (sccs[a]![0]! < sccs[b]![0]! ? -1 : 1));
    const k = ready.shift()!;
    order.push(sccs[k]!);
    for (const p of pred[k]!) if (--left[p]! === 0) ready.push(p);
  }
  return order;
}

/**
 * Linked import costs for the next pass (A18): per consumer that costs its
 * imports and per linked item, the producers' marginal costs, weighted by
 * what each link was asked for (equal weights when nothing was). A producer
 * that failed, or reports no cost, leaves the item to standalone costing.
 */
function linkedCosts(ctx: Context, pass: Pass): Map<string, Map<string, ImportCost>> {
  const out = new Map<string, Map<string, ImportCost>>();
  for (const [consumer, links] of ctx.in) {
    if (!ctx.base.get(consumer)!.costImports) continue;
    for (const [item, feeding] of group(links, (l) => l.item)) {
      const quotes = feeding.map((l) => ({
        weight: pass.asked.get(l.id) ?? 0,
        cost: pass.solved.get(l.from)?.result.marginalCosts?.find((c) => c.item === item),
      }));
      if (quotes.some((q) => !q.cost)) continue;
      const total = quotes.reduce((s, q) => s + q.weight, 0);
      const w = (q: (typeof quotes)[number]) => (total > 0 ? q.weight / total : 1 / quotes.length);
      const cost: Partial<Record<ObjectiveId, number>> = {};
      for (const o of OBJECTIVE_IDS) {
        if (!quotes.every((q) => q.cost!.cost[o] !== undefined)) continue;
        cost[o] = quotes.reduce((s, q) => s + w(q) * q.cost!.cost[o]!, 0);
      }
      const resourceTypes = [...new Set(quotes.flatMap((q) => q.cost!.resourceTypes))].sort();
      const m = out.get(consumer) ?? new Map<string, ImportCost>();
      m.set(item, { item, rate: total, cost, resourceTypes });
      out.set(consumer, m);
    }
  }
  return out;
}

/** Same costs (1e-9 relative) and resource types for every consumer and item; rates are ignored. */
function sameLinked(
  a: ReadonlyMap<string, ReadonlyMap<string, ImportCost>>,
  b: ReadonlyMap<string, ReadonlyMap<string, ImportCost>>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [consumer, x] of a) {
    const y = b.get(consumer);
    if (!y || x.size !== y.size) return false;
    for (const [item, c] of x) {
      const d = y.get(item);
      if (!d || c.resourceTypes.join() !== d.resourceTypes.join()) return false;
      for (const o of OBJECTIVE_IDS) {
        const u = c.cost[o];
        const v = d.cost[o];
        if (u === undefined || v === undefined) {
          if (u !== v) return false;
        } else if (Math.abs(u - v) > 1e-9 * Math.max(1, Math.abs(u), Math.abs(v))) return false;
      }
    }
  }
  return true;
}
