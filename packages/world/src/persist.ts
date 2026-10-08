/**
 * Saving and sharing the `World` document (PLAN M9): its JSON form, reading
 * it back (migrating older versions and checking the shape), and the
 * one-factory world that "share this factory only" exports. Pure: storage,
 * files and URLs belong to the app.
 */
import { OBJECTIVE_IDS } from '@sps/solver';
import {
  createWorld,
  type Factory,
  type FactoryRequest,
  type Link,
  type UnassignedImport,
  type World,
} from './document';
import { migrateWorld, WorldMigrationError } from './migrate';

/** A save that can't be read: not JSON, not a world, or a newer version. */
export class WorldLoadError extends Error {}

/** The world as JSON: indented for files, compact for links and local saves. */
export function serializeWorld(world: World, pretty = false): string {
  return JSON.stringify(world, null, pretty ? 2 : undefined);
}

/** Reads a saved world: parses it, migrates it to `WORLD_VERSION` and checks its shape. */
export function parseWorld(text: string): World {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new WorldLoadError(`Not valid JSON: ${(e as Error).message}`);
  }
  return loadWorld(doc);
}

/** `parseWorld` for an already-parsed document. */
export function loadWorld(doc: unknown): World {
  let world: World;
  try {
    world = migrateWorld(doc);
  } catch (e) {
    if (e instanceof WorldMigrationError) throw new WorldLoadError(e.message);
    throw e;
  }
  const problems = shapeProblems(world);
  if (problems.length)
    throw new WorldLoadError(
      `Not a valid world: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '; …' : ''}.`,
    );
  return world;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isOpt = (v: unknown, test: (v: unknown) => boolean) => v === undefined || test(v);
const isNumMap = (v: unknown) => isObj(v) && Object.values(v).every(isNum);
const isBoolMap = (v: unknown) => isObj(v) && Object.values(v).every(isBool);
const isTier = (v: unknown) => v === null || isStr(v);
const isStack = (v: unknown) =>
  Array.isArray(v) && v.every((o) => (OBJECTIVE_IDS as readonly unknown[]).includes(o));
const isResourceMap = (v: unknown) =>
  isObj(v) &&
  Object.values(v).every(
    (l) => isObj(l) && isBool(l.enabled) && isOpt(l.max, (m) => isNum(m) && m >= 0),
  );
const isStrMap = (v: unknown) => isObj(v) && Object.values(v).every(isStr);
const isAreas = (v: unknown) =>
  isObj(v) &&
  isOpt(v.off, (o) => o === true) &&
  isOpt(v.names, isStrMap) &&
  isOpt(v.moves, isStrMap);
const isRate = (v: unknown) => isObj(v) && isStr(v.item) && isNum(v.rate);

/**
 * What is wrong with a migrated document's shape, so a bad file fails on
 * load instead of somewhere in the solver. References between factories,
 * groups and links are not checked here: world resolution reports those as
 * diagnostics, and the world still loads.
 */
function shapeProblems(w: World): string[] {
  const out: string[] = [];
  const doc = w as unknown as Record<string, unknown>;
  const list = (key: string, check: (v: Record<string, unknown>) => boolean) => {
    const v = doc[key];
    if (!Array.isArray(v)) return out.push(`"${key}" is not a list`);
    v.forEach((x, k) => {
      if (!isObj(x) || !check(x)) out.push(`${key}[${k}] is malformed`);
    });
    const ids = v.map((x) => (isObj(x) ? x.id : undefined));
    const dup = ids.find((id, k) => ids.indexOf(id) !== k);
    if (dup !== undefined) out.push(`${key} repeat the id "${String(dup)}"`);
  };
  if (!isStr(w.meta.dataHash)) out.push('"meta.dataHash" is not a string');
  list(
    'factories',
    (f) =>
      isStr(f.id) &&
      isStr(f.name) &&
      isOpt(f.groupId, isStr) &&
      isOpt(f.parentId, isStr) &&
      isOpt(f.collapsed, isBool) &&
      isRequest(f.request) &&
      Array.isArray(f.unassignedImports) &&
      f.unassignedImports.every((i) => isObj(i) && isStr(i.item) && isOpt(i.cap, isNum)) &&
      isResourceMap(f.resources) &&
      isNum(f.priority) &&
      isStr(f.notes) &&
      Array.isArray(f.tweaks) &&
      f.tweaks.every(isTweak) &&
      isOpt(f.manual, isManual) &&
      isOpt(f.built, isBuilt) &&
      isOpt(f.areas, isAreas),
  );
  list(
    'groups',
    (g) => isStr(g.id) && isStr(g.name) && isOpt(g.parentId, isStr) && isBool(g.collapsed),
  );
  list(
    'links',
    (l) =>
      isStr(l.id) &&
      isStr(l.from) &&
      isStr(l.to) &&
      isStr(l.item) &&
      isObj(l.mode) &&
      (l.mode.kind === 'pull' || (l.mode.kind === 'fixed' && isNum(l.mode.rate))) &&
      isOpt(l.transport, (t) => isObj(t) && isStr(t.kind) && isOpt(t.tier, isNum)) &&
      isOpt(l.nested, (n) => n === true),
  );
  const d = doc.defaults;
  if (
    !isObj(d) ||
    !isStack(d.objectives) ||
    !isNum(d.tolerance) ||
    !isBool(d.alternates) ||
    !isBool(d.wholeMachines) ||
    !isBool(d.costImports) ||
    !isBool(d.avoidFluidByproducts) ||
    !isOpt(d.minerFluids, isMinerFluids) ||
    !isOpt(d.minerFluidSupply, isMinerSupply) ||
    !isBoolMap(d.recipes) ||
    !isTier(d.maxTier)
  )
    out.push('"defaults" is malformed');
  if (!isNumMap(doc.nodePool)) out.push('"nodePool" is malformed');
  return out;
}

const isMinerFluids = (v: unknown) => v === 'any' || v === 'water' || v === 'none';
const isMinerSupply = (v: unknown) => v === 'local' || v === 'outside';

function isTweak(t: unknown): boolean {
  if (!isObj(t)) return false;
  if (t.kind === 'ban') return isStr(t.recipe);
  if (t.kind === 'swap') return isStr(t.from) && isStr(t.to);
  if (t.kind === 'import') return isStr(t.item);
  return false;
}

const isEntries = (v: unknown, min: number) =>
  Array.isArray(v) &&
  v.every((e) => isObj(e) && isStr(e.recipe) && isNum(e.machines) && e.machines >= min);

function isManual(m: unknown): boolean {
  return isObj(m) && isBool(m.enabled) && isEntries(m.frozen, 0) && isEntries(m.edits, 0);
}

function isBuilt(b: unknown): boolean {
  return (
    isObj(b) &&
    isEntries(b.entries, 0) &&
    Array.isArray(b.inputs) &&
    b.inputs.every(isRate) &&
    Array.isArray(b.outputs) &&
    b.outputs.every(isRate) &&
    isStr(b.dataHash) &&
    isStr(b.markedAt) &&
    isObj(b.fingerprint) &&
    isStr(b.fingerprint.factory) &&
    isStr(b.fingerprint.world) &&
    isStr(b.fingerprint.links)
  );
}

function isRequest(r: unknown): boolean {
  return (
    isObj(r) &&
    Array.isArray(r.targets) &&
    r.targets.every(isRate) &&
    isOpt(r.objectives, isStack) &&
    isOpt(r.tolerance, isNum) &&
    isOpt(r.alternates, isBool) &&
    isOpt(r.wholeMachines, isBool) &&
    isOpt(r.costImports, isBool) &&
    isOpt(r.avoidFluidByproducts, isBool) &&
    isOpt(r.minerFluids, isMinerFluids) &&
    isOpt(r.minerFluidSupply, isMinerSupply) &&
    isOpt(r.recipes, isBoolMap) &&
    isOpt(r.maxTier, isTier)
  );
}

/**
 * "Share this factory only" (PLAN M9): a world holding just this factory,
 * with the world's defaults, node pool and data hash, so it plans the same
 * on its own. Its links become boundary conditions:
 * - an incoming link becomes an unassigned import of its item, capped at a
 *   fixed link's rate, uncapped for a pull link (§4.2);
 * - an outgoing link becomes a target: a fixed link's rate, or a pull link's
 *   resolved rate from `pullRates` (by link id). A pull link with no
 *   resolved rate is dropped.
 * Targets and imports of the same item are merged; what a child sends its
 * parent counts toward its own target (A50). The factory leaves its group
 * and its parent, since neither is shared.
 */
export function extractFactory(
  world: World,
  factoryId: string,
  pullRates: Readonly<Record<string, number>> = {},
): World {
  const factory = world.factories.find((f) => f.id === factoryId);
  if (!factory) throw new Error(`Unknown factory "${factoryId}".`);
  const into = world.links.filter((l) => l.to === factoryId && l.from !== factoryId);
  const out = world.links.filter((l) => l.from === factoryId && l.to !== factoryId);

  const targets = new Map<string, number>();
  for (const t of factory.request.targets) targets.set(t.item, (targets.get(t.item) ?? 0) + t.rate);
  // What a child sends its parent counts toward its own target (A50).
  const toParent = new Map<string, number>();
  for (const l of out) {
    const rate = l.mode.kind === 'fixed' ? l.mode.rate : pullRates[l.id];
    if (rate === undefined || !(rate > 0)) continue;
    if (l.to === factory.parentId) toParent.set(l.item, (toParent.get(l.item) ?? 0) + rate);
    else targets.set(l.item, (targets.get(l.item) ?? 0) + rate);
  }
  for (const [item, rate] of toParent) {
    const own = factory.request.targets
      .filter((t) => t.item === item)
      .reduce((s, t) => s + t.rate, 0);
    targets.set(item, (targets.get(item) ?? 0) + Math.max(0, rate - own));
  }

  const imports = new Map<string, number | undefined>();
  const addImport = (item: string, cap: number | undefined) => {
    if (!imports.has(item)) return imports.set(item, cap);
    const was = imports.get(item);
    imports.set(item, was === undefined || cap === undefined ? undefined : was + cap);
  };
  for (const i of factory.unassignedImports) addImport(i.item, i.cap);
  for (const l of [...into].sort(byId)) addImport(l.item, linkCap(l));

  const request: FactoryRequest = {
    ...structuredCopy(factory.request),
    targets: [...targets].map(([item, rate]) => ({ item, rate })),
  };
  const unassignedImports: UnassignedImport[] = [...imports].map(([item, cap]) =>
    cap === undefined ? { item } : { item, cap },
  );
  const shared: Factory = { ...structuredCopy(factory), request, unassignedImports };
  delete shared.groupId;
  delete shared.parentId;
  delete shared.collapsed;
  return {
    ...createWorld(world.meta.dataHash),
    factories: [shared],
    defaults: structuredCopy(world.defaults),
    nodePool: { ...world.nodePool },
  };
}

const byId = (a: Link, b: Link) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const linkCap = (l: Link) => (l.mode.kind === 'fixed' ? l.mode.rate : undefined);
const structuredCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
