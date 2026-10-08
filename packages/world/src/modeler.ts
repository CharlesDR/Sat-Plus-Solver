/**
 * Satisfactory Modeler saves (`.sfmd`, M14, A37, A56–A58). Modeler stays a
 * separate program: this module only reads and writes its plain-JSON save
 * format. Pure.
 *
 * Reading: `parseModeler` checks the shape and normalizes every connection
 * to `{ src, port?, item? }`. `modelerNetwork` turns the save into a network
 * the solver can size (A56); `importModeler` makes one manual factory per
 * Outpost (A57), nested as the Outposts are, with every node it can't map
 * listed in the report.
 *
 * Writing: `writeModeler` lays out sheets (one per factory, built from the
 * flowchart) as Outposts, wired along the world's links (A58).
 */
import { MW_ITEM_ID, type Model, type Recipe } from '@sps/data';
import type { Network, NetworkEdge, NetworkNode, NetworkSizing } from '@sps/solver';
import { createFactory, type Factory, type Link, type ManualEntry, type World } from './document';
import { nextId } from './editing';

// ---------------------------------------------------------------- format

/** One connection into a node: from node `src`, its output `port`, carrying `item` when the save says. */
export interface ModelerRef {
  src: number;
  port?: number;
  item?: string;
}

/** One input slot: a recipe's input item (`item`), or a port of a list-form node. */
export interface ModelerSlot {
  item?: string;
  refs: ModelerRef[];
}

export interface ModelerNode {
  index: number;
  name: string;
  x: number;
  y: number;
  /** Index of the Outpost it sits in. */
  parent?: number;
  title?: string;
  /** Machine count, as written (a fraction or decimal string). */
  max?: string;
  inputs: ModelerSlot[];
  /** Outposts: what feeds each output port from inside. */
  interior: ModelerSlot[];
  /** Keys this reader does not know (Modeler-only settings). */
  extra: string[];
  /** Sinks: what one takes per minute at a Max of 1 (`"60/min"`). */
  capacity?: string;
  /** Our own marker on exported extractor nodes: the recipe and its count. */
  sps?: { recipe: string; machines: string };
}

export interface ModelerSave {
  nodes: ModelerNode[];
}

/** The file is not a Modeler save we can read; the world is left as it was. */
export class ModelerFormatError extends Error {
  override name = 'ModelerFormatError';
}

const KNOWN_KEYS = new Set([
  'Name',
  'X',
  'Y',
  'Parent',
  'Max',
  'Inputs',
  'InteriorInputs',
  'InputOrder',
  'OutputOrder',
  'Title',
  'ShowPpm',
  'Capacity',
  'Zoom',
  'PanX',
  'PanY',
  'Sps',
]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reads a `.sfmd` file. Throws `ModelerFormatError` when it is not JSON, has
 * no `Data` list, or a node or connection is malformed (a bad index, a
 * missing name).
 */
export function parseModeler(text: string): ModelerSave {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ModelerFormatError('This file is not a Satisfactory Modeler save (it is not JSON).');
  }
  if (!isObject(raw) || !Array.isArray(raw.Data))
    throw new ModelerFormatError(
      'This file is not a Satisfactory Modeler save (it has no "Data" list).',
    );
  const data = raw.Data as unknown[];
  const bad = (i: number, what: string): never => {
    throw new ModelerFormatError(`Node ${i} of the Modeler save ${what}.`);
  };
  const index = (i: number, v: unknown): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= data.length)
      bad(i, `refers to a node that does not exist (${JSON.stringify(v)})`);
    return v as number;
  };
  /** `5`, `[5, 0]`, `[5, [[x, y]]]`, `[5, 0, [[x, y]]]` or `[5, "Item", …]`. */
  const ref = (i: number, v: unknown): ModelerRef => {
    if (!Array.isArray(v)) return { src: index(i, v) };
    const out: ModelerRef = { src: index(i, v[0]) };
    const second = v[1];
    if (typeof second === 'number') out.port = second;
    else if (typeof second === 'string') out.item = second;
    else if (second !== undefined && !Array.isArray(second)) bad(i, 'has a malformed connection');
    return out;
  };
  const ports = (i: number, v: unknown): ModelerSlot[] => {
    if (!Array.isArray(v)) return bad(i, 'has malformed ports');
    return v.map((p) => {
      if (!Array.isArray(p)) return bad(i, 'has a malformed port');
      return { refs: p.map((r) => ref(i, r)) };
    });
  };
  const nodes = data.map((n, i): ModelerNode => {
    if (!isObject(n) || typeof n.Name !== 'string' || n.Name === '') return bad(i, 'has no name');
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const node: ModelerNode = {
      index: i,
      name: n.Name,
      x: num(n.X),
      y: num(n.Y),
      inputs: [],
      interior: [],
      extra: Object.keys(n)
        .filter((k) => !KNOWN_KEYS.has(k))
        .sort(),
    };
    if (n.Parent !== undefined) node.parent = index(i, n.Parent);
    if (typeof n.Title === 'string' && n.Title !== '') node.title = n.Title;
    if (n.Max !== undefined) {
      if (typeof n.Max !== 'string' && typeof n.Max !== 'number') bad(i, 'has a malformed Max');
      node.max = String(n.Max);
    }
    if (Array.isArray(n.Inputs)) node.inputs = ports(i, n.Inputs);
    else if (isObject(n.Inputs))
      node.inputs = Object.keys(n.Inputs)
        .sort()
        .map((item) => {
          const refs = (n.Inputs as Record<string, unknown>)[item];
          if (!Array.isArray(refs)) return bad(i, `has malformed inputs for ${item}`);
          return { item, refs: refs.map((r) => ref(i, r)) };
        });
    else if (n.Inputs !== undefined) bad(i, 'has malformed inputs');
    if (typeof n.Capacity === 'string') node.capacity = n.Capacity;
    if (n.InteriorInputs !== undefined) node.interior = ports(i, n.InteriorInputs);
    if (isObject(n.Sps) && typeof n.Sps.recipe === 'string' && typeof n.Sps.machines === 'string')
      node.sps = { recipe: n.Sps.recipe, machines: n.Sps.machines };
    return node;
  });
  for (const n of nodes) {
    if (n.parent !== undefined && nodes[n.parent]!.name !== OUTPOST)
      bad(n.index, 'sits in a node that is not an Outpost');
  }
  // A parent chain must end: no Outpost inside itself.
  for (const n of nodes) {
    const seen = new Set<number>();
    for (let p = n.parent; p !== undefined; p = nodes[p]!.parent) {
      if (seen.has(p)) bad(n.index, 'sits in a loop of Outposts');
      seen.add(p);
    }
  }
  return { nodes };
}

