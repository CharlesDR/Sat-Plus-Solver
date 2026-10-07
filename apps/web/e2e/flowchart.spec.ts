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
  // Each line shows its item's icon and rate; the name is on hover (A48).
  await expect(chart.locator('.flow-edge-label[title="Iron Plate: 60.0/min"]')).toHaveText('60.0');

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

test('Reinforced Iron Plate 5/min: multi-stage Water, a fan-out drawn as one trunk (A46–A48)', async ({
  page,
}) => {
  await openFactory(page);
  await page.getByLabel('Per minute').fill('5');
  await page.getByLabel('Target item').fill('Reinforced Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  const chart = page.getByTestId('flowchart');
  await chart.getByRole('button', { name: 'Fit the whole plan' }).click();

  // Water feeds recipes at two stages, so it is marked; it sits in the chart.
  await expect(node(page, 'recipe:water').locator('.flow-node')).toHaveClass(/multi-stage/);
  await expect(node(page, 'recipe:water')).toContainText('2 stages');

  // Iron Ingot feeds Iron Plate and Iron Rod: one trunk with the total,
  // each branch with its rate.
  const trunk = chart.locator('.flow-edge-label.trunk[title="Iron Ingot: 30.0/min in all"]');
  await expect(trunk).toHaveText('30.0');
  await expect(chart.locator('.flow-edge-label[title="Iron Ingot: 15.0/min"]')).toHaveCount(2);

  // The output tray lists what a recipe makes.
  await expect(node(page, 'recipe:iron-plate').locator('.flow-tray-row')).toHaveText(['10.0']);
});

test('hover focus, and the click tooltip with exact values closes on Esc first (A48)', async ({
  page,
}) => {
  await openFactory(page);
  await page.getByLabel('Per minute').fill('5');
  await page.getByLabel('Target item').fill('Reinforced Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  const chart = page.getByTestId('flowchart');
  await chart.getByRole('button', { name: 'Fit the whole plan' }).click();

  // Hovering a node dims what isn't linked to it.
  await node(page, 'recipe:screws').hover();
  await expect(node(page, 'recipe:screws').locator('.flow-node')).not.toHaveClass(/dim/);
  await expect(node(page, 'recipe:water').locator('.flow-node')).toHaveClass(/dim/);
  await page.mouse.move(0, 0);
  await expect(node(page, 'recipe:water').locator('.flow-node')).not.toHaveClass(/dim/);

  // Clicking a node opens its exact values; Esc closes them, then the selection.
  await clickFlowNode(page, 'recipe:water');
  const tip = page.getByRole('dialog', { name: 'Water: exact values' });
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Used at 2 stages of the plan');
  await expect(tip).toContainText(/\(\d+ ?\d*\/\d+\)/);
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  await expect(node(page, 'recipe:water')).toHaveClass(/selected/);
  await page.keyboard.press('Escape');
  await expect(node(page, 'recipe:water')).not.toHaveClass(/selected/);

  // A click anywhere else on the page closes it too.
  await clickFlowNode(page, 'recipe:water');
  await expect(tip).toBeVisible();
  await page.getByTestId('plan-status').click();
  await expect(tip).toBeHidden();
});
