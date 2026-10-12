/**
 * Alternate recipe unlocks (D1, A82): how each alternate is unlocked (MAM
 * research or a Hard Drive schematic) and the major tier from which it can be
 * researched, from data/alternate-unlocks.json. A given `tier` is used as is;
 * otherwise the tier is the highest major tier among the research costs.
 */
import { tierKey } from './context';
import type { Issues } from './issues';
import type { Item, Recipe, RecipeUnlock } from './model';
import type { AlternateUnlocksConfig } from './raw';

const FILE = 'data/alternate-unlocks.json';

export interface AlternateUnlocksResult {
  /** Recipe id → its unlock. */
  unlocks: Map<string, RecipeUnlock>;
  /** Alternates the file does not list (names, sorted). */
  unlisted: string[];
}

export function buildAlternateUnlocks(
  config: AlternateUnlocksConfig,
  items: readonly Item[],
  recipes: readonly Recipe[],
  issues: Issues,
): AlternateUnlocksResult {
  const tierOf = new Map(items.map((i) => [i.name, tierKey(i.tier)[0]]));
  const byName = new Map<string, Recipe[]>();
  for (const r of recipes) if (r.alternate) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);

  const unlocks = new Map<string, RecipeUnlock>();
  const seen = new Set<string>();
  for (const e of config.alternates) {
    const where = `${FILE}: "${e.recipe}"`;
    if (seen.has(e.recipe)) issues.error('unlocks.duplicate', `${where} is listed twice`);
    seen.add(e.recipe);
    const targets = byName.get(e.recipe);
    if (!targets) {
      issues.error(
        'unlocks.unknownRecipe',
        `${where} is not an alternate recipe in game_data.json`,
      );
      continue;
    }
    if ((e.tier === undefined) === (e.costs === undefined)) {
      issues.error('unlocks.tier', `${where} needs exactly one of "tier" and "costs"`);
      continue;
    }
    let tier = e.tier ?? 0;
    for (const part of e.costs ?? []) {
      const t = tierOf.get(part);
      if (t === undefined) issues.error('unlocks.unknownPart', `${where}: unknown part "${part}"`);
      else tier = Math.max(tier, t);
    }
    for (const r of targets) unlocks.set(r.id, { via: e.unlock, tier, schematic: e.schematic });
  }
  const unlisted = [...byName.keys()].filter((n) => !seen.has(n)).sort();
  return { unlocks, unlisted };
}
