/**
 * UX-B (A78): the plan summary puts the stats first and the Recipes table
 * last, in production order with input and output chips; long or noisy
 * tables start folded; an Items tab; one-key shortcuts; and each factory's
 * flowchart opens where it was left.
 */
import { expect, test } from './fixtures';
import { openFactory } from './helpers';

test('stats first, folded tables, Recipes in production order with chips, Items tab', async ({
  page,
}) => {
  await openFactory(page);
  await page.getByLabel('Per minute').fill('60');
  await page.getByLabel('Target item').fill('Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');

  const plan = page.getByTestId('plan');
  // The stats first, Recipes last.
  const captions = plan.locator('table caption');
  await expect(captions.first()).toHaveText('Targets');
  await expect(captions.nth(1)).toHaveText('Raw resources');
  await expect(captions.last()).toHaveText('Recipes');
  await expect(
    page.getByRole('table', { name: 'Raw resources' }).locator('tbody tr'),
  ).not.toHaveCount(0);

  // Nodes starts folded with its count, and stays as the user leaves it.
  const nodes = plan.locator('summary', { hasText: 'Nodes' });
  await expect(nodes).toHaveText(/^Nodes \(\d+\)$/);
  await expect(page.getByRole('table', { name: 'Nodes' })).toBeHidden();
  await nodes.click();
  await expect(page.getByRole('table', { name: 'Nodes' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open Factory', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Nodes' })).toBeVisible();

  // Production order: whatever a recipe takes is made in an earlier row, or not in the
  // plan; miners (named for their node's purity) are raw and come first even with a fluid.
  const recipes = page.getByRole('table', { name: 'Recipes' });
  await expect(recipes.locator('thead th')).toHaveText([
    'Recipe',
    'Machine',
    'Inputs',
    'Outputs',
    'Count',
    'Build',
    'MW',
  ]);
  const rows = await recipes
    .locator('tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? '')),
    );
  const items = (cell: string) => (cell ? cell.split(', ').map((f) => f.replace(/ \S+$/, '')) : []);
  const made = rows.flatMap((r) => items(r[3]!));
  rows.forEach((r, k) => {
    if (/\((impure|normal|pure)\)/.test(r[0]!)) return;
    const before = new Set(rows.slice(0, k).flatMap((x) => items(x[3]!)));
    for (const input of items(r[2]!)) if (made.includes(input)) expect(before).toContain(input);
  });
  // Inputs and outputs are icon chips with the exact rate on hover.
  await expect(recipes.locator('.io-chip img').first()).toBeVisible();
  await expect(recipes.locator('.io-chip').first()).toHaveAttribute(
    'title',
    /^.+: [\d.,]+.*\/min$/,
  );

  await page.getByRole('tab', { name: /Items/ }).click();
  const table = page.getByRole('table', { name: 'Items' });
  await expect(table.locator('thead th')).toHaveText([
    'Item',
    'Produced',
    'Consumed',
    'Imported',
    'Surplus',
    'Target',
  ]);
  await expect(
    table
      .getByRole('row', { name: /^Iron Plate/ })
      .getByRole('cell')
      .last(),
  ).toHaveText('60.0');
  await page.getByRole('tab', { name: /Recipes/ }).click();
  await expect(recipes).toBeVisible();
});

test('shortcuts: / filters recipes, M switches mode, F fits; the view is kept per factory', async ({
  page,
}) => {
  await openFactory(page);
  await page.getByLabel('Per minute').fill('60');
  await page.getByLabel('Target item').fill('Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await page.getByLabel('Target item').blur();
  // The latest solve is done: Manual can't be picked while it runs.
  await expect(page.locator('[aria-busy=true]')).toHaveCount(0);

  await page.keyboard.press('/');
  await expect(page.getByLabel('Filter recipes')).toBeFocused();
  // Typed into a field, M is just a letter.
  await page.keyboard.type('m');
  await expect(page.getByLabel('Filter recipes')).toHaveValue('m');
  await page.getByLabel('Filter recipes').fill('');
  await page.getByLabel('Filter recipes').blur();

  await page.keyboard.press('m');
  await expect(page.getByTestId('plan-status')).toContainText('manual plan, not solver-checked');
  await page.keyboard.press('m');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');

  // Zoom in, leave for the world, come back: the same view.
  const viewport = page.getByTestId('flowchart').locator('.react-flow__viewport');
  const opened = await viewport.getAttribute('style');
  await page.getByRole('button', { name: 'Zoom In' }).click();
  await expect(viewport).not.toHaveAttribute('style', opened!);
  await expect.poll(() => viewport.getAttribute('style')).toMatch(/scale/);
  const zoomed = await viewport.getAttribute('style');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open Factory', exact: true }).click();
  await expect(viewport).toHaveAttribute('style', zoomed!);

  // F fits the plan, which moves the view again.
  await expect(page.getByRole('button', { name: 'Fit the whole plan' })).toHaveAttribute(
    'title',
    'Fit the whole plan (F)',
  );
  await page.keyboard.press('f');
  await expect(viewport).not.toHaveAttribute('style', zoomed!);
});
