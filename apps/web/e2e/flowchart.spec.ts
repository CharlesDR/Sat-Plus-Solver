/**
 * M7 (docs/PLAN.md): the factory flowchart shows the plan, its edges carry
 * rates, and selection syncs both ways between the flowchart and the table.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clickFlowNode, openFactory } from './helpers';

const node = (page: Page, id: string) =>
  page.getByTestId('flowchart').locator(`.react-flow__node[data-id="${id}"]`);
const row = (page: Page, id: string) => page.locator(`[data-testid=plan] tr[data-node="${id}"]`);

test('Iron Plate 60/min: flowchart nodes, edge rates and two-way selection', async ({ page }) => {
  await openFactory(page);
  await page.getByLabel('Per minute').fill('60');
  await page.getByLabel('Target item').fill('Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');

  const chart = page.getByTestId('flowchart');
  await expect(chart).toBeVisible();
  // One node per row of the Recipes, Targets, Imports and Surplus tables.
  const rows = page.locator('[data-testid=plan] tr[data-node]');
  await expect(chart.locator('.react-flow__node')).toHaveCount(await rows.count());
  for (const id of await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-node')!)))
    await expect(node(page, id)).toHaveCount(1);
  await expect(node(page, 'target:iron-plate')).toContainText('Target: Iron Plate');
  await expect(node(page, 'target:iron-plate')).toContainText('60.0/min');
  await expect(chart.getByText('60.0 Iron Plate', { exact: true })).toBeVisible();

  // Flowchart → table.
  await clickFlowNode(page, 'recipe:iron-plate');
  await expect(node(page, 'recipe:iron-plate')).toHaveClass(/selected/);
  await expect(row(page, 'recipe:iron-plate')).toHaveAttribute('aria-selected', 'true');

  // Table → flowchart.
  await row(page, 'recipe:cast-iron-ingot').click();
  await expect(row(page, 'recipe:cast-iron-ingot')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'recipe:iron-plate')).toHaveAttribute('aria-selected', 'false');
  await expect(node(page, 'recipe:cast-iron-ingot')).toHaveClass(/selected/);
  await expect(node(page, 'recipe:iron-plate')).not.toHaveClass(/selected/);

  // The keyboard works on rows too; picking the selected row again clears it.
  await row(page, 'target:iron-plate').focus();
  await page.keyboard.press('Enter');
  await expect(node(page, 'target:iron-plate')).toHaveClass(/selected/);
  await page.keyboard.press('Enter');
  await expect(node(page, 'target:iron-plate')).not.toHaveClass(/selected/);
});

test('Reinforced Iron Plate 5/min: raw inputs on top, a fan-out drawn as one trunk (A46)', async ({
  page,
}) => {
  await openFactory(page);
  await page.getByLabel('Per minute').fill('5');
  await page.getByLabel('Target item').fill('Reinforced Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  const chart = page.getByTestId('flowchart');
  await chart.getByRole('button', { name: 'Fit the whole plan' }).click();

  // Water sits above every recipe that is not a raw input.
  const top = async (id: string) => (await node(page, id).boundingBox())!.y;
  const water = await top('recipe:water');
  for (const id of ['recipe:iron-plate', 'recipe:cast-iron-ingot', 'recipe:screws'])
    expect(water).toBeLessThan(await top(id));

  // Iron Ingot feeds Iron Plate and Iron Rod: one trunk with the total,
  // each branch with its rate only.
  await expect(chart.locator('.flow-edge-label.trunk', { hasText: '30.0 Iron Ingot' })).toHaveCount(
    1,
  );
  await expect(chart.locator('.flow-edge-label:not(.trunk)', { hasText: /^15\.0$/ })).toHaveCount(
    2,
  );
});
