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
  await expect(node(page, 'target:iron-plate')).toContainText('60/min');
  await expect(chart.getByText('60 Iron Plate', { exact: true })).toBeVisible();

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
