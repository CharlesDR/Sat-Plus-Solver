/**
 * M14 (docs/PLAN.md): Satisfactory Modeler files. A factory exported to
 * Modeler and imported back comes in as a factory in manual mode, marked as
 * built, with the same recipes and machine counts; a malformed file shows an
 * error and leaves the world as it was.
 */
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openFactory } from './helpers';

const openPanel = async (page: Page) => {
  const panel = page.locator('details.saves');
  if ((await panel.getAttribute('open')) === null) await panel.locator('summary').click();
  return panel;
};

async function upload(page: Page, name: string, text: string) {
  const panel = await openPanel(page);
  await panel.getByLabel('Import Modeler file (.sfmd)').setInputFiles({
    name,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(text),
  });
  return panel;
}

test('export a factory to Modeler and import it back as built', async ({ page }) => {
  await openFactory(page);
  await page.getByLabel('Per minute').fill('5');
  await page.getByLabel('Target item').fill('Reinforced Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  const table = page.getByRole('table', { name: 'Recipes' });
  await expect(table).toContainText('Reinforced Iron Plate');
  const recipes = await table.textContent();

  await page.getByText('Share this factory').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export to Modeler' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('factory.sfmd');
  const text = await readFile((await download.path())!, 'utf8');
  expect(JSON.parse(text)).toMatchObject({ Solver: 'Manual' });

  const panel = await upload(page, 'factory.sfmd', text);
  await expect(panel.getByRole('status').first()).toContainText(
    'Imported 1 factory from “factory.sfmd”',
  );
  // The import is a second factory, in manual mode and built, with the same recipe table.
  await page.keyboard.press('Escape');
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await crumbs.getByLabel('Factory').selectOption('factory-1');
  await expect(page.getByTestId('plan-status')).toContainText('manual plan, not solver-checked');
  await expect(page.getByTestId('build-bar')).toContainText('Matches build');
  await expect(page.getByRole('table', { name: 'Recipes' })).toHaveText(recipes!);
});

test('a malformed Modeler file shows an error and changes nothing', async ({ page }) => {
  await openFactory(page);
  const panel = await upload(page, 'broken.sfmd', '{"Data": 3}');
  await expect(panel.getByRole('status').first()).toContainText(
    '“broken.sfmd” could not be imported',
  );
  await expect(panel.getByRole('status').first()).toContainText('no "Data" list');
});
