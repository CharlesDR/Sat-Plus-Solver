/**
 * M12 (docs/PLAN.md): plan tweaks from the flowchart. A ban, a swap and an
 * import each change the plan; Undo (button or Ctrl+Z) and Revert all walk
 * them back; tweaks are saved with the world.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { autosaved, openFactory } from './helpers';

const node = (page: Page, id: string) =>
  page.getByTestId('flowchart').locator(`.react-flow__node[data-id="${id}"]`);
const tweaks = (page: Page) => page.getByRole('list', { name: 'Tweaks, oldest first' });
const settled = (page: Page) =>
  expect(page.locator('[data-testid=plan][aria-busy=false]')).toHaveCount(1);

test('ban, swap and import a recipe group; undo, Ctrl+Z and revert all', async ({ page }) => {
  await openFactory(page);
  await page.getByLabel('Per minute').fill('60');
  await page.getByLabel('Target item').fill('Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  const panel = page.getByRole('region', { name: 'Plan tweaks' });
  await expect(panel.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Revert all' })).toBeDisabled();

  // Ban: the solver picks another ingot recipe.
  await node(page, 'recipe:cast-iron-ingot').click();
  await page
    .getByRole('group', { name: 'Change Cast Iron Ingot' })
    .getByRole('button', { name: 'Don’t use this recipe' })
    .click();
  await expect(tweaks(page)).toContainText('Don’t use Cast Iron Ingot');
  await expect(node(page, 'recipe:cast-iron-ingot')).toHaveCount(0);
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await panel.getByRole('button', { name: 'Undo' }).click();
  await expect(node(page, 'recipe:cast-iron-ingot')).toHaveCount(1);
  await expect(tweaks(page)).toHaveCount(0);

  // Swap, with its effect previewed.
  await settled(page);
  await node(page, 'recipe:iron-plate').click();
  await page.getByRole('button', { name: 'Swap recipe…' }).click();
  const swaps = page.getByRole('list', { name: 'Recipes to swap in' });
  const steel = swaps.getByRole('listitem').filter({ hasText: 'Steel Cast Plate' });
  await expect(steel.locator('.effect')).not.toHaveText('Comparing…', { timeout: 60_000 });
  await steel.getByRole('button', { name: 'Use Steel Cast Plate' }).click();
  await expect(node(page, 'recipe:steel-cast-plate')).toHaveClass(/selected/);
  await expect(node(page, 'recipe:iron-plate')).toHaveCount(0);
  await expect(tweaks(page)).toContainText('Iron Plate → Steel Cast Plate');

  // Ctrl+Z undoes it.
  await page.locator('body').press('Control+z');
  await expect(node(page, 'recipe:iron-plate')).toHaveCount(1);
  await expect(tweaks(page)).toHaveCount(0);

  // Import instead, plus a ban; both are saved, and Revert all drops both.
  await settled(page);
  await node(page, 'recipe:iron-plate').click();
  await page.getByRole('button', { name: 'Import Iron Plate instead' }).click();
  await expect(node(page, 'import:iron-plate')).toHaveCount(1);
  await expect(node(page, 'recipe:iron-plate')).toHaveCount(0);
  await expect
    .poll(
      async () =>
        ((await autosaved(page)) as { factories: { tweaks: unknown[] }[] }).factories[0]!.tweaks,
    )
    .toEqual([{ kind: 'import', item: 'iron-plate' }]);
  await panel.getByRole('button', { name: 'Revert all' }).click();
  await expect(node(page, 'recipe:iron-plate')).toHaveCount(1);
  await expect(node(page, 'import:iron-plate')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Undo' })).toBeDisabled();
});
