/**
 * Slate 5 on the README sample world: the Spare tab (SC-1) and fixed links
 * that would outgrow a built factory (BF-1, A104).
 */
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { autosaved, worldSettled } from './helpers';

const README = new URL('../../../README.md', import.meta.url);

async function openSample(page: Page) {
  const readme = await readFile(README, 'utf8');
  const hash = /https:\/\/charlesdr\.github\.io\/Sat-Plus-Solver\/(#z=[\w-]+)/.exec(readme)![1]!;
  await page.goto(`/${hash}`);
  await worldSettled(page);
}

test('the Spare tab lists what nothing takes and links it at that rate (SC-1)', async ({
  page,
}) => {
  await openSample(page);
  const tab = page.getByRole('tab', { name: /^Spare/ });
  await tab.click();
  const rows = page.getByRole('table', { name: 'Spare output' }).locator('tbody tr');
  await expect(tab.locator('.tab-count')).toHaveText(String(await rows.count()));
  const beams = page.locator('tr[data-factory=steel-mill][data-item=steel-beam]');
  await expect(beams.locator('td')).toHaveText([
    'Steel Mill',
    'Steel Beam',
    'Untaken For links',
    '40.0',
    'Link…',
  ]);
  await expect(page.locator('tr[data-factory=steel-mill][data-item=sand] td').nth(2)).toHaveText(
    'Byproduct surplus',
  );

  await beams.getByRole('button', { name: 'Link Steel Beam from Steel Mill' }).click();
  const editor = page.getByRole('form', { name: 'New link' });
  await expect(editor.getByLabel('From')).toHaveValue('steel-mill');
  await expect(editor.getByLabel('Part')).toHaveValue('steel-beam');
  await expect(editor.getByRole('radio', { name: 'Fixed rate' })).toBeChecked();
  await expect(editor.getByLabel('Rate per minute')).toHaveValue('40');
});

test('a fixed link above a built factory asks first; under Hold it ships the build (BF-1)', async ({
  page,
}) => {
  await openSample(page);
  await page.getByRole('button', { name: 'Open Iron Works', exact: true }).click();
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await page.locator('button.toolbar-toggle', { hasText: 'Build' }).click();
  await page.getByRole('button', { name: 'Mark as built' }).click();
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('button', { name: 'World' })
    .click();
  await worldSettled(page);

  const rods = page.locator('tr[data-link=rods]');
  const setRods = async (rate: string) => {
    await page.getByRole('tab', { name: /^Links/ }).click();
    await rods.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Rate per minute').fill(rate);
    await page.getByRole('button', { name: 'Save link' }).click();
  };
  const dialog = page.getByRole('alertdialog', { name: 'Scale up Iron Works?' });

  // Cancel leaves the link as it was, with the editor still open.
  await setRods('30');
  await expect(dialog).toContainText('30.0/min of Iron Rod');
  await expect(dialog).toContainText('its build makes 10.0/min for links');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('form', { name: 'Edit link' })).toBeVisible();
  await expect(rods.locator('td').nth(3)).toHaveText('fixed 10.0');
  await page
    .getByRole('form', { name: 'Edit link' })
    .getByRole('button', { name: 'Cancel' })
    .click();

  // Raised under Grow (no dialog), then back to Hold: the link ships the build, and is short.
  await page.getByRole('tab', { name: /^Shortfalls/ }).click();
  await page.getByLabel('Grow with demand').check();
  await setRods('30');
  await expect(dialog).toHaveCount(0);
  await worldSettled(page);
  await page.getByRole('tab', { name: /^Shortfalls/ }).click();
  await page.getByLabel('Hold their size').check();
  await worldSettled(page);
  const row = page.locator('.shortfall-list li[data-factory=iron-works][data-item=iron-rod]');
  await expect(row).toContainText('Iron Works is short 20.0/min of Iron Rod: it holds 10.0/min');
  await expect(row.getByRole('button', { name: 'Add site' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Lower link to 10.0/min' }).click();
  await worldSettled(page);
  await expect(row).toHaveCount(0);
  await page.getByRole('tab', { name: /^Links/ }).click();
  await expect(rods.locator('td').nth(3)).toHaveText('fixed 10.0');

  // Yes, proceed: the link changes and Iron Works scales up.
  await setRods('30');
  await dialog.getByRole('button', { name: 'Yes, proceed' }).click();
  await expect(dialog).toHaveCount(0);
  await worldSettled(page);
  await expect(rods.locator('td').nth(3)).toHaveText('fixed 30.0');
  await expect(rods.locator('td').nth(7)).toHaveText('0.0');
  const saved = (await autosaved(page)) as { factories: { id: string; built?: { grow?: true } }[] };
  expect(saved.factories.find((f) => f.id === 'iron-works')!.built!.grow).toBe(true);
});