/** Reads `"3"`, `"7.5"`, `".2"`, `"1/3"` and `"1 1/3"`; undefined for anything else. */
export function parseCount(text: string): number | undefined {
  const s = text.trim();
  let m = /^(\d*)(?:\.(\d+))?$/.exec(s);
  if (m && s !== '' && s !== '.') return Number(`${m[1] || '0'}.${m[2] ?? '0'}`);
  m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[2]) === 0 ? undefined : Number(m[1]) / Number(m[2]);
  m = /^(\d+) (\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[3]) === 0 ? undefined : Number(m[1]) + Number(m[2]) / Number(m[3]);
  return undefined;
}

/**
 * `n` as a fraction string; by default one that reads back as exactly `n`: `"3"`, `"1/3"`,
 * `"2734/3"`. Continued fractions, stopped at the first convergent whose
 * quotient is `n` itself as a float, or within `tolerance` (relative) of it.
 */
export function countText(n: number, tolerance = 0): string {
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`Bad machine count ${n}`);
  if (Number.isInteger(n)) return String(n);
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  let rest = n;
  for (let step = 0; step < 64; step++) {
    const a = Math.floor(rest);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (h1 / k1 === n || Math.abs(h1 / k1 - n) <= tolerance * Math.max(1, n))
      return k1 === 1 ? String(h1) : `${h1}/${k1}`;
    const frac = rest - a;
    if (frac === 0 || !Number.isSafeInteger(h1) || !Number.isSafeInteger(k1)) break;
    rest = 1 / frac;
  }
  return String(n);
}

// ---------------------------------------------------------------- reading

export const OUTPOST = 'Outpost';
/** Belt and pipe logistics: they carry what comes in, and are not kept as nodes (A24 wires belts). */
export const MODELER_LOGISTICS = new Set([
  'Splurger',
  'Splitter',
  'Merger',
  'Priority Splitter',
  'Smart Splitter',
  'Programmable Splitter',
  'Pipeline Junction',
]);
/** Sinks: they take what comes in. */
export const MODELER_SINKS = new Set([
  'Dimensional Depot',
  'Storage Container',
  'Industrial Storage Container',
  'Fluid Buffer',
  'Industrial Fluid Buffer',
  'AWESOME Sink',
]);

/** How the import reads a node. */
export type NodeRole =
  | { kind: 'outpost' }
  | { kind: 'logistics' }
  | { kind: 'sink' }
  | { kind: 'recipe'; recipe: Recipe; machines?: number }
  | { kind: 'resource'; item: string }
  | { kind: 'opaque'; reason: string };

const stripped = (s: string) => s.trim();

/** Recipe and item lookups by Modeler name; Modeler ships our dataset, so names match one to one (A37). */
export interface ModelerNames {
  recipes: Map<string, Recipe[]>;
  recipeById: Map<string, Recipe>;
  items: Map<string, string>;
  itemNames: Map<string, string>;
}

export function modelerNames(model: Pick<Model, 'recipes' | 'items'>): ModelerNames {
  const recipes = new Map<string, Recipe[]>();
  for (const r of [...model.recipes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const list = recipes.get(r.name);
    if (list) list.push(r);
    else recipes.set(r.name, [r]);
  }
  return {
    recipes,
    recipeById: new Map(model.recipes.map((r) => [r.id, r])),
    items: new Map(model.items.map((i) => [i.name, i.id])),
    itemNames: new Map(model.items.map((i) => [i.id, i.name])),
  };
}

/** What each node is, by name. */
export function nodeRoles(save: ModelerSave, names: ModelerNames): NodeRole[] {
  return save.nodes.map((n): NodeRole => {
    if (n.name === OUTPOST) return { kind: 'outpost' };
    if (MODELER_LOGISTICS.has(n.name)) return { kind: 'logistics' };
    if (MODELER_SINKS.has(n.name)) return { kind: 'sink' };
    const count = n.max === undefined ? undefined : parseCount(n.max);
    if (n.sps) {
      const r = names.recipeById.get(n.sps.recipe);
      const c = parseCount(n.sps.machines);
      if (r && c !== undefined) return { kind: 'recipe', recipe: r, machines: c };
    }
    const recipes = names.recipes.get(stripped(n.name));
    if (recipes?.length) {
      if (n.max !== undefined && count === undefined)
        return { kind: 'opaque', reason: `its Max "${n.max}" is not a number` };
      return {
        kind: 'recipe',
        recipe: recipes[0]!,
        ...(count !== undefined ? { machines: count } : {}),
      };
    }
    const item = names.items.get(stripped(n.name));
    if (item && n.inputs.every((s) => s.refs.length === 0)) return { kind: 'resource', item };
    if (/Module\)$/.test(n.name))
      return {
        kind: 'opaque',
        reason:
          'a Modular Miner row: our miners come from the miner model, so what it mines is imported',
      };
    if (/ Stack$/.test(n.name))
      return {
        kind: 'opaque',
        reason: 'a disposal stack: Steam and Flue Gas are dumped freely (A39)',
      };
    return { kind: 'opaque', reason: 'not in our data' };
  });
}

/**
 * The items a connection carries; memoized, cycle-safe. `container` is the
 * Outpost the reading side sits in: a ref to that Outpost reads one of its
 * input ports from inside, a ref to any other Outpost one of its output ports.
 */
function itemResolver(save: ModelerSave, roles: readonly NodeRole[]) {
  const nodes = save.nodes;
  const memo = new Map<string, string[]>();
  const slotItems = (
    slot: ModelerSlot,
    container: number | undefined,
    seen: Set<string>,
  ): string[] =>
    slot.item
      ? [slot.item]
      : [...new Set(slot.refs.flatMap((r) => refItems(r, container, seen)))].sort();
  function refItems(ref: ModelerRef, container: number | undefined, seen: Set<string>): string[] {
    if (ref.item) return [ref.item];
    const src = nodes[ref.src]!;
    const role = roles[ref.src]!;
    const inside = container === ref.src;
    const key = `${ref.src}:${ref.port ?? '-'}:${inside ? 'in' : 'out'}`;
    const known = memo.get(key);
    if (known) return known;
    if (seen.has(key)) return [];
    seen.add(key);
    let out: string[] = [];
    if (role.kind === 'outpost') {
      const slot = (inside ? src.inputs : src.interior)[ref.port ?? 0];
      // An input port is fed from the Outpost's parent; an output port from inside it.
      out = slot ? slotItems(slot, inside ? src.parent : ref.src, seen) : [];
    } else if (role.kind === 'logistics') {
      out = [...new Set(src.inputs.flatMap((s) => slotItems(s, src.parent, seen)))].sort();
    } else if (role.kind === 'recipe') {
      const o = role.recipe.outputs[ref.port ?? 0];
      out = o ? [o.item] : [];
    } else if (role.kind === 'resource') out = [role.item];
    memo.set(key, out);
    return out;
  }
  return {
    refItems: (ref: ModelerRef, container: number | undefined) =>
      refItems(ref, container, new Set()),
  };
}

