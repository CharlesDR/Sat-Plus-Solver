/**
 * M13 (docs/PLAN.md): manual mode. The switch freezes the solved plan; edits
 * change flows by arithmetic, a shortfall shows as Missing; Undo, Revert all,
 * switching back (the plan is kept) and Discard; it survives a reload.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { autosaved, openFactory } from './helpers';

const node = (page: Page, id: string) =>
  page.getByTestId('flowchart').locator(`.react-flow__node[data-id="${id}"]`);
const mode = (page: Page, name: 'Solver' | 'Manual') =>
  page.getByRole('radiogroup', { name: 'Plan mode' }).getByRole('radio', { name });

test('freeze, edit, see Missing, undo, revert, leave, come back, discard', async ({ page }) => {
  await openFactory(page);
  await page.getByLabel('Per minute').fill('60');
  await page.getByLabel('Target item').fill('Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  const recipes = page.getByRole('table', { name: 'Recipes' });
  await expect(recipes).toContainText('Iron Plate');
  const before = (await recipes.textContent())!;

  // Freeze: same recipe groups and counts, now labelled manual.
  await mode(page, 'Manual').click();
  await expect(mode(page, 'Manual')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('plan-status')).toContainText('manual plan, not solver-checked');
  await expect(recipes).toHaveText(before);
  await expect(page.getByLabel('Per minute')).toBeDisabled();

  // Edit: one more Iron Plate constructor needs ingots nobody makes.
  await node(page, 'recipe:iron-plate').click();
  const editor = page.getByRole('group', { name: 'Edit Iron Plate' });
  const count = editor.getByLabel('Machines');
  const was = Number(await count.inputValue());
  await count.fill(String(was + 1));
  await count.press('Enter');
  await expect(node(page, 'missing:iron-ingot')).toHaveCount(1);
  await expect(page.getByRole('table', { name: 'Missing inputs' })).toContainText('Iron Ingot');
  await expect(page.getByText('1 input missing')).toBeVisible();

  // Add a recipe from the palette, then undo both edits with Undo and Ctrl+Z.
  await page.getByLabel('Add a recipe').fill('screw');
  await page.getByRole('button', { name: 'Add Screws', exact: true }).click();
  await expect(node(page, 'recipe:screws')).toHaveCount(1);
  await page
    .getByRole('region', { name: 'Manual plan' })
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(node(page, 'recipe:screws')).toHaveCount(0);
  await page.locator('body').press('Control+z');
  await expect(node(page, 'missing:iron-ingot')).toHaveCount(0);
  await expect(recipes).toHaveText(before);

  // Revert all, after two edits.
  await node(page, 'recipe:iron-plate').click();
  await editor.getByRole('button', { name: 'Remove from plan' }).click();
  await expect(node(page, 'recipe:iron-plate')).toHaveCount(0);
  await page.getByRole('button', { name: 'Revert all' }).click();
  await expect(recipes).toHaveText(before);

  // Saved, and kept when switching back to the solver and in again.
  await node(page, 'recipe:iron-plate').click();
  await count.fill('1');
  await count.press('Enter');
  await expect
    .poll(async () => {
      const w = (await autosaved(page)) as { factories: { manual?: { edits: unknown[] } }[] };
      return w.factories[0]!.manual?.edits.length;
    })
    .toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Open Factory', exact: true }).first().click();
  await expect(mode(page, 'Manual')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('plan-status')).toContainText('manual plan');
  await mode(page, 'Solver').click();
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await expect(recipes).toHaveText(before);
  await mode(page, 'Manual').click();
  await expect(node(page, 'missing:iron-ingot')).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Recipes' })).not.toHaveText(before);

  // Discard: back to the solver, and the next freeze starts fresh.
  await page.getByRole('button', { name: 'Discard manual plan…' }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(mode(page, 'Solver')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await expect(recipes).toHaveText(before);
});
