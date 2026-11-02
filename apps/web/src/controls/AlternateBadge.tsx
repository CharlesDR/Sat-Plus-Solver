import { alternateMark } from '@sps/solver';
import type { CatalogRecipe } from '../solver/protocol';

/** What an alternate's unlock reads as (A82): "T5 MAM", "T7 hard drive". */
export function unlockLabel(unlock: NonNullable<CatalogRecipe['unlock']>): {
  text: string;
  title: string;
} {
  const mam = unlock.via === 'mam';
  return {
    text: `T${unlock.tier} ${mam ? 'MAM' : 'hard drive'}`,
    title:
      `Researchable from tier ${unlock.tier}: ` +
      `${mam ? 'MAM research' : 'Hard Drive'} “${unlock.schematic}”`,
  };
}

/** The "alternate" badge, with the tier and way it is unlocked when known. */
export function AlternateBadge({ recipe }: { recipe: Parameters<typeof alternateMark>[0] }) {
  const mark = alternateMark(recipe);
  if (!mark) return null;
  return (
    <span className="badge" {...(recipe.unlock ? { title: unlockLabel(recipe.unlock).title } : {})}>
      {mark}
    </span>
  );
}