/** Network node id of a save node, or of an Outpost's port. */
const nodeKey = (i: number) => `n${i}`;
const portKey = (i: number, side: 'in' | 'out', k: number) => `n${i}:${side}${k}`;

/** Item ids in a save are names; this maps them, or keeps a name we don't know. */
const itemId = (names: ModelerNames, name: string) => names.items.get(stripped(name)) ?? name;

/**
 * The save as a network to size (A56): recipe nodes are machines, capped by
 * their `Max`; resource and unknown nodes are sources; sinks and unknown
 * nodes take anything; logistics and Outpost ports carry items through.
 */
export function modelerNetwork(
  save: ModelerSave,
  model: Pick<Model, 'recipes' | 'items'>,
): Network {
  const names = modelerNames(model);
  const roles = nodeRoles(save, names);
  const items = itemResolver(save, roles);
  const nodes: NetworkNode[] = [];
  const edges: NetworkEdge[] = [];
  const opaqueSink = (i: number) => `${nodeKey(i)}:sink`;
  save.nodes.forEach((n, i) => {
    const role = roles[i]!;
    const id = nodeKey(i);
    switch (role.kind) {
      case 'outpost':
        n.inputs.forEach((_, k) => nodes.push({ id: portKey(i, 'in', k), kind: 'pass' }));
        n.interior.forEach((_, k) => nodes.push({ id: portKey(i, 'out', k), kind: 'pass' }));
        break;
      case 'logistics':
        nodes.push({ id, kind: 'pass' });
        break;
      case 'sink': {
        // A Dimensional Depot with a Max uploads Max × Capacity of its one item, like a capped machine.
        const cap = n.max === undefined ? undefined : parseCount(n.max);
        const rate =
          n.capacity === undefined ? undefined : parseCount(n.capacity.replace(/\/min$/, ''));
        const carried = [
          ...new Set(
            n.inputs.flatMap((slot) =>
              slot.refs.flatMap((r) => (slot.item ? [slot.item] : items.refItems(r, n.parent))),
            ),
          ),
        ];
        if (cap !== undefined && rate !== undefined && carried.length === 1)
          nodes.push({
            id,
            kind: 'machine',
            max: cap,
            inputs: [{ item: itemId(names, carried[0]!), rate }],
            outputs: [],
          });
        else nodes.push({ id, kind: 'sink' });
        break;
      }
      case 'resource':
        nodes.push({ id, kind: 'source' });
        break;
      case 'opaque':
        nodes.push({ id, kind: 'source' }, { id: opaqueSink(i), kind: 'sink' });
        break;
      case 'recipe':
        nodes.push({
          id,
          kind: 'machine',
          ...(role.machines !== undefined ? { max: role.machines } : {}),
          inputs: role.recipe.inputs.map((x) => ({ item: x.item, rate: x.rate })),
          outputs: role.recipe.outputs.map((x) => ({ item: x.item, rate: x.rate })),
        });
    }
  });
  /** Where `ref` comes from, in network terms, read from inside `container`. */
  const sourceOf = (ref: ModelerRef, container: number | undefined): string => {
    if (roles[ref.src]!.kind !== 'outpost') return nodeKey(ref.src);
    return portKey(ref.src, container === ref.src ? 'in' : 'out', ref.port ?? 0);
  };
  const connect = (target: string, slot: ModelerSlot, container: number | undefined) => {
    for (const ref of slot.refs) {
      const carried = slot.item ? [slot.item] : items.refItems(ref, container);
      for (const name of carried)
        edges.push({ from: sourceOf(ref, container), to: target, item: itemId(names, name) });
    }
  };
  save.nodes.forEach((n, i) => {
    const role = roles[i]!;
    if (role.kind === 'outpost') {
      n.inputs.forEach((slot, k) => connect(portKey(i, 'in', k), slot, n.parent));
      // What feeds an output port sits inside the Outpost.
      n.interior.forEach((slot, k) => connect(portKey(i, 'out', k), slot, i));
    } else {
      const target = role.kind === 'opaque' ? opaqueSink(i) : nodeKey(i);
      for (const slot of n.inputs) connect(target, slot, n.parent);
    }
  });
  return { nodes, edges };
}

// ---------------------------------------------------------------- import

export interface ModelerReportLine {
  /** The factory it concerns, by name. */
  factory?: string;
  /** The Modeler node, by name and title. */
  node?: string;
  message: string;
}

export interface ModelerImport {
  world: World;
  /** The new factories, in Outpost order. */
  factories: string[];
  report: ModelerReportLine[];
  /** Machine counts sized from the flows (A56), not read from a Max. */
  inferred: number;
}

export interface ModelerImportOptions {
  /** The save's sizing (`sizeNetwork` on `modelerNetwork`); missing = only nodes with a Max get a count. */
  sizing?: NetworkSizing;
  /** Name of the factory for nodes outside every Outpost. */
  looseName?: string;
}

/** Below this a count is rounding noise. */
const EPS = 1e-9;

const label = (n: ModelerNode) => (n.title ? `${n.name} ("${n.title}")` : n.name);

/**
 * Imports a parsed save into `world` (A57): one factory per Outpost, nested
 * as the Outposts are (a lone top-level Outpost that only wraps others is
 * unwrapped), each in manual mode with its recipe nodes as the frozen plan
 * and its net outputs as targets. Items crossing Outposts become pull links.
 * Every node that can't be mapped is listed in the report.
 */
