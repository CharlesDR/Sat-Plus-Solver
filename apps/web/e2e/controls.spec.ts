/**
 * M6 acceptance (docs/PLAN.md) in the factory view: several targets, a
 * single alternate turned on and used, the max-tier filter, an explicit node
 * budget below usage, and settings that inherit the world defaults.
 */
import { expect, test, type Page } from '@playwright/test';

const recipeNames = (page: Page) =>
  page
    .locator('[data-testid=plan] table[aria-label=Recipes] tbody tr td:first-child')
    .allTextContents();

async function plan(page: Page, item: string, rate: string) {
  await page.goto('/');
  await page.getByLabel('Per minute').fill(rate);
  await page.getByLabel('Target item').fill(item);
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
}

/** Waits for the plan of the latest edit. */
async function settled(page: Page) {
  await expect(page.locator('[aria-busy=true]')).toHaveCount(0);
  await expect(page.getByTestId('plan')).toBeVisible();
}

test('several targets are planned together', async ({ page }) => {
  await plan(page, 'Iron Plate', '60');
  await page.getByRole('button', { name: 'Add target' }).click();
  await page.getByLabel('Target item 2').fill('Iron Rod');
  await page.getByLabel('Per minute 2').fill('30');
  await settled(page);
  const targets = page.locator('[data-testid=plan] table[aria-label=Targets] tbody tr');
  await expect(targets).toHaveText([/Iron Plate\s*60/, /Iron Rod\s*30/]);

  await page.getByRole('button', { name: 'Remove target 2' }).click();
  await settled(page);
  await expect(targets).toHaveText([/Iron Plate\s*60/]);
});

test('an alternate turned on is used when better; the tier filter takes it away', async ({
  page,
}) => {
  await plan(page, 'Reinforced Iron Plate', '10');
  expect(await recipeNames(page)).not.toContain('Stitched Iron Plate');
  const before = await page.getByTestId('plan-status').textContent();

  await page.locator('summary', { hasText: 'Recipes' }).click();
  await page.getByLabel('Search recipes').fill('stitched iron plate');
  const toggle = page.getByRole('checkbox', { name: 'Stitched Iron Plate' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await settled(page);
  expect(await recipeNames(page)).toContain('Stitched Iron Plate');
  await expect(page.getByTestId('plan-status')).not.toHaveText(before!);

  // Stitched Iron Plate is tier 2-1: a 2-0 limit leaves it out even though it is on.
  await page.getByLabel('Max tier').selectOption('2-0');
  await settled(page);
  expect(await recipeNames(page)).not.toContain('Stitched Iron Plate');
  await expect(toggle).toBeDisabled();
  await expect(page.getByText('above max tier')).toBeVisible();
});

test('a node budget below usage gives the infeasibility diagnostic', async ({ page }) => {
  await plan(page, 'Iron Plate', '60');
  await page.locator('summary', { hasText: 'Node budget' }).click();
  await page.getByLabel('Explicit caps').check();
  await settled(page);
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  for (const cap of await page.getByLabel(/^Cap for /).all()) await cap.fill('0');
  await settled(page);
  await expect(page.getByTestId('plan-status')).toContainText('Status: infeasible');
  await expect(page.locator('.diagnostics')).toContainText(/Infeasible: needs .* nodes/);

  await page.getByLabel('Whole map pool').check();
  await settled(page);
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
});

test('settings inherit the world defaults until the factory overrides them', async ({ page }) => {
  await plan(page, 'Iron Plate', '60');
  const alternates = page.getByLabel('All alternate recipes');
  const setting = page.locator('[data-setting=alternates]');
  await expect(alternates).not.toBeChecked();
  await expect(setting.getByText('world default')).toBeVisible();

  // World scope: turning alternates on reaches the factory, which inherits it.
  await page.getByLabel('World defaults (all factories)').check();
  await alternates.check();
  await page.getByLabel('This factory').check();
  await expect(alternates).toBeChecked();
  await expect(setting.getByText('world default')).toBeVisible();

  // A factory override, then back to the default.
  await alternates.uncheck();
  await expect(setting.getByRole('button', { name: /Use the world default/ })).toBeVisible();
  await setting.getByRole('button', { name: /Use the world default/ }).click();
  await expect(alternates).toBeChecked();

  // Objective stack and a clamped tolerance.
  await page.getByLabel('Add objective').selectOption('machines');
  await expect(page.getByRole('list', { name: 'Objective stack' }).locator('li')).toHaveCount(2);
  const tolerance = page.getByLabel('Tolerance (%)');
  await tolerance.fill('500');
  await tolerance.press('Enter');
  await expect(tolerance).toHaveValue('90');
  await settled(page);
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
});
