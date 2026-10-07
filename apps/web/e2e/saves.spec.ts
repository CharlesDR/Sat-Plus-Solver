/**
 * M9 acceptance (docs/PLAN.md): local save slots and the autosave survive a
 * reload, a world exported to JSON imports back equal, a share link opens
 * the same world elsewhere, an old save migrates, a data-hash mismatch shows
 * a banner and still loads, an oversized world falls back to export, and
 * "share this factory only" shares a one-factory world.
 */
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const AUTOSAVE = 'sps:autosave';
const V1 = new URL('../../../fixtures/worlds/v1-world.json', import.meta.url);

const openPanel = async (page: Page) => {
  const panel = page.locator('details.saves');
  if ((await panel.getAttribute('open')) === null) await panel.locator('summary').click();
  return panel;
};
/** The canvas's open button for a factory, by name. */
const opener = (page: Page, name: string) =>
  page.getByRole('button', { name: `Open ${name}`, exact: true });
const autosave = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown, AUTOSAVE);

async function addFactory(page: Page, name: string) {
  await page.getByLabel('New factory name').fill(name);
  await page.getByRole('button', { name: 'Add factory' }).click();
  await expect(page.getByRole('button', { name: `Open ${name}`, exact: true })).toBeVisible();
}

async function upload(page: Page, name: string, doc: unknown) {
  const panel = await openPanel(page);
  await panel.getByLabel('Import world file').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(typeof doc === 'string' ? doc : JSON.stringify(doc)),
  });
}

/** Exports through a button and returns the downloaded document. */
async function exported(page: Page, button: string): Promise<unknown> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: button, exact: true }).click(),
  ]);
  return JSON.parse(await readFile((await download.path())!, 'utf8')) as unknown;
}

test('save slots and the autosave survive a reload', async ({ page }) => {
  await page.goto('/');
  await addFactory(page, 'Smelter');
  const panel = await openPanel(page);
  await panel.getByLabel('Save name').fill('Base');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText(/Saved “Base”/);

  // The autosave brings the world back after a reload.
  await page.reload();
  await expect(opener(page, 'Smelter')).toBeVisible();

  // Edit, then load the slot: the edit is gone, and "restore" brings it back.
  await addFactory(page, 'Later');
  const p2 = await openPanel(page);
  await p2.getByRole('button', { name: 'Load Base' }).click();
  await expect(p2.getByRole('status')).toContainText('Loaded “Base”.');
  await expect(opener(page, 'Later')).toHaveCount(0);
  await expect(opener(page, 'Smelter')).toBeVisible();
  await p2.getByRole('button', { name: 'Restore previous world' }).click();
  await expect(opener(page, 'Later')).toBeVisible();

  await p2.getByRole('button', { name: 'Delete Base' }).click();
  await expect(p2.getByRole('button', { name: 'Load Base' })).toHaveCount(0);
});

test('World → JSON → World and World → URL → World are deep-equal', async ({ page, freshPage }) => {
  await page.goto('/');
  await addFactory(page, 'Smelter');
  await page.getByRole('button', { name: 'Open Smelter', exact: true }).click();
  await page.getByLabel('Target item').fill('Iron Plate');
  await page.getByLabel('Per minute').fill('30');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  const world = await autosave(page);

  const panel = await openPanel(page);
  const file = await exported(page, 'Export world');
  expect(file).toEqual(world);

  // Import into a fresh browser: the same world, and the same plan.
  const other = await freshPage();
  await other.goto('/');
  await upload(other, 'world.json', file);
  await expect((await openPanel(other)).getByRole('status')).toContainText(
    'Imported “world.json”.',
  );
  await expect(opener(other, 'Smelter')).toBeVisible();
  expect(await autosave(other)).toEqual(world);
  await expect(other.getByRole('alert')).toHaveCount(0);

  // Share link: open it in another fresh browser.
  await panel.getByRole('button', { name: 'Share link to world' }).click();
  const url = await panel.getByLabel(/^Share link/).inputValue();
  expect(url).toMatch(/#w=/);
  const third = await freshPage();
  await third.goto(url);
  await expect(opener(third, 'Smelter')).toBeVisible();
  expect(await autosave(third)).toEqual(world);
  // The link leaves the address bar once loaded, so a reload keeps later edits.
  expect(new URL(third.url()).hash).toBe('');
  await expect((await openPanel(third)).getByRole('status')).toContainText(
    'Opened a shared world.',
  );
});

test('an old save migrates, and a data-hash mismatch warns but loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open Factory', exact: true })).toBeVisible();
  // v1 (M3) save, made against other game data ("abc123").
  await upload(page, 'old.json', await readFile(V1, 'utf8'));
  await expect(page.getByRole('alert')).toContainText('different game data (abc123)');
  const w = (await autosave(page)) as { meta: { v: number; dataHash: string } };
  expect(w.meta).toEqual({ v: 9, dataHash: 'abc123' });
  await page.getByRole('button', { name: 'Open Factory', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Targets' })).toContainText('Iron Plate');

  // A file that isn't a world is refused, and the world stays.
  await upload(page, 'bad.json', '{"meta": {"v": 99}}');
  await expect((await openPanel(page)).getByRole('status')).toContainText(
    '“bad.json” could not be imported: This world was saved by a newer version (v99)',
  );
  await expect(page.getByRole('alert')).toContainText('different game data (abc123)');
});

test('an oversized world falls back to export', async ({ page }) => {
  await page.goto('/');
  // Notes that compress badly push the payload past 8 KB.
  let s = 7;
  const noise = Array.from({ length: 20000 }, () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return String.fromCharCode(33 + (s % 90));
  }).join('');
  const world = (await autosave(page)) as { factories: { notes: string }[] };
  world.factories[0]!.notes = noise;
  await upload(page, 'big.json', world);
  const panel = await openPanel(page);
  await expect(panel.getByRole('status')).toContainText('Imported “big.json”.');
  await panel.getByRole('button', { name: 'Share link to world' }).click();
  await expect(panel.getByRole('alert')).toContainText('too big for a link');
  await expect(panel.getByLabel(/^Share link/)).toHaveCount(0);
  const file = (await exported(page, 'Export file')) as { factories: { notes: string }[] };
  expect(file.factories[0]!.notes).toBe(noise);
});

test('share this factory only', async ({ page, freshPage }) => {
  await page.goto('/');
  await addFactory(page, 'Plates');
  await page.getByRole('button', { name: 'Open Plates', exact: true }).click();
  await page.getByLabel('Target item').fill('Iron Plate');
  await page.getByLabel('Per minute').fill('20');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await page.locator('details', { hasText: 'Share this factory' }).locator('summary').click();
  const file = (await exported(page, 'Export this factory')) as {
    factories: { id: string; name: string; request: unknown }[];
  };
  expect(file.factories.map((f) => f.name)).toEqual(['Plates']);
  expect(file.factories[0]!.request).toEqual({ targets: [{ item: 'iron-plate', rate: 20 }] });

  await page.getByRole('button', { name: 'Share link to this factory' }).click();
  const url = await page.getByLabel(/^Share link/).inputValue();
  const other = await freshPage();
  await other.goto(url);
  await expect(other.getByRole('button', { name: 'Open Plates', exact: true })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Open Factory', exact: true })).toHaveCount(0);
});
