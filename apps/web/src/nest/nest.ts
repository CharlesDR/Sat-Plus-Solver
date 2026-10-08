/**
 * Nested factories (A49–A53) as the app shows them: where a factory may
 * move, and its totals on its own and with its sub-factories. Pure.
 */
import { formatRate, type PowerSummary } from '@sps/solver';
import { factoryDescendants, type World } from '@sps/world';

/** The factories `id` may move inside: any but itself and those below it, by name. */
export function parentOptions(world: World, id: string): { id: string; name: string }[] {
  const below = new Set([id, ...factoryDescendants(world, id)]);
  return world.factories
    .filter((f) => !below.has(f.id))
    .map((f) => ({ id: f.id, name: f.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
}

/** "12.5 MW draw · 7 machines", with generation when there is any. */
export function totalsText(t: { power: PowerSummary; machines: number }): string {
  const gen = t.power.generationMW > 0 ? ` · ${formatRate(t.power.generationMW)} MW gen` : '';
  return `${formatRate(t.power.consumptionMW)} MW draw${gen} · ${t.machines} machine${t.machines === 1 ? '' : 's'}`;
}
