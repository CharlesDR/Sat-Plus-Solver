/**
 * UX-D (A80) on the README sample: each card has a port per part, spare parts
 * sit in the "…" port, a click on a factory shows its raw resources, and a
 * link dragged from a part's port opens the editor with that part picked.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { canvasNode } from './helpers';

const README = new URL('../../../README.md', import.meta.url);

test('ports, the "…" port, raw resources and drag-from-port (UX-D)', async ({ page }) => {
  const readme = await readFile(README, 'utf8');
  const hash = /https:\/\/charlesdr\.github\.io\/Sat-Plus-Solver\/(#w=[\w$+\-.]+)/.exec(
    readme,
  )![1]!;
  await page.goto(`/${hash}`);
  // The sample's first solve is a few seconds on a slow runner.
  await expect(page.locator('.world[aria-busy=false]')).toHaveCount(1, { timeout: 20_000 });
  const card = (name: string) => page.locator('.world-node', { hasText: name });

  // Iron Works ships plates and rods to Frame Factory: a port for each on both cards.
  const makes = card('Iron Works').getByRole('group', { name: 'Makes' });
  const takes = card('Frame Factory').getByRole('group', { name: 'Takes' });
  for (const part of ['iron-plate', 'iron-rod']) {
    await expect(makes.locator(`.world-port[data-port="${part}"]`)).toBeVisible();
    await expect(takes.locator(`.world-port[data-port="${part}"]`)).toBeVisible();
  }
  // No separate surplus box any more: spare parts are in the card's "…" port.
  await expect(page.getByText('Unclaimed surplus')).toHaveCount(0);
  const more = card('Frame Factory').getByRole('button', { name: /more parts?$/ });
  await more.click();
  const list = card('Frame Factory').getByRole('list', { name: 'More parts' });
  await expect(list).toContainText('spare');
  await more.click();
  await expect(list).toHaveCount(0);

  // A click on a factory shows the raw resources it extracts; a second hides them.
  const raw = page.getByRole('list', { name: 'Raw resources of Iron Works' });
  await expect(raw).toHaveCount(0);
  await card('Iron Works').locator('.flow-title').click();
  await expect(raw).toBeVisible();
  await expect(raw.locator('li img').first()).toBeVisible();
  await card('Iron Works').locator('.flow-title').click();
  await expect(raw).toHaveCount(0);

  // Dragging from Steel Mill's beam port pre-fills the part (UX-18).
  const mill = await page
    .locator('.react-flow__node', { has: card('Steel Mill') })
    .getAttribute('data-id');
  const frames = await page
    .locator('.react-flow__node', { has: card('Frame Factory') })
    .getAttribute('data-id');
  await canvasNode(page, mill!)
    .locator('.react-flow__handle[data-handleid="out:steel-beam"]')
    .dragTo(canvasNode(page, frames!).locator('.react-flow__handle[data-handleid="new-in"]'));
  const editor = page.getByRole('form', { name: 'New link' });
  await expect(editor.getByLabel('Part', { exact: true })).toHaveValue('steel-beam');
  await expect(editor.getByLabel('Transport', { exact: true })).toHaveValue('belt');
});
