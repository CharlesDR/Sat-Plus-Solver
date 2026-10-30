/**
 * UX-D (A80) on the README sample: each card has a port per part, spare parts
 * have ports of their own below the targets (DF-3), a click on a factory
 * shows its raw resources, and a link dragged from a part's port opens the
 * editor with that part picked. Past eight outputs, Kept-only targets fold
 * into the "…" port first.
 */
import { readFile } from 'node:fs/promises';
import lzString from 'lz-string';
import { expect, test } from './fixtures';
import { canvasNode } from './helpers';

const README = new URL('../../../README.md', import.meta.url);

test('ports, byproduct ports, raw resources and drag-from-port (UX-D, DF-3)', async ({ page }) => {
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
  // No separate surplus box: Frame Factory's byproducts are ports below its target (DF-3).
  await expect(page.getByText('Unclaimed surplus')).toHaveCount(0);
  const frameOuts = card('Frame Factory')
    .getByRole('group', { name: 'Makes' })
    .locator('.world-port[data-port]');
  await expect(frameOuts.first()).toHaveAttribute('data-port', 'modular-frame');
  await expect(frameOuts.last()).toHaveAttribute('title', /spare \(byproduct\)$/);

  // A click on a factory shows the raw resources it extracts; a second hides them.
  const raw = page.getByRole('list', { name: 'Raw resources of Iron Works' });
  await expect(raw).toHaveCount(0);
  await card('Iron Works').locator('.flow-title').click();
  await expect(raw).toBeVisible();
  await expect(raw.locator('li img').first()).toBeVisible();
  await card('Iron Works').locator('.flow-title').click();
  await expect(raw).toHaveCount(0);

  // Dragging from Steel Mill's beam port makes the link at once, with no form,
  // and marks its row in the Links tab.
  const mill = await page
    .locator('.react-flow__node', { has: card('Steel Mill') })
    .getAttribute('data-id');
  const frames = await page
    .locator('.react-flow__node', { has: card('Frame Factory') })
    .getAttribute('data-id');
  await canvasNode(page, mill!)
    .locator('.react-flow__handle[data-handleid="out:steel-beam"]')
    .dragTo(canvasNode(page, frames!).locator('.react-flow__handle[data-handleid="new-in"]'));
  await expect(page.getByRole('form', { name: 'New link' })).toHaveCount(0);
  const row = page.getByRole('table', { name: 'Links' }).locator('tr.flash');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Steel Mill');
  await expect(row).toContainText('Frame Factory');
  await expect(row).toContainText('Steel Beam');
  await expect(row).toContainText('pull');
  await expect(row).toBeInViewport();
});

/** A hub with two linked parts, one unlinked For links target and six Kept-only ones. */
const plain = { unassignedImports: [], resources: {}, priority: 0, notes: '', tweaks: [] };
const kept = ['iron-plate', 'iron-rod', 'screws', 'cable', 'wire', 'concrete'];
const hub = {
  meta: { v: 16, dataHash: '' },
  factories: [
    {
      id: 'hub',
      name: 'Parts Hub',
      request: {
        targets: [
          { item: 'iron-ingot', rate: 40 },
          { item: 'copper-ingot', rate: 30 },
          { item: 'tin-ingot', rate: 20 },
          ...kept.map((item) => ({ item, rate: 0, kept: 10 })),
        ],
      },
      ...plain,
    },
    ...['iron-ingot', 'copper-ingot'].map((item) => ({
      id: `use-${item}`,
      name: `Uses ${item}`,
      request: { targets: [{ item: 'iron-rod', rate: 1 }] },
      ...plain,
      unassignedImports: [{ item }],
    })),
  ],
  groups: [],
  links: ['iron-ingot', 'copper-ingot'].map((item, k) => ({
    id: `link-${k + 1}`,
    from: 'hub',
    to: `use-${item}`,
    item,
    mode: { kind: 'pull' },
  })),
  defaults: {
    objectives: ['scarcity'],
    tolerance: 0.0001,
    alternates: false,
    wholeMachines: false,
    costImports: true,
    avoidFluidByproducts: true,
    minerFluids: 'water',
    minerFluidSupply: 'outside',
    recipes: {},
    maxTier: null,
    simplicity: true,
    builtFactories: 'grow',
  },
  nodePool: {},
};

test('outputs in bands: for links, byproducts, then Kept, which folds first (DF-3)', async ({
  page,
}) => {
  await page.goto(`/#w=${lzString.compressToEncodedURIComponent(JSON.stringify(hub))}`);
  await expect(page.locator('.world[aria-busy=false]')).toHaveCount(1, { timeout: 20_000 });
  const card = page.locator('.world-node', { hasText: 'Parts Hub' });
  const ports = card.getByRole('group', { name: 'Makes' }).locator('.world-port[data-port]');
  await expect(ports.nth(2)).toHaveAttribute('data-port', 'tin-ingot');
  const order = await ports.evaluateAll((els) => els.map((e) => e.getAttribute('data-port')));
  expect(order.slice(0, 2).sort()).toEqual(['copper-ingot', 'iron-ingot']);
  // Below the parts for links come the byproducts, then the Kept-only targets.
  await expect(ports.nth(3)).toHaveAttribute('title', /spare \(byproduct\)$/);
  expect(kept).toContain(order.at(-1));
  // Seven ports and "…": the Kept-only targets that don't fit are listed there.
  await expect(ports).toHaveCount(7);
  const more = card.getByRole('button', { name: /more parts?$/ });
  await more.click();
  const list = card.getByRole('list', { name: 'More parts' });
  await expect(list).toBeVisible();
  await expect(list).not.toContainText('spare');
  await more.click();
  await expect(list).toHaveCount(0);
});
