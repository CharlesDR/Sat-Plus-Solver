/**
 * Max tier as major tiers only (UX-5): T1 … T10 and No limit. The world keeps
 * a dataset tier (`"6-5"`), so "T6" stores the highest tier of major 6 the
 * dataset has, and every recipe of tier 6 is allowed. A limit saved before
 * (`"6-1"`) that is not a major's highest keeps an option of its own.
 */
import { aboveTier } from '@sps/solver';
import type { CatalogItem } from '../solver/protocol';

export interface TierOption {
  value: string;
  label: string;
}

const major = (tier: string) => Number(/^(\d+)-\d+$/.exec(tier)?.[1] ?? NaN);

/** One option per major tier from 1 up, labelled "T<n>"; `tiers` are in tier order. */
export function tierOptions(tiers: readonly string[], current?: string | null): TierOption[] {
  const top = new Map<number, string>();
  for (const t of tiers) {
    const m = major(t);
    if (m >= 1) top.set(m, t);
  }
  const out = [...top].map(([m, value]) => ({ value, label: `T${m}` }));
  if (current && !out.some((o) => o.value === current)) {
    const m = major(current);
    const at = out.findIndex((o) => major(o.value) >= m);
    const own = { value: current, label: Number.isNaN(m) ? current : `T${m} (up to ${current})` };
    out.splice(at < 0 ? out.length : at, 0, own);
  }
  return out;
}

/** The target items a max tier leaves on offer (UX-17); no limit offers them all. */
export function itemsUpToTier(
  items: readonly CatalogItem[],
  maxTier: string | null | undefined,
): readonly CatalogItem[] {
  if (!maxTier) return items;
  return items.filter((i) => i.tier === undefined || !aboveTier(i.tier, maxTier));
}

/** The target items a max tier leaves out (R2), in name order; none without a limit. */
export function itemsAboveTier(
  items: readonly CatalogItem[],
  maxTier: string | null | undefined,
): readonly CatalogItem[] {
  if (!maxTier) return [];
  return items
    .filter((i) => i.tier !== undefined && aboveTier(i.tier, maxTier))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A tier as the Max tier select names it: "T6". */
export const tierLabel = (tier: string): string => {
  const m = major(tier);
  return Number.isNaN(m) ? tier : `T${m}`;
};