export function importModeler(
  world: World,
  save: ModelerSave,
  model: Pick<Model, 'recipes' | 'items'>,
  options: ModelerImportOptions = {},
): ModelerImport {
  const names = modelerNames(model);
  const roles = nodeRoles(save, names);
  const nodes = save.nodes;
  const report: ModelerReportLine[] = [];
  const children = new Map<number | undefined, number[]>();
  for (const n of nodes) {
    const list = children.get(n.parent);
    if (list) list.push(n.index);
    else children.set(n.parent, [n.index]);
  }
  const kids = (p: number | undefined) => children.get(p) ?? [];
  const outposts = (p: number | undefined) => kids(p).filter((i) => roles[i]!.kind === 'outpost');
  const ownNodes = (p: number | undefined) => kids(p).filter((i) => roles[i]!.kind !== 'outpost');

  // Unwrap a lone top-level Outpost that is only a wrapper: no nodes, no ports, only Outposts.
  let tops = outposts(undefined);
  for (;;) {
    const only = tops.length === 1 && ownNodes(undefined).length === 0 ? tops[0]! : undefined;
    const n = only === undefined ? undefined : nodes[only]!;
    if (!n || ownNodes(only).length > 0 || n.inputs.length + n.interior.length > 0) break;
    if (outposts(only).length === 0) break;
    report.push({
      node: label(n),
      message: 'only holds other Outposts, so they are imported at the top level',
    });
    tops = outposts(only);
  }

  // A factory per Outpost; loose nodes get one of their own.
  let next = world;
  const taken = () => [
    ...next.factories.map((f) => f.id),
    ...next.groups.map((g) => g.id),
    ...next.links.map((l) => l.id),
  ];
  const factoryOf = new Map<number | undefined, string>();
  const order: { at: number | undefined; id: string; parent?: string; name: string }[] = [];
  const add = (at: number | undefined, name: string, parent?: string) => {
    const id = nextId('factory', [...taken(), ...order.map((o) => o.id)]);
    factoryOf.set(at, id);
    order.push({ at, id, name, ...(parent ? { parent } : {}) });
    return id;
  };
  if (ownNodes(undefined).length > 0 || tops.length === 0)
    add(undefined, options.looseName ?? 'Modeler import');
  const walk = (i: number, parent?: string) => {
    const id = add(i, nodes[i]!.title ?? `Outpost ${i}`, parent);
    outposts(i).forEach((k) => walk(k, id));
  };
  tops.forEach((i) => walk(i));
  /** The factory a node belongs to: its nearest Outpost with a factory. */
  const home = (i: number): string => {
    for (let p = nodes[i]!.parent; p !== undefined; p = nodes[p]!.parent) {
      const f = factoryOf.get(p);
      if (f) return f;
    }
    return factoryOf.get(undefined) ?? order[0]!.id;
  };
  const nameOf = new Map(order.map((o) => [o.id, o.name]));

  // Counts: a Max, else the sizing.
  const entries = new Map<string, Map<string, number>>();
  let inferred = 0;
  const unsized: Map<string, number> = new Map();
  const opaque = new Map<string, number>();
  const logistics = new Map<string, number>();
  nodes.forEach((n, i) => {
    const role = roles[i]!;
    const factory = nameOf.get(home(i));
    if (role.kind === 'outpost') return;
    if (role.kind === 'logistics' || role.kind === 'sink') {
      logistics.set(n.name, (logistics.get(n.name) ?? 0) + 1);
      return;
    }
    if (role.kind === 'opaque') {
      const key = `${n.name}\u0000${role.reason}`;
      opaque.set(key, (opaque.get(key) ?? 0) + 1);
      return;
    }
    if (n.extra.length > 0)
      report.push({
        ...(factory ? { factory } : {}),
        node: label(n),
        message: `has Modeler-only settings that are not kept: ${n.extra.join(', ')}`,
      });
    if (role.kind === 'resource') return;
    let machines = role.machines;
    if (machines === undefined) {
      const sized = options.sizing?.machines.get(nodeKey(i));
      if (sized !== undefined && sized > EPS) {
        machines = sized;
        inferred++;
      }
    }
    if (machines === undefined || !(machines > EPS)) {
      if (role.machines === undefined) unsized.set(n.name, (unsized.get(n.name) ?? 0) + 1);
      return;
    }
    if ((names.recipes.get(stripped(n.name))?.length ?? 0) > 1)
      report.push({
        ...(factory ? { factory } : {}),
        node: label(n),
        message: `matches more than one recipe of that name; ${role.recipe.id} was used`,
      });
    const f = home(i);
    let m = entries.get(f);
    if (!m) entries.set(f, (m = new Map()));
    m.set(role.recipe.id, (m.get(role.recipe.id) ?? 0) + machines);
  });
  for (const [name, count] of [...unsized].sort())
    report.push({
      node: name,
      message: `${count === 1 ? 'has' : `${count} nodes have`} no machine count${
        options.sizing ? ' and nothing in the save sizes it' : ' (no Max)'
      }, so ${count === 1 ? 'it is' : 'they are'} left out`,
    });
  for (const [key, count] of [...opaque].sort()) {
    const [name, reason] = key.split('\u0000') as [string, string];
    report.push({
      node: name,
      message: `${count === 1 ? 'is' : `(${count} nodes) are`} left out: ${reason}`,
    });
  }
  if (logistics.size > 0)
    report.push({
      message: `Not kept as nodes, since belts are wired automatically: ${[...logistics]
        .sort()
        .map(([n, c]) => `${c} × ${n}`)
        .join(', ')}`,
    });

  // Links: items made in one factory and used in another, traced through logistics and ports.
  const network = modelerNetwork(save, model);
  const producersOf = new Map<string, NetworkEdge[]>();
  for (const e of network.edges) {
    const list = producersOf.get(e.to);
    if (list) list.push(e);
    else producersOf.set(e.to, [e]);
  }
  const indexOf = (key: string) => Number(/^n(\d+)/.exec(key)![1]);
  const isPort = (key: string) => key.includes(':');
  /** The save nodes that make `item` for `key`, through logistics and ports. */
  const makers = (key: string, item: string, seen = new Set<string>()): number[] => {
    if (seen.has(key)) return [];
    seen.add(key);
    return (producersOf.get(key) ?? [])
      .filter((e) => e.item === item)
      .flatMap((e) => {
        if (isPort(e.from)) return makers(e.from, item, seen);
        const i = indexOf(e.from);
        const role = roles[i]!;
        if (role.kind === 'logistics') return makers(e.from, item, seen);
        return role.kind === 'recipe' ? [i] : [];
      });
  };
  const linkKeys = new Set<string>();
  const links: Link[] = [];
  nodes.forEach((_, i) => {
    if (roles[i]!.kind !== 'recipe') return;
    const to = home(i);
    for (const e of producersOf.get(nodeKey(i)) ?? []) {
      for (const p of isPort(e.from) || roles[indexOf(e.from)]!.kind === 'logistics'
        ? makers(e.from, e.item)
        : [indexOf(e.from)]) {
        if (roles[p]!.kind !== 'recipe') continue;
        const from = home(p);
        const key = `${from}\u0000${to}\u0000${e.item}`;
        if (from === to || linkKeys.has(key)) continue;
        linkKeys.add(key);
        links.push({ id: '', from, to, item: e.item, mode: { kind: 'pull' } });
      }
    }
  });
  links.sort((a, b) =>
    a.from !== b.from
      ? a.from < b.from
        ? -1
        : 1
      : a.to !== b.to
        ? a.to < b.to
          ? -1
          : 1
        : a.item < b.item
          ? -1
          : a.item > b.item
            ? 1
            : 0,
  );

  // What each factory sends to others, per item: the sized flows leaving it.
  const keyHome = (key: string): string => {
    const i = indexOf(key);
    return isPort(key) ? (factoryOf.get(i) ?? home(i)) : home(i);
  };
  const exported = new Map<string, number>();
  const linkedOut = new Set(links.map((l) => `${l.from}\u0000${l.item}`));
  network.edges.forEach((e, k) => {
    const flow = options.sizing?.flows[k] ?? 0;
    const from = keyHome(e.from);
    if (flow > 0 && from !== keyHome(e.to)) {
      const key = `${from}\u0000${e.item}`;
      exported.set(key, (exported.get(key) ?? 0) + flow);
    }
  });

  // Build the factories.
  const recipeById = names.recipeById;
  const made: Factory[] = order.map((o) => {
    const plan: ManualEntry[] = [...(entries.get(o.id) ?? new Map<string, number>())]
      .map(([recipe, machines]) => ({ recipe, machines }))
      .sort((a, b) => (a.recipe < b.recipe ? -1 : 1));
    const net = new Map<string, number>();
    for (const e of plan) {
      const r = recipeById.get(e.recipe)!;
      for (const x of r.outputs) net.set(x.item, (net.get(x.item) ?? 0) + x.rate * e.machines);
      for (const x of r.inputs) net.set(x.item, (net.get(x.item) ?? 0) - x.rate * e.machines);
    }
    // Net outputs, less what links carry away: manual plans serve targets before links (A36).
    const targets = [...net]
      .map(([item, rate]) => {
        const key = `${o.id}\u0000${item}`;
        const sent = options.sizing ? (exported.get(key) ?? 0) : linkedOut.has(key) ? rate : 0;
        return { item, rate: rate - sent };
      })
      .filter((t) => t.rate > 1e-6 && t.item !== MW_ITEM_ID)
      .sort((a, b) => (a.item < b.item ? -1 : 1));
    // What it takes that no link brings (resource nodes, rows left out, open inputs): imported freely.
    const linkedIn = new Set(links.filter((l) => l.to === o.id).map((l) => l.item));
    const imports = [...net]
      .filter(([item, rate]) => rate < -1e-6 && item !== MW_ITEM_ID && !linkedIn.has(item))
      .map(([item]) => ({ item }))
      .sort((a, b) => (a.item < b.item ? -1 : 1));
    const f = createFactory(o.id, o.name);
    f.request = { targets };
    f.unassignedImports = imports;
    if (o.parent) f.parentId = o.parent;
    if (plan.length > 0) f.manual = { enabled: true, frozen: plan, edits: [] };
    else
      report.push({
        factory: o.name,
        message: 'has no recipe nodes with a machine count, so it is empty',
      });
    return f;
  });
  next = { ...next, factories: [...next.factories, ...made] };
  const ids = taken();
  for (const l of links) {
    l.id = nextId('link', ids);
    ids.push(l.id);
  }
  next = { ...next, links: [...next.links, ...links] };
  return { world: next, factories: made.map((f) => f.id), report, inferred };
}

