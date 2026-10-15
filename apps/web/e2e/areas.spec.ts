/**
 * G5 (docs/PLAN.md): a large plan is drawn in areas. An area collapses to one
 * box and expands again, its name can be changed for the factory, and the
 * factory can turn grouping off. Areas come from pinch points by default
 * (A87), or from part types; a big new plan opens with big areas collapsed (A89).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { autosaved, openFactory } from './helpers';

const chart = (page: Page) => page.getByTestId('flowchart');
const frames = (page: Page) => chart(page).locator('.flow-area');

/** Picks how areas are made, in the Advanced settings. */
async function groupBy(page: Page, how: 'Pinch points' | 'Part type') {
  const advanced = page.locator('details.advanced');
  if (!(await advanced.getAttribute('open'))) await advanced.locator('> summary').click();
  await page.getByLabel('Group by').selectOption({ label: how });
}

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

test('Plastic 20/min is drawn in areas that collapse, expand and rename (A63, A64)', async ({
  page,
}) => {
  await openFactory(page);
  await plan(page, 'Plastic', '20');
  await groupBy(page, 'Part type');
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
  // "Collapse all areas" shuts every area; Expand all brings them back.
  await chart(page).hover();
  await chart(page).getByRole('button', { name: 'Collapse all areas' }).click();
  await expect(frames(page)).toHaveCount(0);
  await expect(chart(page).getByRole('button', { name: 'Collapse all areas' })).toHaveCount(0);
  await chart(page).hover();
  await chart(page).getByRole('button', { name: 'Expand all areas' }).click();
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

test('areas come from pinch points by default, each with the parts crossing its border (A87)', async ({
  page,
}) => {
  await openFactory(page);
  await plan(page, 'Computer', '5');
  await expect(frames(page).first()).toBeVisible();
  expect(await frames(page).count()).toBeGreaterThan(1);
  // Pinch-point areas carry ids made from what they send out.
  const pinch = chart(page).locator('.flow-area[data-area^="pp:"]');
  expect(await pinch.count()).toBe(await frames(page).count());
  await expect(frames(page).first()).toContainText(/\d+ in · \d+ out/);
  // Part type is one choice away, and saved with the factory.
  await groupBy(page, 'Part type');
  await expect(frames(page).first()).toBeVisible();
  await expect(pinch).toHaveCount(0);
  await expect.poll(async () => JSON.stringify(await autosaved(page))).toContain('"by":"parts"');
});

test('a big new plan opens with its big areas collapsed, and Expand all sticks (A89)', async ({
  page,
}) => {
  await openFactory(page);
  await plan(page, 'Heavy Modular Frame', '5');
  // More than 40 boxes: areas of 10 or more collapse, except the targets' area.
  const boxes = chart(page).locator('.react-flow__node[data-id^="area:"]');
  await expect(boxes.first()).toBeVisible();
  const shut = await boxes.count();
  expect(shut).toBeGreaterThan(0);
  await expect(frames(page)).not.toHaveCount(0);
  await chart(page).hover();
  await chart(page).getByRole('button', { name: 'Expand all areas' }).click();
  await expect(boxes).toHaveCount(0);
  // A change of rate keeps the same recipes, so the user's choice stands.
  await page.getByLabel('Per minute').fill('6');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await expect(chart(page).locator('.react-flow__node').first()).toBeVisible();
  await expect(boxes).toHaveCount(0);
  // A plan of other parts applies the rule again.
  await page.getByLabel('Target item').fill('Modular Engine');
  await page.getByLabel('Per minute').fill('2');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await expect(boxes.first()).toBeVisible();
});
