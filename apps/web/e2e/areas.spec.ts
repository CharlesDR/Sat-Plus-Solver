/**
 * G5 (docs/PLAN.md): a large plan is drawn in areas. An area collapses to one
 * box and expands again, its name can be changed for the factory, and the
 * factory can turn grouping off.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { autosaved, openFactory } from './helpers';

const chart = (page: Page) => page.getByTestId('flowchart');
const frames = (page: Page) => chart(page).locator('.flow-area');

async function plan(page: Page, item: string, rate: string) {
  await page.getByLabel('Per minute').fill(rate);
  await page.getByLabel('Target item').fill(item);
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await expect(chart(page).locator('.react-flow__node').first()).toBeVisible();
}

test('a small plan stays one flowchart', async ({ page }) => {
  await openFactory(page);
  await plan(page, 'Iron Plate', '60');
  await expect(frames(page)).toHaveCount(0);
});

test('Plastic 20/min is drawn in areas that collapse, expand and rename (A60, A61)', async ({
  page,
}) => {
  await openFactory(page);
  await plan(page, 'Plastic', '20');
  await expect(frames(page).first()).toBeVisible();
  expect(await frames(page).count()).toBeGreaterThan(1);
  const refining = chart(page).locator('.flow-area[data-area="oil-refining"]');
  await expect(refining).toContainText('Oil Refining');
  await expect(refining).toContainText(/machines · .* MW/);

  // Collapse to one box, then expand with "Expand all areas". Fit first: the
  // plan opens at a readable zoom, which can leave a title bar out of view.
  const fit = () => chart(page).getByRole('button', { name: 'Fit the whole plan' }).click();
  await fit();
  await refining.getByRole('button', { name: 'Collapse Oil Refining' }).click();
  await expect(refining).toHaveCount(0);
  const box = chart(page).locator('.react-flow__node[data-id="area:oil-refining"]');
  await expect(box).toBeVisible();
  await chart(page).hover();
  await chart(page).getByRole('button', { name: 'Expand all areas' }).click();
  await expect(box).toHaveCount(0);
  await expect(refining).toBeVisible();

  // Rename for this factory; it is saved with the world.
  await fit();
  await refining.locator('.flow-area-name').dblclick();
  const name = page.getByRole('textbox', { name: 'Area name' });
  await name.fill('Refinery Row');
  await name.press('Enter');
  await expect(refining).toContainText('Refinery Row');
  await expect
    .poll(async () => JSON.stringify(await autosaved(page)))
    .toContain('"oil-refining":"Refinery Row"');

  // Move the Plastic maker out of Final Assembly from its tooltip.
  await fit();
  const maker = chart(page).locator('.react-flow__node[aria-label^="Recipe: Cured Plastic"]');
  const id = await maker.getAttribute('data-id');
  await maker.click();
  await page.getByRole('dialog').getByLabel('Area').selectOption({ label: 'Refinery Row' });
  await expect
    .poll(async () => JSON.stringify(await autosaved(page)))
    .toContain(`"${id}":"oil-refining"`);

  // Grouping off draws one flowchart.
  await page.getByRole('checkbox', { name: 'Disable factory component grouping' }).check();
  await expect(frames(page)).toHaveCount(0);
});