// ---------------------------------------------------------------- writing

/** One node of a sheet, keyed by the sheet's own node id. */
export type SheetNode =
  | { key: string; kind: 'recipe'; recipe: string; machines: number; x: number; y: number }
  /** An input the factory takes in (an import, a link, a sub-factory's output). */
  | { key: string; kind: 'in'; item: string; x: number; y: number }
  /** An output it hands on (a target, a link). */
  | { key: string; kind: 'out'; item: string; x: number; y: number };

/** One factory's flowchart, laid out, as `writeModeler` reads it. */
export interface ModelerSheet {
  factory: string;
  nodes: SheetNode[];
  /** Belts: `from` → `to` by node key, carrying `item`. */
  belts: { from: string; to: string; item: string }[];
}

interface RawNode {
  Name: string;
  X: number;
  Y: number;
  Parent?: number;
  Title?: string;
  Max?: string;
  Inputs?: Record<string, unknown[]> | unknown[][];
  InteriorInputs?: unknown[][];
  Sps?: { recipe: string; machines: string };
}

/**
 * Writes sheets as a Modeler save (A58), calculator set to `Manual`. One
 * sheet is one Outpost holding its nodes; several are Outposts inside a
 * "World" Outpost, nested by `parentId` and wired along `links` (through
 * the Outposts' ports when the two factories sit in different Outposts).
 * Each recipe group is one node named by its recipe, with our recipe and
 * exact count in `Sps`; an extractor of ours (no Modeler name) is Modeler's
 * miner of the resource. `Max` goes only where Modeler needs it (A59).
 */
