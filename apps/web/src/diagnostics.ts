/**
 * Diagnostics UX (M10): turns solver and world diagnostics into a headline,
 * the solver's own message, and the one-click fixes that apply (§3.5).
 * Pure, so the wording and the fixes are unit-tested.
 */
import type { Diagnostic } from '@sps/solver';
import type { Factory, UnassignedImport, WorldDiagnostic } from '@sps/world';
import type { SolveProgress } from './solver/protocol';

/** A fix the user can apply with one click. */
export type Fix =
  /** Turn a disabled recipe on for this factory (unreachable target). */
  | { kind: 'enable-recipe'; recipe: string; label: string }
  /** Raise the factory's unassigned import cap of an item (infeasible plan). */
  | { kind: 'add-import'; item: string; rate: number; label: string }
  /** Turn a resource on or raise its limit (infeasible plan, A33). */
  | { kind: 'raise-resource'; item: string; amount: number; label: string }
  | { kind: 'open-factory'; factory: string; label: string }
  | { kind: 'edit-link'; link: string; label: string }
  | { kind: 'remove-link'; link: string; label: string }
  | { kind: 'show-nodes'; label: string };

export interface DiagnosticView {
  severity: 'error' | 'warning';
  title: string;
  message: string;
  fixes: Fix[];
}

/** Display names; each falls back to the id. */
export interface Names {
  item(id: string): string;
  recipe(id: string): string;
  node(id: string): string;
  factory(id: string): string;
}

/** Rounds a shortfall up, so applying the fix closes it: 3 significant digits. */
export function roundUp(x: number): number {
  if (!(x > 0)) return 0;
  const step = 10 ** (Math.floor(Math.log10(x)) - 2);
  return Number((Math.ceil(x / step - 1e-9) * step).toPrecision(12));
}

const pct = (x: number) => `${Number((x * 100).toPrecision(3))}%`;

const FACTORY_TITLES: Record<Diagnostic['code'], string> = {
  unreachable: 'A target cannot be made',
  infeasible: 'Not enough resources',
  unbounded: 'The plan has no limit',
  'time-limit': 'The solver ran out of time',
  'tolerance-relaxed': 'Tolerance was relaxed',
  'import-cost': 'An import cost is approximate',
  numerical: 'The solver failed',
  'check-failed': 'The plan failed its checks',
  'invalid-request': 'The request is invalid',
};

/** One factory's solve diagnostics. `resources` are the factory's resource limits, for their fixes. */
export function factoryDiagnostics(
  ds: readonly Diagnostic[],
  names: Names,
  resources: Factory['resources'],
): DiagnosticView[] {
  return ds.map((d) => {
    const fixes: Fix[] = [];
    let title = FACTORY_TITLES[d.code];
    switch (d.code) {
      case 'unreachable':
        title = `Nothing can produce ${names.item(d.item)}`;
        for (const r of d.fixes)
          fixes.push({ kind: 'enable-recipe', recipe: r, label: `Turn on ${names.recipe(r)}` });
        break;
      case 'infeasible':
        for (const r of d.relaxations) {
          const amount = roundUp(r.amount);
          if (r.kind === 'import')
            fixes.push({
              kind: 'add-import',
              item: r.item,
              rate: amount,
              label: `Import ${amount}/min more ${names.item(r.item)}`,
            });
          else if (r.kind === 'resource')
            fixes.push({
              kind: 'raise-resource',
              item: r.item,
              amount,
              label:
                resources[r.item]?.enabled === false
                  ? `Turn on ${names.item(r.item)}`
                  : `Raise the ${names.item(r.item)} limit by ${amount}/min`,
            });
          // A node relaxation is the map's node pool: no factory setting raises it.
        }
        break;
      case 'time-limit':
        if (d.gap !== undefined) title = `The solver ran out of time (gap ${pct(d.gap)})`;
        break;
      case 'tolerance-relaxed':
        title = `Tolerance was relaxed to ${pct(d.tolerance)}`;
        break;
      default:
        break;
    }
    return { severity: d.severity, title, message: d.message, fixes };
  });
}

/** The world's own diagnostics (links, groups, cycles, the node pool). */
export function worldDiagnostics(ds: readonly WorldDiagnostic[], names: Names): DiagnosticView[] {
  return ds.map((d) => {
    const view = (title: string, fixes: Fix[] = []): DiagnosticView => ({
      severity: d.severity,
      title,
      message: d.message,
      fixes,
    });
    switch (d.code) {
      case 'invalid-link':
        return view('A link is ignored', [
          { kind: 'remove-link', link: d.link, label: `Remove link ${d.link}` },
        ]);
      case 'invalid-group':
        return view('A group is misplaced');
      case 'factory-failed':
        return view(`${names.factory(d.factory)} has no plan`, [
          {
            kind: 'open-factory',
            factory: d.factory,
            label: `Open ${names.factory(d.factory)}`,
          },
        ]);
      case 'link-short':
        return view(`A link of ${names.item(d.item)} is short`, [
          { kind: 'edit-link', link: d.link, label: `Edit link ${d.link}` },
        ]);
      case 'cycle-not-converged':
        return view(
          'A pull cycle did not settle',
          d.links.map((l) => ({ kind: 'edit-link', link: l, label: `Edit link ${l}` })),
        );
      case 'node-over-allocated':
        return view(`${names.node(d.node)} is over-allocated`, [
          { kind: 'show-nodes', label: 'Show the node pool' },
        ]);
      case 'import-cost-unsettled':
        return view('Linked import costs did not settle');
    }
  });
}

/** "2 errors, 1 warning". */
export function countLabel(views: readonly DiagnosticView[]): string {
  const errors = views.filter((v) => v.severity === 'error').length;
  const warnings = views.length - errors;
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [errors && part(errors, 'error'), warnings && part(warnings, 'warning')]
    .filter(Boolean)
    .join(', ');
}

/** The world-solve progress line: "Solving Smelter (2 of 5)…". */
export function progressLabel(p: SolveProgress | undefined, what: string): string {
  if (!p) return `Solving ${what}…`;
  const step = Math.min(p.step, p.factories);
  return `Solving ${p.factory} (${step} of ${p.factories}${p.pass > 1 ? `, pass ${p.pass}` : ''})…`;
}

/** "Import N/min more": raises the item's capped import, or adds one. */
export function withImport(
  imports: readonly UnassignedImport[],
  item: string,
  rate: number,
): UnassignedImport[] {
  if (!imports.some((i) => i.item === item)) return [...imports, { item, cap: rate }];
  return imports.map((i) =>
    i.item === item && i.cap !== undefined
      ? { ...i, cap: Number((i.cap + rate).toPrecision(12)) }
      : i,
  );
}

/**
 * "Turn on X" or "Raise the X limit by N/min": turns the resource on, with a
 * kept limit raised to at least `amount` (what the plan needs of it), or
 * raises an on resource's limit by `amount`.
 */
export function withResourceLimit(
  resources: Factory['resources'],
  item: string,
  amount: number,
): Factory['resources'] {
  const limit = resources[item];
  const round = (x: number) => Number(x.toPrecision(12));
  if (limit?.enabled === false) {
    const max = limit.max === undefined ? {} : { max: round(Math.max(limit.max, amount)) };
    return { ...resources, [item]: { enabled: true, ...max } };
  }
  if (limit?.max === undefined) return resources;
  return { ...resources, [item]: { enabled: true, max: round(limit.max + amount) } };
}
