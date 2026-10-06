/**
 * UI polish (A38): theme switch, quick search, settings sidebar, sortable
 * tables, the summary strip and item icons.
 */
import { expect, test } from './fixtures';
import { addFactory, openFactory } from './helpers';

test('the theme switch forces light or dark and is remembered', async ({ page }) => {
  await page.goto('/');
  const theme = page.getByRole('radiogroup', { name: 'Theme' });
  await expect(theme.getByRole('radio', { name: 'System theme' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await theme.getByRole('radio', { name: 'Dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(theme.getByRole('radio', { name: 'Dark theme' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await theme.getByRole('radio', { name: 'System theme' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
});

test('Ctrl+K opens a factory and adds a target', async ({ page }) => {
  await page.goto('/');
  await addFactory(page, 'Smelters');
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Search factories and items' });
  await expect(search).toBeFocused();
  await search.fill('smelt');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Factory', { exact: true }).locator('option:checked')).toHaveText(
    'Smelters',
  );

  await page.keyboard.press('Control+k');
  await search.fill('Iron Plate');
  await expect(page.getByRole('option', { name: /^Iron Plate/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Target item')).toHaveValue('Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');

  // Escape closes it without doing anything.
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(search).toHaveCount(0);
});

test('summary strip, icons, sortable tables and the settings sidebar', async ({ page }) => {
  await openFactory(page);
  await page.getByLabel('Per minute').fill('60');
  await page.getByLabel('Target item').fill('Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');

  const stats = page.getByRole('definition').filter({ hasText: 'ok' });
  await expect(stats.first()).toBeVisible();
  await expect(page.locator('.plan-stats')).toContainText('Power net');
  // The target node shows the Iron Plate icon.
  await expect(
    page.locator('.react-flow__node[data-id="target:iron-plate"] img.flow-icon'),
  ).toHaveAttribute('src', /icons\/items\/iron-plate\.webp$/);

  // Sorting: ascending, descending, then the plan's own order again.
  const recipes = page.getByRole('table', { name: 'Recipes' });
  const before = await recipes.locator('tbody tr').allTextContents();
  const count = recipes.getByRole('columnheader', { name: 'Count' });
  await count.getByRole('button').click();
  await expect(count).toHaveAttribute('aria-sort', 'ascending');
  await count.getByRole('button').click();
  await expect(count).toHaveAttribute('aria-sort', 'descending');
  await count.getByRole('button').click();
  await expect(count).not.toHaveAttribute('aria-sort');
  expect(await recipes.locator('tbody tr').allTextContents()).toEqual(before);

  // Filter.
  await page.getByLabel('Filter recipes').fill('ingot');
  await expect(recipes.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Filter recipes').fill('');

  // The sidebar hides, stays hidden after a reload, and comes back.
  await page.getByRole('button', { name: 'Hide settings' }).click();
  await expect(page.getByLabel('Target item')).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Open Factory', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Show settings' }).click();
  await expect(page.getByLabel('Target item')).toBeVisible();
});

test('an empty factory offers to add a target', async ({ page }) => {
  await openFactory(page);
  await page.getByLabel('Target item').fill('');
  await expect(page.getByText('Nothing to plan yet')).toBeVisible();
  await page.getByRole('button', { name: 'Add a target' }).click();
  await expect(page.getByLabel('Target item')).toBeFocused();
});

test('the page has no width cap, and the resource limits table fits the sidebar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 2560, height: 1200 });
  await openFactory(page);
  const main = await page.locator('main').boundingBox();
  expect(main!.width).toBeGreaterThan(2500);
  await page.evaluate(() =>
    document
      .querySelectorAll('.sidebar details')
      .forEach((d) => ((d as HTMLDetailsElement).open = true)),
  );
  const table = page.getByRole('table', { name: 'Resource limits' });
  await expect(table).toBeVisible();
  const [tableWidth, boxWidth] = await table.evaluate((t) => [
    t.getBoundingClientRect().width,
    t.parentElement!.clientWidth,
  ]);
  expect(tableWidth).toBeLessThanOrEqual(boxWidth);
});

test('avoid fluid byproducts is on, and its fix turns it off for the factory (A39)', async ({
  page,
}) => {
  await openFactory(page);
  const avoid = page.getByRole('checkbox', { name: 'Avoid fluid byproducts' });
  await expect(avoid).toBeChecked();
  // Kerr Crystal leaves Energetic Dark Matter over.
  await page.getByLabel('Per minute').fill('10');
  await page.getByLabel('Target item').fill('Kerr Crystal');
  await expect(page.getByTestId('plan-status')).toContainText('infeasible');
  await expect(page.getByText(/Energetic Dark Matter left over/)).toBeVisible();
  await page.getByRole('button', { name: 'Allow leftover fluids in this factory' }).click();
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await expect(avoid).not.toBeChecked();
});
