/**
 * UX-C world panels: a new world has no factory until one is added (UX-8),
 * "Mark every factory as built" sits in the ⋯ menu (UX-10), the Factories
 * table is read-only with a row menu (UX-11), and narrow windows get a
 * settings drawer (UX-14).
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { addFactory, worldSettled } from './helpers';

const README = new URL('../../../README.md', import.meta.url);

test('a new world starts empty, with one way to add a factory (UX-8)', async ({ page }) => {
  await page.goto('/');
  const start = page.getByRole('group', { name: 'Start here' });
  await expect(start).toBeVisible();
  await expect(page.getByTestId('world-canvas').locator('.react-flow__node')).toHaveCount(0);
  await expect(start.getByRole('button')).toHaveText([/Open the sample world/, /Import a file/]);
  await expect(page.getByRole('button', { name: /Add (a )?factory/ })).toHaveCount(1);
  await addFactory(page, 'Smelter');
  await expect(page.getByRole('tab', { name: /^Factories/ })).toContainText('1');
});

test('world actions menu and the read-only Factories table (UX-10, UX-11)', async ({ page }) => {
  const readme = await readFile(README, 'utf8');
  const hash = /https:\/\/charlesdr\.github\.io\/Sat-Plus-Solver\/(#w=[\w$+\-.]+)/.exec(readme)![1];
  await page.goto(`/${hash}`);
  await worldSettled(page);

  // Mark every factory as built lives in the ⋯ menu, not the toolbar.
  const mark = page.getByRole('button', { name: 'Mark every factory as built' });
  await expect(mark).toBeHidden();
  await page.getByTitle('More world actions', { exact: true }).click();
  await mark.click();
  await expect(page.getByRole('region', { name: 'Notifications' })).toContainText(
    'Marked every factory as built.',
  );
  await expect(mark).toBeHidden();

  // The table has no inputs in its rows; the row menu renames and deletes.
  await page.getByRole('tab', { name: /^Factories/ }).click();
  const table = page.getByRole('table', { name: 'Factories' });
  await expect(table.getByRole('textbox')).toHaveCount(0);
  await expect(table.getByRole('combobox')).toHaveCount(0);
  await page.getByTitle('Edit Steel Mill', { exact: true }).click();
  await page.getByLabel('Name of Steel Mill').fill('Steelworks');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Name of Steelworks')).toBeHidden();
  await expect(table.getByRole('cell', { name: 'Steelworks', exact: true })).toHaveCount(1);
  await page.getByTitle('Edit Steelworks', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete Steelworks' }).click();
  await expect(table.getByRole('cell', { name: 'Steelworks', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Steelworks', exact: true })).toHaveCount(0);
});

test('under 1100 px the settings are a drawer over the plan (UX-14)', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/');
  await addFactory(page, 'Factory');
  await page.getByRole('button', { name: 'Open Factory', exact: true }).click();

  // Closed on arrival, so the plan is in view.
  const target = page.getByLabel('Target item');
  await expect(target).toBeHidden();
  await expect(page.locator('.plan-pane')).toBeVisible();

  // Open it: it overlays the plan instead of pushing it down.
  const plan = page.locator('.plan-pane');
  const before = (await plan.boundingBox())!.y;
  await page.getByRole('button', { name: 'Show settings' }).click();
  await expect(target).toBeVisible();
  expect((await plan.boundingBox())!.y).toBe(before);
  const drawer = (await page.locator('#factory-settings').boundingBox())!;
  expect(drawer.x).toBe(0);
  expect(drawer.width).toBeLessThan(1000);

  // Esc closes it, and so does a click on the shaded plan beside it.
  await page.keyboard.press('Escape');
  await expect(target).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Factory');
  await page.getByRole('button', { name: 'Show settings' }).click();
  await expect(target).toBeVisible();
  await page.mouse.click(990, 400);
  await expect(target).toBeHidden();
  await page.getByRole('button', { name: 'Show settings' }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(target).toBeHidden();
});
