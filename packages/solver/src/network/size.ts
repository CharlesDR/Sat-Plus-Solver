/**
 * Network sizing (A56): machine counts for a drawn production network whose
 * wiring is fixed but whose counts are only partly given, as in a
 * Satisfactory Modeler save where most nodes are unlimited. Built here
 * because only the solver builds LP rows (CLAUDE.md).
 *
 * Every machine runs fully fed: a connected input takes exactly what its
 * count needs, over its incoming edges. An output may give its edges less
 * than it makes (the rest overflows). Pass nodes (splitters, mergers, ports)
 * conserve each item; one with no edges in for an item is a free source of
 * it, and one with no edges out absorbs it. Sources supply freely and sinks
 * take anything. Three passes, each keeping the last one's optimum:
 *
 * 1. Capped machines run as close to their cap as the wiring allows
 *    (Σ count / cap, so every cap weighs the same).
 * 2. Connected outputs overflow as little as possible, so what a capped
 *    source makes is carried on downstream.
 * 3. Uncapped machines run as little as possible: only what the first two
 *    passes need.
 *
 * Pure, apart from the injected backend.
 */
import type { LpBackend, LpConstraint, LpModel, LpStatus, LpTerm, LpVariable } from '../lp/types';

export interface NetworkFlow {
  item: string;
  /** Per machine, per minute. */
  rate: number;
}

export type NetworkNode =
  | {
      id: string;
      kind: 'machine';
      /** Most machines it may run; missing = unlimited. */
      max?: number;
      inputs: readonly NetworkFlow[];
      outputs: readonly NetworkFlow[];
    }
  | { id: string; kind: 'pass' | 'source' | 'sink' };

export interface NetworkEdge {
  from: string;
  to: string;
  item: string;
}

export interface Network {
  nodes: readonly NetworkNode[];
  edges: readonly NetworkEdge[];
}

export interface NetworkSizing {
  status: 'ok' | LpStatus;
  /** Machine count per machine node (0 when it runs at none). */
  machines: Map<string, number>;
  /** Flow per edge, in `edges` order. */
  flows: number[];
}

/** Below this a count or a flow is rounding noise. */
const EPS = 1e-9;
/** A capped machine this close to its cap (relative) is at it. */
const AT_CAP = 1e-7;
/** How much of an earlier pass's optimum a later pass may give up. */
const KEEP = 1e-9;

const m = (id: string) => `m:${id}`;
const f = (i: number) => `f:${i}`;
const over = (id: string, item: string) => `o:${id}:${item}`;

/** Sizes `network`. Deterministic: the same network gives the same counts. */
export async function sizeNetwork(network: Network, backend: LpBackend): Promise<NetworkSizing> {
  const variables: LpVariable[] = [];
  const constraints: LpConstraint[] = [];
  const into = new Map<string, Map<string, number[]>>();
  const outOf = new Map<string, Map<string, number[]>>();
  const push = (map: Map<string, Map<string, number[]>>, node: string, item: string, i: number) => {
    let byItem = map.get(node);
    if (!byItem) map.set(node, (byItem = new Map()));
    const list = byItem.get(item);
    if (list) list.push(i);
    else byItem.set(item, [i]);
  };
  network.edges.forEach((e, i) => {
    variables.push({ name: f(i) });
    push(into, e.to, e.item, i);
    push(outOf, e.from, e.item, i);
  });
  const sum = (edges: readonly number[] = [], coef = 1): LpTerm[] =>
    edges.map((i) => ({ var: f(i), coef }));
  const edgesOf = (map: Map<string, Map<string, number[]>>, node: string) =>
    [...(map.get(node) ?? new Map<string, number[]>())].sort(([a], [b]) => (a < b ? -1 : 1));

  const capped: LpTerm[] = [];
  const uncapped: LpTerm[] = [];
  const overflow: LpTerm[] = [];
  for (const n of network.nodes) {
    if (n.kind === 'machine') {
      variables.push({ name: m(n.id), ...(n.max !== undefined ? { hi: n.max } : {}) });
      if (n.max !== undefined && n.max > EPS) capped.push({ var: m(n.id), coef: 1 / n.max });
      else if (n.max === undefined) uncapped.push({ var: m(n.id), coef: 1 });
      const ins = new Map(n.inputs.map((x) => [x.item, x.rate]));
      for (const [item, edges] of edgesOf(into, n.id)) {
        const rate = ins.get(item);
        // An edge bringing an item the machine doesn't take carries nothing.
        const terms =
          rate === undefined ? sum(edges) : [...sum(edges), { var: m(n.id), coef: -rate }];
        constraints.push({ name: `in:${n.id}:${item}`, terms, lo: 0, hi: 0 });
      }
      const outs = new Map(n.outputs.map((x) => [x.item, x.rate]));
      for (const [item, edges] of edgesOf(outOf, n.id)) {
        const rate = outs.get(item);
        if (rate === undefined) {
          constraints.push({ name: `out:${n.id}:${item}`, terms: sum(edges), lo: 0, hi: 0 });
          continue;
        }
        variables.push({ name: over(n.id, item) });
        overflow.push({ var: over(n.id, item), coef: 1 });
        const terms = [
          ...sum(edges),
          { var: over(n.id, item), coef: 1 },
          { var: m(n.id), coef: -rate },
        ];
        constraints.push({ name: `out:${n.id}:${item}`, terms, lo: 0, hi: 0 });
      }
    } else if (n.kind === 'pass') {
      const ins = new Map(edgesOf(into, n.id));
      const outs = new Map(edgesOf(outOf, n.id));
      for (const item of [...new Set([...ins.keys(), ...outs.keys()])].sort()) {
        const a = ins.get(item);
        const b = outs.get(item);
        if (!a || !b) continue; // a free source, or a sink, of this item
        constraints.push({
          name: `pass:${n.id}:${item}`,
          terms: [...sum(a), ...sum(b, -1)],
          lo: 0,
          hi: 0,
        });
      }
    }
  }

  const passes: { sense: 'min' | 'max'; objective: LpTerm[] }[] = [
    { sense: 'max', objective: capped },
    { sense: 'min', objective: overflow },
    { sense: 'min', objective: uncapped },
  ];
  let values: Map<string, number> | undefined;
  for (const [i, pass] of passes.entries()) {
    if (pass.objective.length === 0) continue;
    const model: LpModel = { sense: pass.sense, objective: pass.objective, variables, constraints };
    const sol = await backend.solve(model);
    if (sol.status !== 'optimal' || sol.objective === undefined || !sol.values) {
      return { status: sol.status, machines: new Map(), flows: [] };
    }
    values = sol.values;
    if (i === 0) {
      // A machine that reached its cap stays exactly there in later passes.
      for (const v of variables) {
        if (v.hi === undefined || !v.name.startsWith('m:')) continue;
        if ((values.get(v.name) ?? 0) >= v.hi - AT_CAP * Math.max(1, v.hi)) v.lo = v.hi;
      }
    }
    const best = sol.objective;
    const slack = KEEP * Math.max(1, Math.abs(best));
    constraints.push({
      name: `keep:${i}`,
      terms: pass.objective,
      ...(pass.sense === 'max' ? { lo: best - slack } : { hi: best + slack }),
    });
  }
  const value = (name: string) => {
    const v = values?.get(name) ?? 0;
    return v > EPS ? v : 0;
  };
  const machines = new Map<string, number>();
  for (const n of network.nodes) if (n.kind === 'machine') machines.set(n.id, value(m(n.id)));
  return { status: 'ok', machines, flows: network.edges.map((_, i) => value(f(i))) };
}