export function writeModeler(
  world: Pick<World, 'factories' | 'links'>,
  sheets: readonly ModelerSheet[],
  model: Pick<Model, 'recipes' | 'items'>,
): string {
  const names = modelerNames(model);
  const itemName = (id: string) => names.itemNames.get(id) ?? id;
  const data: RawNode[] = [];
  const byFactory = new Map(world.factories.map((f) => [f.id, f]));
  const sheetOf = new Map(sheets.map((s) => [s.factory, s]));
  const included = new Set(sheets.map((s) => s.factory));
  const multi = sheets.length > 1;
  const root = multi ? data.push({ Name: OUTPOST, X: 0, Y: 0, Title: 'World' }) - 1 : undefined;
  /** Nearest included ancestor, else the root. */
  const parentOf = (id: string): string | undefined => {
    for (let p = byFactory.get(id)?.parentId; p; p = byFactory.get(p)?.parentId)
      if (included.has(p)) return p;
    return undefined;
  };
  // Outposts, parents before children, each at a spot on its parent's canvas.
  const outpostOf = new Map<string, number>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (outpostOf.has(id)) return;
    const p = parentOf(id);
    if (p) visit(p);
    const siblings = order.filter((o) => parentOf(o) === p).length;
    const node: RawNode = {
      Name: OUTPOST,
      X: siblings * 240,
      Y: 0,
      Title: byFactory.get(id)?.name ?? id,
    };
    const parent = p ? outpostOf.get(p) : root;
    if (parent !== undefined) node.Parent = parent;
    outpostOf.set(id, data.push(node) - 1);
    order.push(id);
  };
  [...included].sort().forEach(visit);

  // Ports: one input and one output port per item per Outpost, made on demand.
  const inPorts = new Map<string, Map<string, number>>();
  const outPorts = new Map<string, Map<string, number>>();
  const port = (
    ports: Map<string, Map<string, number>>,
    factory: string,
    item: string,
    side: 'in' | 'out',
  ) => {
    let m = ports.get(factory);
    if (!m) ports.set(factory, (m = new Map()));
    let k = m.get(item);
    if (k === undefined) {
      const o = data[outpostOf.get(factory)!]!;
      const list = (side === 'in' ? (o.Inputs ??= []) : (o.InteriorInputs ??= [])) as unknown[][];
      k = list.push([]) - 1;
      m.set(item, k);
    }
    return k;
  };

  // Nodes. Every recipe node carries our recipe and exact count in `Sps`,
  // so a file we wrote reads back exactly; `Max` is set later, only where
  // Modeler's Manual calculator needs it.
  const nodeIndex = new Map<string, number>();
  const unknowns = new Map<number, Unknown>();
  /** Extractors Modeler can't wire (it mines only the raw resource): their counts, in parts per minute. */
  const standalone = new Map<number, number>();
  const key = (factory: string, node: string) => `${factory}\u0000${node}`;
  for (const id of order) {
    const sheet = sheetOf.get(id)!;
    const parent = outpostOf.get(id)!;
    for (const n of sheet.nodes) {
      if (n.kind !== 'recipe') continue;
      const r = names.recipeById.get(n.recipe);
      const modelerName = r && r.source === 'dataset' ? r.name : undefined;
      const sps = { recipe: n.recipe, machines: countText(n.machines) };
      const at = { X: Math.round(n.x), Y: Math.round(n.y), Parent: parent };
      const mined = r?.extracts?.item ?? r?.outputs[0]?.item ?? n.recipe;
      const raw: RawNode = modelerName
        ? { Name: modelerName, ...at, Sps: sps }
        : { Name: itemName(mined), ...at, Title: r?.name ?? n.recipe, Sps: sps };
      const i = data.push(raw) - 1;
      nodeIndex.set(key(id, n.key), i);
      if (modelerName) {
        const rates = (list: Recipe['inputs']) =>
          new Map(list.map((x) => [itemName(x.item), x.rate] as const));
        unknowns.set(i, {
          inputs: rates(r!.inputs),
          outputs: rates(r!.outputs),
          value: n.machines,
          rank: 1,
        });
      } else {
        // An extractor of ours is Modeler's miner of the resource, counted in
        // parts per minute; it takes nothing and makes only the resource.
        const ppm = (r?.extracts?.rate ?? r?.outputs[0]?.rate ?? 0) * n.machines;
        if (r && r.outputs.length === 1 && r.outputs[0]!.item === mined) {
          unknowns.set(i, {
            inputs: new Map(),
            outputs: new Map([[itemName(mined), 1]]),
            value: ppm,
            rank: 2,
          });
        } else standalone.set(i, ppm);
      }
    }
  }
  const addInput = (consumer: RawNode, item: string, ref: unknown) => {
    const inputs = (consumer.Inputs ??= {}) as Record<string, unknown[]>;
    (inputs[itemName(item)] ??= []).push(ref);
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  // Belts inside each sheet. What Modeler's node for one of our extractors
  // doesn't make or take comes in, or goes out, through the Outpost's ports.
  for (const id of order) {
    const sheet = sheetOf.get(id)!;
    const kinds = new Map(sheet.nodes.map((n) => [n.key, n]));
    const o = outpostOf.get(id)!;
    const wired = (n: SheetNode, item: string, side: 'in' | 'out') => {
      if (n.kind !== 'recipe') return true;
      const u = unknowns.get(nodeIndex.get(key(id, n.key))!);
      return u !== undefined && (side === 'in' ? u.inputs : u.outputs).has(itemName(item));
    };
    interface Belt {
      item: string;
      src: unknown;
      to: { node: number } | { port: number };
      x: number;
      y: number;
    }
    const belts: Belt[] = [];
    for (const b of [...sheet.belts].sort((a, c) =>
      a.from + a.to + a.item < c.from + c.to + c.item ? -1 : 1,
    )) {
      const from = kinds.get(b.from);
      const to = kinds.get(b.to);
      // Modeler has no part for power: a generator's MW stays on its node.
      if (!from || !to || from.kind === 'out' || to.kind === 'in' || b.item === MW_ITEM_ID)
        continue;
      const src =
        from.kind === 'recipe' && wired(from, b.item, 'out')
          ? [nodeIndex.get(key(id, from.key))!, itemName(b.item)]
          : [o, port(inPorts, id, b.item, 'in')];
      const dest =
        to.kind === 'recipe' && wired(to, b.item, 'in')
          ? { node: nodeIndex.get(key(id, to.key))! }
          : { port: port(outPorts, id, b.item, 'out') };
      belts.push({ item: b.item, src, to: dest, x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    }
    // Where several makers feed several takers of an item, belts alone leave
    // Modeler unsure how much each one carries: they meet at a Splurger.
    const groups = new Map<string, Belt[]>();
    const find = new Map<string, string>();
    const root = (k: string): string => {
      const p = find.get(k) ?? k;
      if (p === k) return k;
      const r = root(p);
      find.set(k, r);
      return r;
    };
    const srcKey = (b: Belt) => `s${JSON.stringify(b.src)}`;
    const toKey = (b: Belt) => `t${JSON.stringify(b.to)}:${b.item}`;
    for (const b of belts) {
      const a = root(srcKey(b));
      const c = root(toKey(b));
      if (a !== c) find.set(a < c ? c : a, a < c ? a : c);
    }
    for (const b of belts) {
      const g = root(srcKey(b));
      const list = groups.get(g);
      if (list) list.push(b);
      else groups.set(g, [b]);
    }
    for (const group of groups.values()) {
      const srcs: unknown[] = [];
      for (const b of group) if (!srcs.some((s) => same(s, b.src))) srcs.push(b.src);
      const tos = new Set(group.map(toKey));
      let via: ((b: Belt) => unknown) | undefined;
      if (srcs.length > 1 && tos.size > 1) {
        const hub =
          data.push({
            Name: SPLURGER,
            X: Math.round(group.reduce((s, b) => s + b.x, 0) / group.length),
            Y: Math.round(group.reduce((s, b) => s + b.y, 0) / group.length),
            Parent: o,
            Inputs: [srcs],
          }) - 1;
        via = () => [hub, 0];
      }
      const done = new Set<string>();
      for (const b of group) {
        const ref = via ? via(b) : b.src;
        const k = `${toKey(b)}:${JSON.stringify(ref)}`;
        if (done.has(k)) continue;
        done.add(k);
        if ('node' in b.to) addInput(data[b.to.node]!, b.item, ref);
        else (data[o]!.InteriorInputs![b.to.port] as unknown[]).push(ref);
      }
    }
  }

  // Links between included factories, through the Outposts' ports.
  const chain = (id: string) => {
    const out: string[] = [];
    for (let p: string | undefined = id; p; p = parentOf(p)) out.push(p);
    return out; // id first, top last
  };
  for (const l of [...world.links].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!included.has(l.from) || !included.has(l.to) || l.from === l.to) continue;
    const up = chain(l.from);
    const down = chain(l.to);
    const common = up.find((x) => down.includes(x));
    // Climb from the producer to just below the shared Outpost.
    const climb = up.slice(0, common ? up.indexOf(common) : up.length);
    const descend = down.slice(0, common ? down.indexOf(common) : down.length);
    let ref: unknown;
    if (climb.length === 0) {
      // The producer is the shared Outpost: the link leaves from its inside, into the consumer's branch.
      const sheet = sheetOf.get(l.from)!;
      const maker = sheet.nodes.find(
        (n) =>
          n.kind === 'recipe' &&
          unknowns.get(nodeIndex.get(key(l.from, n.key))!)?.outputs.has(itemName(l.item)),
      );
      if (!maker) continue;
      ref = [nodeIndex.get(key(l.from, maker.key)), itemName(l.item)];
    } else {
      ref = [outpostOf.get(climb[0]!), port(outPorts, climb[0]!, l.item, 'out')];
      for (const p of climb.slice(1)) {
        const k = port(outPorts, p, l.item, 'out');
        (data[outpostOf.get(p)!]!.InteriorInputs![k] as unknown[]).push(ref);
        ref = [outpostOf.get(p), k];
      }
    }
    if (descend.length === 0) {
      // The consumer is the shared Outpost: its recipes take the item.
      const sheet = sheetOf.get(l.to)!;
      for (const n of sheet.nodes)
        if (
          n.kind === 'recipe' &&
          unknowns.get(nodeIndex.get(key(l.to, n.key))!)?.inputs.has(itemName(l.item))
        )
          addInput(data[nodeIndex.get(key(l.to, n.key))!]!, l.item, ref);
      continue;
    }
    for (const p of [...descend].reverse()) {
      const k = port(inPorts, p, l.item, 'in');
      const slot = (data[outpostOf.get(p)!]!.Inputs as unknown[][])[k]!;
      if (!slot.some((r) => JSON.stringify(r) === JSON.stringify(ref))) slot.push(ref);
      ref = [outpostOf.get(p), k];
    }
  }

  // Modeler reads a second identical connection as unplugging the first, and
  // then fails to load: each connection is written once.
  const once = (refs: unknown[]) => refs.filter((r, i) => refs.findIndex((x) => same(x, r)) === i);
  for (const n of data) {
    if (Array.isArray(n.Inputs)) n.Inputs = n.Inputs.map(once);
    else if (n.Inputs)
      for (const [item, refs] of Object.entries(n.Inputs)) n.Inputs[item] = once(refs);
    if (n.InteriorInputs) n.InteriorInputs = n.InteriorInputs.map(once);
  }

  openUnbalanced(data, unknowns);

  // Max: just enough counts for Modeler's Manual calculator to work out
  // every other one from the belts (A58).
  for (const i of manualPins(data, unknowns)) {
    const u = unknowns.get(i)!;
    data[i]!.Max = countText(u.value, MAX_TOL);
  }
  for (const [i, ppm] of standalone) data[i]!.Max = countText(ppm, MAX_TOL);

  const save = {
    Version: '1.0',
    Solver: 'Manual',
    Zoom: 1,
    PanX: 0,
    PanY: 0,
    Outpost: 0,
    Data: data,
  };
  return JSON.stringify(save);
}

const SPLURGER = 'Splurger';

/** A written node Modeler's Manual calculator solves for: its rates per unit of its count. */
interface Unknown {
  inputs: Map<string, number>;
  outputs: Map<string, number>;
  /** Our count, in Modeler's units. */
  value: number;
  /** Pin order: 0 makes a factory output, 1 another machine, 2 an extractor. */
  rank: number;
}

/** Below this (relative to a row's largest coefficient) a coefficient is rounding noise. */
const PIN_TOL = 1e-9;

/** Where belts join makers and takers of one item, as Modeler balances them. */
interface Junction {
  /** Slots: `in:i:Item`, `out:i:Item`, `h:i` (Splurger), `ip:o:k` / `op:o:k` (Outpost ports). */
  members: string[];
  /** It reaches an Outpost port with nothing on its other side, which takes or brings any amount. */
  open: boolean;
}

function junctions(data: readonly RawNode[]): Junction[] {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k) ?? k;
    if (p === k) return k;
    const r = find(p);
    parent.set(k, r);
    return r;
  };
  const join = (a: string, b: string) => {
    const x = find(a);
    const y = find(b);
    if (x !== y) parent.set(x < y ? y : x, x < y ? x : y);
  };
  const slots = new Set<string>();
  /** Connections each side of each Outpost port has: [outside, inside]. */
  const sides = new Map<string, [number, number]>();
  const side = (slot: string, outside: boolean) => {
    const s = sides.get(slot) ?? [0, 0];
    s[outside ? 0 : 1]++;
    sides.set(slot, s);
  };
  const producer = (ref: unknown, container: number | undefined): string | undefined => {
    if (!Array.isArray(ref)) return undefined;
    const [src, p] = ref as [number, unknown];
    const n = data[src];
    if (!n) return undefined;
    if (n.Name === OUTPOST) {
      const slot = `${src === container ? 'ip' : 'op'}:${src}:${String(p)}`;
      side(slot, src !== container);
      return slot;
    }
    if (n.Name === SPLURGER) return `h:${src}`;
    return typeof p === 'string' ? `out:${src}:${p}` : undefined;
  };
  const connect = (slot: string, refs: readonly unknown[], container: number | undefined) => {
    for (const ref of refs) {
      const from = producer(ref, container);
      if (from === undefined) continue;
      slots.add(slot).add(from);
      join(slot, from);
    }
  };
  data.forEach((n, i) => {
    if (n.Name === OUTPOST) {
      ((n.Inputs ?? []) as unknown[][]).forEach((refs, k) => {
        for (let j = 0; j < refs.length; j++) side(`ip:${i}:${k}`, true);
        connect(`ip:${i}:${k}`, refs, n.Parent);
      });
      (n.InteriorInputs ?? []).forEach((refs, k) => {
        for (let j = 0; j < refs.length; j++) side(`op:${i}:${k}`, false);
        connect(`op:${i}:${k}`, refs, i);
      });
    } else if (n.Name === SPLURGER) {
      connect(`h:${i}`, ((n.Inputs ?? []) as unknown[][]).flat(), n.Parent);
    } else if (n.Inputs && !Array.isArray(n.Inputs)) {
      for (const [item, refs] of Object.entries(n.Inputs))
        connect(`in:${i}:${item}`, refs, n.Parent);
    }
  });
  const groups = new Map<string, string[]>();
  for (const s of [...slots].sort()) {
    const r = find(s);
    const list = groups.get(r);
    if (list) list.push(s);
    else groups.set(r, [s]);
  }
  return [...groups.values()].map((members) => ({
    members,
    open: members.some((s) => {
      if (!s.startsWith('ip:') && !s.startsWith('op:')) return false;
      const lr = sides.get(s);
      return !lr || lr[0] === 0 || lr[1] === 0;
    }),
  }));
}

