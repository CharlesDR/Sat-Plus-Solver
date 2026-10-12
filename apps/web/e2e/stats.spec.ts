/**
 * ST (A81): the "Stats for" dropdown sums the plan stats over the open
 * factory and its sub-factories by default, or over the open factory, the
 * selected recipe group or sub-factory, or the whole world.
 */
import { expect, test } from './fixtures';
import { openFactory } from './helpers';

test('the stats scope sums the stats over the factories in it', async ({ page }) => {
  const factorySelect = page.getByRole('navigation', { name: 'Breadcrumb' }).getByLabel('Factory');
  const scope = page.getByLabel('Stats for');
  const label = page.getByTestId('scope-label');
  await openFactory(page);
  await page.getByLabel('Per minute').fill('5');
  await page.getByLabel('Target item').fill('Reinforced Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  // A factory without sub-factories shows its own plan.
  await expect(scope).toHaveValue('current-below');
  await expect(label).toHaveCount(0);

  await page.getByRole('button', { name: /^Sub-factories/ }).click();
  await page.getByRole('button', { name: 'Add sub-factory' }).click();
  await expect(factorySelect).toHaveValue('factory-2');
  await page.getByLabel('Per minute').fill('60');
  await page.getByLabel('Target item').fill('Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Escape');
  await expect(factorySelect).toHaveValue('factory-1');

  // Current & Below: the parent with its sub-factory; the plates between them net out.
  await expect(label).toHaveText('2 factories: Factory, Factory 2');
  const targets = page.getByRole('table', { name: 'Targets' });
  await expect(targets).toContainText('Reinforced Iron Plate');
  await expect(targets).toContainText('Iron Plate');

  await scope.selectOption('current');
  await expect(label).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Imports' })).toContainText('Iron Plate');

  // Selected Only: pick a recipe group in the Recipes table.
  await scope.selectOption('selected');
  await expect(page.getByTestId('scope-pick')).toBeVisible();
  await page.getByRole('table', { name: 'Recipes' }).locator('tr.selectable').first().click();
  await expect(label).toContainText('Recipe group:');

  // The choice is a preference: it survives a reload.
  await scope.selectOption('world');
  await expect(label).toHaveText('2 factories: Factory, Factory 2');
  await page.reload();
  await page.getByRole('button', { name: 'Open Factory', exact: true }).click();
  await expect(page.getByLabel('Stats for')).toHaveValue('world');
});
