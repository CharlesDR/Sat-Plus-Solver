/**
 * Build marks (A44) as the app shows them: the state as a chip, each flag
 * as a line of text, and what changed since the mark. Pure.
 */
import { formatExact, formatRate } from '@sps/solver';
import { BUILD_FLAG_LABELS, type BuildCause, type BuildCheck, type BuildFlag } from '@sps/world';
import type { Names } from '../diagnostics';
import type { Tone } from '../ui/StatusChip';

export const BUILD_STATE: Record<BuildCheck['state'], { label: string; tone: Tone }> = {
  matches: { label: 'Matches build', tone: 'ok' },
  note: { label: 'Matches build, with notes', tone: 'ok' },
  differs: { label: 'Differs from build', tone: 'warn' },
  broken: { label: "Can't run as built", tone: 'error' },
};

const CAUSES: Record<BuildCause, string> = {
  'factory-settings': 'this factory’s settings',
  'world-settings': 'the world defaults',
  links: 'its links',
  'game-data': 'the game data',
};

/** One flag for display: its name and one line per item or recipe. */
export interface FlagView {
  kind: BuildFlag['kind'];
  severity: BuildFlag['severity'];
  title: string;
  lines: string[];
}

export function flagView(flag: BuildFlag, names: Pick<Names, 'item' | 'recipe'>): FlagView {
  const title = BUILD_FLAG_LABELS[flag.kind];
  const rate = (r: { item: string; rate: number }) =>
    `${names.item(r.item)}: ${formatRate(r.rate)}/min`;
  const lines = ((): string[] => {
    switch (flag.kind) {
      case 'inputs-short':
        return flag.items.map((r) => `${rate(r)} more needed than its links and imports supply`);
      case 'needs-expansion':
        return flag.items.map((r) => `${rate(r)} short of what is asked`);
      case 'over-resource-limit':
        return flag.items.map(
          (r) =>
            `${names.item(r.item)}: extracts ${formatRate(r.rate)}/min, limit ${formatRate(r.limit)}/min`,
        );
      case 'recipe-gone':
        return flag.recipes.map((r) => `${names.recipe(r)} is not in the game data`);
      case 'plan-changed':
      case 'can-reduce':
        return flag.changes.map(
          (c) =>
            `${names.recipe(c.recipe)}: built ${formatExact(c.built)}, now ${formatExact(c.now)}`,
        );
      case 'data-changed':
        return ['Recipe rates may have moved since the mark.'];
    }
  })();
  return { kind: flag.kind, severity: flag.severity, title, lines };
}

/** "Changed since the mark: its links and the game data.", or nothing. */
export function causesText(causes: readonly BuildCause[]): string | undefined {
  if (!causes.length) return undefined;
  const parts = causes.map((c) => CAUSES[c]);
  const list =
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`;
  return `Changed since the mark: ${list}.`;
}

/** "7 Oct 2026, 12:00" in the viewer's locale; the raw string if it isn't a date. */
export function markedText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "2 factories off their build", or nothing when every marked factory matches. */
export function offBuildText(
  factories: readonly { build?: BuildCheck | undefined }[],
): string | undefined {
  const off = factories.filter(
    (f) => f.build?.state === 'differs' || f.build?.state === 'broken',
  ).length;
  if (!off) return undefined;
  return `${off} ${off === 1 ? 'factory' : 'factories'} off their build`;
}