/** A junction's balance over the counts: what is made minus what is taken, by node; undefined if it can't be told. */
function balance(j: Junction, unknowns: ReadonlyMap<number, Unknown>) {
  const row = new Map<number, number>();
  for (const s of j.members) {
    const [kind, at, ...rest] = s.split(':');
    if (kind !== 'in' && kind !== 'out') continue;
    const i = Number(at);
    const u = unknowns.get(i);
    const rate = u && (kind === 'in' ? u.inputs : u.outputs).get(rest.join(':'));
    if (rate === undefined) return undefined;
    row.set(i, (row.get(i) ?? 0) + (kind === 'out' ? rate : -rate));
  }
  return row;
}

/**
 * Leaves every junction balanced over our counts: a manual plan (A36) may
 * make more of an item than it uses, or less. The extra leaves through an
 * output port of the Outpost; the shortfall comes in through an input port.
 * Otherwise Modeler would balance it anyway, at other counts than ours.
 */
function openUnbalanced(data: RawNode[], unknowns: ReadonlyMap<number, Unknown>) {
  for (const j of junctions(data)) {
    if (j.open) continue;
    const row = balance(j, unknowns);
    if (!row) continue;
    let net = 0;
    let scale = 0;
    for (const [i, c] of row) {
      net += c * unknowns.get(i)!.value;
      scale = Math.max(scale, Math.abs(c * unknowns.get(i)!.value));
    }
    if (Math.abs(net) <= BALANCE_TOL * Math.max(1, scale)) continue;
    const want = net > 0 ? 'out' : 'in';
    const slot = j.members.find((s) => s.startsWith(`${want}:`));
    if (!slot) continue;
    const [, at, ...rest] = slot.split(':');
    const i = Number(at);
    const item = rest.join(':');
    const o = data[i]!.Parent;
    if (o === undefined) continue;
    if (want === 'out') (data[o]!.InteriorInputs ??= []).push([[i, item]]);
    else {
      const ports = (data[o]!.Inputs ??= []) as unknown[][];
      const k = ports.push([]) - 1;
      ((data[i]!.Inputs as Record<string, unknown[]>)[item] ??= []).push([o, k]);
    }
  }
}

