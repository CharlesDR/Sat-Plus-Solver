/**
 * M8 acceptance (docs/PLAN.md): the world view is home. Factories A and B,
 * a pull link of Iron Plate A → B drawn on the canvas, A's demand follows B,
 * the ledger shows what A sends and B receives, collapsing a group with both
 * hides the internal link, item trace marks exactly what touches the item,
 * the power panel totals the factories, and the breadcrumb drills in and out.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const canvas = (page: Page) => page.getByTestId('world-canvas');
const node = (page: Page, id: string) => canvas(page).locator(`.react-flow__node[data-id="${id}"]`);
const label = (page: Page, edge: string) =>
  canvas(page).locator(`.world-edge-label[data-edge="${edge}"]`);
const tab = (page: Page, name: string) => page.getByRole('tab', { name }).click();
const factoryRow = (page: Page, id: string) => page.locator(`tr[data-factory="${id}"]`);

/** Waits for the world result of the latest edit. */
async function settled(page: Page) {
  await expect(page.locator('.world[aria-busy=true]')).toHaveCount(0);
}

async function addFactory(page: Page, name: string) {
  await page.getByLabel('New factory name').fill(name);
  await page.getByRole('button', { name: 'Add factory' }).click();
}

/** Drags from one canvas node's output handle to another's input handle. */
async function connect(page: Page, from: string, to: string) {
  await settled(page);
  // dragTo waits for both handles to stop moving: the canvas refits after each solve.
  await node(page, from)
    .locator('.react-flow__handle.source')
    .dragTo(node(page, to).locator('.react-flow__handle.target'));
}

/** "<rate> Iron Plate" → rate. */
const plates = (text: string | null) => {
  const m = /^([\d.]+) Iron Plate$/.exec(text ?? '');
  if (!m) throw new Error(`Not a plate rate: "${text}"`);
  return Number(m[1]);
};

/** One ledger row's cells by column name. */
async function ledgerRow(page: Page, item: string): Promise<Record<string, string>> {
  const table = page.getByRole('table', { name: 'Item ledger' });
  const head = await table.locator('thead th').allTextContents();
  const cells = await table.locator(`tr[data-item="${item}"] td`).allTextContents();
  return Object.fromEntries(head.map((h, k) => [h, cells[k]!.trim()]));
}

