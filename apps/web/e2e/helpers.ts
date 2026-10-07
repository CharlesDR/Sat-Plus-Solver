import { expect, type Page } from '@playwright/test';

/** Loads the app (the world view is home) and drills into a factory by name. */
export async function openFactory(page: Page, name = 'Factory') {
  await page.goto('/');
  await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(name);
  await expect(page.getByLabel('Target item')).toBeVisible();
}

/** The world canvas node of a factory or group, by graph id (`factory:<id>`). */
export const canvasNode = (page: Page, id: string) =>
  page.getByTestId('world-canvas').locator(`.react-flow__node[data-id="${id}"]`);

/** Waits for the world result of the latest edit. */
export async function worldSettled(page: Page) {
  await expect(page.locator('.world[aria-busy=false]')).toHaveCount(1);
}

/** Adds a factory from the world view and waits for its canvas node. */
export async function addFactory(page: Page, name: string) {
  await page.getByLabel('New factory name').fill(name);
  await page.getByRole('button', { name: 'Add factory' }).click();
  await expect(page.getByRole('button', { name: `Open ${name}`, exact: true })).toBeVisible();
}

/** Drags a link from one canvas node's output handle to another's input handle. */
export async function drawLink(page: Page, from: string, to: string) {
  await worldSettled(page);
  await canvasNode(page, from)
    .locator('.react-flow__handle.source')
    .dragTo(canvasNode(page, to).locator('.react-flow__handle.target'));
}

/** The world as autosaved in local storage. */
export const autosaved = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('sps:autosave') ?? 'null') as unknown);

/**
 * Clicks a factory flowchart node. The plan opens at a readable zoom, so a
 * node can lie outside the canvas; Fit shows the whole plan first, so the
 * click lands on the node and not on whatever covers that spot.
 */
export async function clickFlowNode(page: Page, id: string) {
  const chart = page.getByTestId('flowchart');
  await chart.getByRole('button', { name: 'Fit the whole plan' }).click();
  await chart.locator(`.react-flow__node[data-id="${id}"]`).click();
}