/** A `Max` may be this far (relative) from our count, for a shorter fraction; `Sps` keeps the exact one. */
const MAX_TOL = 1e-9;

/** A balance this close to zero (relative to its largest flow) holds. */
const BALANCE_TOL = 1e-6;

/**
 * The nodes that get a `Max` (A58). Modeler's Manual calculator solves one
 * linear system: at every junction what is made equals what is taken, and
 * every `Max` fixes a count. It drops a `Max` that disagrees with the
 * others (arbitrarily) and shows `?` where nothing fixes a count. So this
 * picks a smallest set of counts that, with the balances, fixes every other
 * one: factory outputs' makers first, extractors last, in file order
 * otherwise. An open junction has no balance.
 */
function manualPins(data: readonly RawNode[], unknowns: ReadonlyMap<number, Unknown>): number[] {
  const rows: Map<number, number>[] = [];
  const rank = new Map([...unknowns].map(([i, u]) => [i, u.rank]));
  for (const j of junctions(data)) {
    const row = balance(j, unknowns);
    if (row && j.members.some((m) => m.startsWith('op:')))
      for (const s of j.members) if (s.startsWith('out:')) rank.set(Number(s.split(':')[1]), 0);
    if (!j.open && row && row.size > 0) rows.push(row);
  }

  // Forward elimination; then pin counts until every one is fixed.
  const basis: { pivot: number; row: Map<number, number> }[] = [];
  const add = (row: Map<number, number>): boolean => {
    const r = new Map(row);
    let scale = Math.max(...[...r.values()].map(Math.abs));
    for (const b of basis) {
      const c = r.get(b.pivot);
      if (c === undefined) continue;
      const f = c / b.row.get(b.pivot)!;
      for (const [v, x] of b.row) {
        const y = (r.get(v) ?? 0) - f * x;
        scale = Math.max(scale, Math.abs(y));
        r.set(v, y);
      }
      r.delete(b.pivot);
    }
    let pivot: number | undefined;
    for (const [v, x] of r) {
      if (Math.abs(x) <= PIN_TOL * scale) r.delete(v);
      else if (pivot === undefined || Math.abs(x) > Math.abs(r.get(pivot)!)) pivot = v;
    }
    if (pivot === undefined) return false;
    basis.push({ pivot, row: r });
    return true;
  };
  for (const row of rows) add(row);
  const pins: number[] = [];
  const order = [...unknowns.keys()].sort((a, b) => rank.get(a)! - rank.get(b)! || a - b);
  for (const i of order) {
    if (basis.length >= unknowns.size) break;
    if (add(new Map([[i, 1]]))) pins.push(i);
  }
  return pins.sort((a, b) => a - b);
}
