/**
 * M10 acceptance (docs/PLAN.md): one journey through the whole app,
 * world → link → drill-down → toggle → back → export → import → reload,
 * with no console errors (the fixture fails the test on any).
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { addFactory, autosaved, canvasNode, drawLink, worldSettled } from './helpers';

test('world → link → drill-down → toggle → back → export → import → reload', async ({
  page,
  freshPage,
}) => {
  // World: two factories; Frames makes Reinforced Iron Plate.
  await page.goto('/');
  await addFactory(page, 'Plates');
  await addFactory(page, 'Frames');
  await page.getByRole('button', { name: 'Open Frames', exact: true }).click();
  await page.getByLabel('Target item').fill('Reinforced Iron Plate');
  await page.getByLabel('Per minute').fill('10');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await crumbs.getByRole('button', { name: 'World' }).click();

  // Link: Plates → Frames, Iron Plate, pulled.
  await drawLink(page, 'factory:factory-1', 'factory:factory-2');
  const editor = page.getByRole('form', { name: 'New link' });
  await editor.getByLabel('Item', { exact: true }).fill('Iron Plate');
  await editor.getByRole('button', { name: 'Create link' }).click();
  await worldSettled(page);
  await page.getByRole('tab', { name: 'Factories' }).click();
  const demand = page.locator('tr[data-factory="factory-1"]').getByTestId('link-demand');
  await expect(demand).toHaveText(/^[\d.]+ Iron Plate$/);
  const before = await demand.textContent();

  // Drill down from the canvas, and toggle an alternate on in Frames.
  await canvasNode(page, 'factory:factory-2').getByRole('button', { name: 'Open' }).click();
  await expect(crumbs).toContainText('Frames');
  await page.locator('summary', { hasText: 'Recipes' }).click();
  await page.getByLabel('Search recipes').fill('stitched iron plate');
  await page.getByRole('checkbox', { name: 'Stitched Iron Plate' }).check();
  await expect(page.locator('[aria-busy=true]')).toHaveCount(0);
  await expect(
    page.locator('[data-testid=plan] table[aria-label=Recipes] tbody tr td:first-child', {
      hasText: 'Stitched Iron Plate',
    }),
  ).toHaveCount(1);
  await expect(page.locator('section.diagnostics')).toHaveCount(0);

  // Back: Plates now sends what the new recipe pulls.
  await crumbs.getByRole('button', { name: 'World' }).click();
  await worldSettled(page);
  await page.getByRole('tab', { name: 'Factories' }).click();
  await expect(demand).toHaveText(/^[\d.]+ Iron Plate$/);
  await expect(demand).not.toHaveText(before!);
  const after = await demand.textContent();
  const world = await autosaved(page);

  // Export, then import into a fresh browser: the same world and the same plan.
  await page.locator('details.saves summary').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export world', exact: true }).click(),
  ]);
  const file = JSON.parse(await readFile((await download.path())!, 'utf8')) as unknown;
  expect(file).toEqual(world);

  const other = await freshPage();
  await other.goto('/');
  await other.locator('details.saves summary').click();
  await other.getByLabel('Import world file').setInputFiles({
    name: 'journey.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect(other.locator('details.saves').getByRole('status')).toContainText(
    'Imported “journey.json”.',
  );
  expect(await autosaved(other)).toEqual(world);
  await worldSettled(other);
  await other.getByRole('tab', { name: 'Factories' }).click();
  const otherDemand = other.locator('tr[data-factory="factory-1"]').getByTestId('link-demand');
  await expect(otherDemand).toHaveText(after!);

  // Reload: the world comes back from the autosave, the alternate still on.
  await other.reload();
  await worldSettled(other);
  await other.getByRole('tab', { name: 'Factories' }).click();
  await expect(otherDemand).toHaveText(after!);
  expect(await autosaved(other)).toEqual(world);
  await other.getByRole('button', { name: 'Open Frames', exact: true }).click();
  await other.locator('summary', { hasText: 'Recipes' }).click();
  await other.getByLabel('Search recipes').fill('stitched iron plate');
  await expect(other.getByRole('checkbox', { name: 'Stitched Iron Plate' })).toBeChecked();
});
