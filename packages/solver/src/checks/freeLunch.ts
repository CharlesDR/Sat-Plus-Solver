import { MW_ITEM_ID, type Model, type Recipe } from '@sps/data';
import type { LpBackend, LpConstraint, LpModel, LpTerm } from '../lp/types';

export interface FreeLunchResult {
  /** True when some set of recipes (each with at least one input) nets output from nothing. */
  found: boolean;
  /** Which check found it: items from nothing (power allowed), or power from nothing. */
  kind?: 'items' | 'power';
  status: string;
  /** Activity (≤ 1) of each recipe in the loop. */
  recipes: { id: string; activity: number }[];
  /** Net output of each item (or `mw`) the loop creates. */
  items: { id: string; net: number }[];
}

const EPS = 1e-6;

/** A heater recipe's machine activity (A17); its own id is its boiler throughput. */
const heaterVar = (id: string) => `heater:${id}`;

/** Net power of a recipe per machine: generation positive, machine draw negative. */
const netPower = (r: Recipe): number => -r.powerMW;

/**
 * Build-time check (docs/ARCHITECTURE.md §3.2), on recipes that have inputs and
 * draw on no node, with each recipe's activity ≤ 1 and every item's net ≥ 0:
 *  1. items: maximize total net item output, with grid power freely available
 *     (a loop that multiplies items is a free lunch even if it needs power);
 *  2. power: maximize net power (generation minus machine draw), so a loop of
 *     generators and rechargers must pay for its own machines.
 * A positive optimum in either means something is created from nothing.
 * Heater recipes (A17) are modeled as the solver solves them: the heater side
 * (fuel, heater byproducts, draw) runs on machine activity `m ≤ 1`, the
 * boiler pair on throughput `b ≤ m`, so a heater may burn with its boiler idle.
 */
export async function findFreeLunch(
  model: Model,
  backend: LpBackend,
  whitelist: ReadonlySet<string> = new Set(),
): Promise<FreeLunchResult> {
  const recipes = model.recipes.filter(
    (r) => r.inputs.length > 0 && !r.node && !whitelist.has(r.id),
  );
  const net = new Map<string, LpTerm[]>();
  const itemGain: LpTerm[] = [];
  const gains = new Map<string, number>();
  const flow = (v: string, item: string, coef: number) => {
    net.set(item, [...(net.get(item) ?? []), { var: v, coef }]);
    gains.set(v, (gains.get(v) ?? 0) + coef);
  };
  /** The variable of `r` that a flow scales with; the heater side also carries the machine draw. */
  const varOf = (r: Recipe, heaterSide: boolean) =>
    r.heater && heaterSide ? heaterVar(r.id) : r.id;
  for (const r of recipes) {
    gains.set(r.id, 0);
    if (r.heater) gains.set(heaterVar(r.id), 0);
    for (const f of r.outputs) {
      if (f.item === MW_ITEM_ID) continue; // power is accounted via powerMW
      flow(varOf(r, f.heater === true), f.item, f.rate);
    }
    for (const f of r.inputs) flow(varOf(r, f.heater === true), f.item, -f.rate);
  }
  for (const [v, coef] of gains) itemGain.push({ var: v, coef });
  const balances: LpConstraint[] = [...net].map(([item, terms]) => ({ name: item, terms, lo: 0 }));
  const variables = [...gains.keys()].map((name) => ({ name, lo: 0, hi: 1 }));
  for (const r of recipes)
    if (r.heater)
      balances.push({
        name: `boiler:${r.id}`,
        terms: [
          { var: r.id, coef: 1 },
          { var: heaterVar(r.id), coef: -1 },
        ],
        hi: 0,
      });
  const byId = new Map(recipes.map((r) => [r.id, r]));

  const run = async (kind: 'items' | 'power', objective: LpTerm[]): Promise<FreeLunchResult> => {
    const lp: LpModel = { sense: 'max', objective, variables, constraints: balances };
    const sol = await backend.solve(lp);
    if (sol.status !== 'optimal' || !sol.values) {
      return { found: false, status: sol.rawStatus, recipes: [], items: [] };
    }
    const level = (v: string) => sol.values!.get(v) ?? 0;
    // A heater's activity is its machine activity; its boiler may run lower.
    const active = recipes
      .map((r) => ({ id: r.id, activity: level(varOf(r, true)) }))
      .filter((r) => r.activity > EPS);
    const netOut = new Map<string, number>();
    const bump = (id: string, v: number) => netOut.set(id, (netOut.get(id) ?? 0) + v);
    for (const { id } of active) {
      const r = byId.get(id)!;
      const at = (heaterSide: boolean) => level(varOf(r, heaterSide));
      if (kind === 'power') bump(MW_ITEM_ID, netPower(r) * at(true));
      for (const f of r.outputs)
        if (f.item !== MW_ITEM_ID) bump(f.item, f.rate * at(f.heater === true));
      for (const f of r.inputs) bump(f.item, -f.rate * at(f.heater === true));
    }
    const items = [...netOut].filter(([, v]) => v > EPS).map(([id, n]) => ({ id, net: n }));
    const found = (sol.objective ?? 0) > EPS && items.length > 0;
    return {
      found,
      ...(found ? { kind } : {}),
      status: sol.rawStatus,
      recipes: found ? active : [],
      items: found ? items : [],
    };
  };

  const items = await run('items', itemGain);
  if (items.found) return items;
  return run(
    'power',
    recipes.map((r) => ({ var: varOf(r, true), coef: netPower(r) })),
  );
}
