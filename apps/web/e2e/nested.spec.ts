/**
 * M16 (docs/PLAN.md): nested factories. A sub-factory's output reaches its
 * parent through the automatic link and shows as a box on the parent's
 * flowchart; the breadcrumb shows the path, and Esc steps back one level at
 * a time from a grandchild to the world.
 */
import { expect, test } from './fixtures';
import { openFactory } from './helpers';

test('add sub-factories, open them, and back out with Esc', async ({ page }) => {
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  const factorySelect = crumbs.getByLabel('Factory');
  await openFactory(page);
  await page.getByLabel('Per minute').fill('5');
  await page.getByLabel('Target item').fill('Reinforced Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');

  // A sub-factory opens below its parent and is wired to it.
  await page.getByRole('button', { name: 'Add sub-factory' }).click();
  await expect(crumbs.getByRole('button', { name: 'Factory', exact: true })).toBeVisible();
  await expect(factorySelect).toHaveValue('factory-1');
  await page.getByLabel('Per minute').fill('60');
  await page.getByLabel('Target item').fill('Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');

  // A grandchild, then Esc steps back: child, parent, world.
  await page.getByRole('button', { name: 'Add sub-factory' }).click();
  await expect(factorySelect).toHaveValue('factory-2');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Escape');
  await expect(factorySelect).toHaveValue('factory-1');
  await page.keyboard.press('Escape');
  await expect(factorySelect).toHaveValue('factory-main');

  // The parent draws its plates from the child: a box on its flowchart, and its totals.
  await expect(page.getByTestId('nest-totals')).toContainText('With sub-factories:');
  await expect(page.getByRole('list', { name: 'Sub-factories' })).toContainText('Factory 2');
  const chart = page.getByTestId('flowchart');
  await chart.getByRole('button', { name: 'Fit the whole plan' }).click();
  await chart.locator('.react-flow__node[data-id="sub:factory-1"]').dblclick();
  await expect(factorySelect).toHaveValue('factory-1');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(crumbs.getByLabel('Factory')).toHaveCount(0);
});