test('two factories, a pull link, ledger, groups, trace, power and drill-down', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText('World');
  await addFactory(page, 'A');
  await addFactory(page, 'B');
  await expect(node(page, 'factory:factory-1')).toContainText('A');
  await expect(node(page, 'factory:factory-2')).toContainText('B');

  // Drill into B, give it a target, and come back by the breadcrumb.
  await page.getByRole('button', { name: 'Open B', exact: true }).click();
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumbs).toContainText('B');
  await page.getByLabel('Target item').fill('Reinforced Iron Plate');
  await page.getByLabel('Per minute').fill('3');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await crumbs.getByRole('button', { name: 'World' }).click();
  await settled(page);

  // Draw the link on the canvas: the editor opens with A → B filled in.
  await connect(page, 'factory:factory-1', 'factory:factory-2');
  const editor = page.getByRole('form', { name: 'New link' });
  await expect(editor.getByLabel('From', { exact: true })).toHaveValue('factory-1');
  await expect(editor.getByLabel('To', { exact: true })).toHaveValue('factory-2');
  await editor.getByLabel('Item', { exact: true }).fill('Iron Plate');
  await expect(editor.getByLabel('Pull (what the consumer needs)')).toBeChecked();
  // A solid item defaults to belts; a fixed 61/min needs two Mk.1 belts.
  await expect(editor.getByLabel('Transport', { exact: true })).toHaveValue('belt');
  await editor.getByLabel('Fixed rate').check();
  await editor.getByLabel('Rate per minute').fill('61');
  await expect(editor.getByTestId('carriers')).toHaveText('Needs 2 belts.');
  await editor.getByLabel('Pull (what the consumer needs)').check();
  await editor.getByRole('button', { name: 'Create link' }).click();
  await settled(page);

  // A's demand is what B pulls, and it follows B's target.
  await tab(page, 'Factories');
  const demand = factoryRow(page, 'factory-1').getByTestId('link-demand');
  await expect(demand).toHaveText(/^[\d.]+ Iron Plate$/);
  const before = plates(await demand.textContent());
  expect(before).toBeGreaterThan(0);
  await expect(label(page, 'factory:factory-1→factory:factory-2')).toHaveText(
    `${before} Iron Plate`,
  );
  await page.getByRole('button', { name: 'Open B', exact: true }).click();
  await page.getByLabel('Per minute').fill('6');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await crumbs.getByRole('button', { name: 'World' }).click();
  await settled(page);
  await expect(demand).not.toHaveText(`${before} Iron Plate`);
  const rate = plates(await demand.textContent());
  expect(rate).toBeCloseTo(2 * before, 3);
  // Mk.1 belts carry 60/min.
  await tab(page, 'Links');
  await expect(page.locator('tr[data-link="link-1"]')).toContainText('pull');
  await expect(page.locator('tr[data-link="link-1"] td').nth(9)).toHaveText(
    String(Math.ceil(rate / 60)),
  );

  // Ledger: A sends its plates out, B takes them in.
  await tab(page, 'Ledger');
  const scope = page.getByLabel('Ledger scope');
  await scope.selectOption({ label: 'Factory: A' });
  expect(await ledgerRow(page, 'iron-plate')).toMatchObject({
    Exported: String(rate),
    Imported: '0',
  });
  await scope.selectOption({ label: 'Factory: B' });
  expect(await ledgerRow(page, 'iron-plate')).toMatchObject({
    Imported: String(rate),
    Exported: '0',
  });

  // Group A and B; collapsing the group hides the internal link.
  await tab(page, 'Groups');
  await page.getByLabel('New group name').fill('Iron');
  await page.getByRole('button', { name: 'Add group' }).click();
  await tab(page, 'Factories');
  await page.getByLabel('Group of A').selectOption({ label: 'Iron' });
  await page.getByLabel('Group of B').selectOption({ label: 'Iron' });
  await settled(page);
  await expect(node(page, 'group:group-1')).toBeVisible();
  await expect(label(page, 'factory:factory-1→factory:factory-2')).toBeVisible();
  await node(page, 'group:group-1').getByRole('button', { name: 'Collapse' }).click();
  await expect(node(page, 'group:group-1')).toContainText('Group of 2');
  await expect(node(page, 'factory:factory-1')).toHaveCount(0);
  await expect(node(page, 'factory:factory-2')).toHaveCount(0);
  await expect(canvas(page).locator('.world-edge-label.link')).toHaveCount(0);
  await expect(canvas(page).locator('.world-edge-label', { hasText: 'Iron Plate' })).toHaveCount(0);
  // The group ledger nets the internal link out.
  await tab(page, 'Ledger');
  await page.getByLabel('Ledger scope').selectOption({ label: 'Group: Iron' });
  expect(await ledgerRow(page, 'iron-plate')).toMatchObject({ Imported: '0', Exported: '0' });

  // Expand again and trace Iron Plate: exactly A, B and their link light up.
  await node(page, 'group:group-1').getByRole('button', { name: 'Expand' }).click();
  await expect(node(page, 'factory:factory-1')).toBeVisible();
  await page.getByLabel('Trace item').fill('Iron Plate');
  const traced = canvas(page).locator('.react-flow__node:has(> .traced)');
  await expect(traced).toHaveCount(2);
  await expect(node(page, 'factory:factory-1').locator('.world-node')).toHaveClass(/traced/);
  await expect(node(page, 'factory:factory-2').locator('.world-node')).toHaveClass(/traced/);
  await expect(node(page, 'factory:factory-main').locator('.world-node')).toHaveClass(/dimmed/);
  await expect(label(page, 'factory:factory-1→factory:factory-2')).toHaveClass(/traced/);
  await expect(canvas(page).locator('.world-edge-label.traced')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear trace' }).click();
  await expect(canvas(page).locator('.dimmed')).toHaveCount(0);

  // Power panel: the total is the sum of the factory rows. Each cell rounds
  // on its own, so compare the unrounded draws.
  await tab(page, 'Power');
  const power = page.getByRole('table', { name: 'Power by factory' });
  const draw = async (key: string) =>
    Number(await power.locator(`tr[data-power="${key}"]`).getAttribute('data-draw'));
  const parts = await Promise.all(
    ['factory:factory-1', 'factory:factory-2', 'factory:factory-main'].map(draw),
  );
  expect(parts[0]).toBeGreaterThan(0);
  expect(parts[1]).toBeGreaterThan(0);
  expect(await draw('total')).toBeCloseTo(
    parts.reduce((s, x) => s + x, 0),
    3,
  );

  // Drill-down through the group: the breadcrumb shows World › Iron › A.
  await node(page, 'factory:factory-1').getByRole('button', { name: 'Open' }).click();
  await expect(crumbs).toHaveText(/World.*Iron.*A/);
  await expect(page.getByRole('table', { name: 'Targets' })).toContainText('Iron Plate');
  await page.getByLabel('Factory', { exact: true }).selectOption({ label: 'B' });
  await expect(crumbs).toHaveText(/World.*Iron.*B/);
  await expect(page.getByLabel('Target item')).toHaveValue('Reinforced Iron Plate');
});
