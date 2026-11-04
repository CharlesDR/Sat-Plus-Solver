/**
 * UI visibility review (UV-1 to UV-7, Charles 2026-11-01; UV-8 and UV-9 from
 * the 2026-11-04 sweep): on a laptop-sized window the controls a view needs are
 * on screen without scrolling, and a pick or a pop-up never lands out of view.
 */
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { animationsDone, worldSettled } from './helpers';

const README = new URL('../../../README.md', import.meta.url);
const LAPTOP = { width: 1366, height: 768 };

async function openSample(page: Page) {
  const readme = await readFile(README, 'utf8');
  const hash = /https:\/\/charlesdr\.github\.io\/Sat-Plus-Solver\/(#z=[\w-]+)/.exec(readme)![1];
  await page.goto(`/${hash}`);
  await worldSettled(page);
}

async function openFrameFactory(page: Page) {
  await page.getByRole('button', { name: 'Open Frame Factory', exact: true }).click();
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await expect(page.getByTestId('flowchart').locator('.react-flow__node').first()).toBeVisible();
}

/** The part of a locator's box inside the window, 0 to 1. */
const shown = (page: Page, selector: string) =>
  page.locator(selector).evaluate((e) => {
    const r = e.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return (w * h) / (r.width * r.height);
  });

test('the world canvas, its buttons and the panel tabs fit the first screen (UV-1, UV-2)', async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openSample(page);
  const tabs = page.getByRole('tablist', { name: 'World panels' });
  await expect(tabs).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Fit the whole world' })).toBeInViewport({
    ratio: 1,
  });
  // A tab opens its panel in view, with the tabs above it.
  await tabs.getByRole('tab', { name: /^Factories/ }).click();
  await animationsDone(page);
  await expect(page.getByRole('tabpanel')).toBeInViewport();
  await expect(tabs).toBeInViewport({ ratio: 1 });
});

test('a wide world table scrolls in its panel, not the page (UV-3)', async ({ page }) => {
  // Narrow enough that the Factories table overflows its panel with any fonts
  // (at 1024 px it does with some and not others).
  await page.setViewportSize({ width: 800, height: 768 });
  await openSample(page);
  await page.getByRole('tab', { name: /^Factories/ }).click();
  await expect(page.getByRole('table', { name: 'Factories' })).toBeVisible();
  await animationsDone(page);
  const [table, box] = await page
    .getByRole('tabpanel')
    .evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(table).toBeGreaterThan(box!);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(wide).toBeLessThanOrEqual(0);
  // Its row buttons are reached by scrolling the panel sideways.
  const open = page.getByRole('button', { name: 'Open Iron Works (Factories table)' });
  await open.scrollIntoViewIfNeeded();
  await expect(open).toBeInViewport({ ratio: 1 });
  expect(await page.getByRole('tabpanel').evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollX)).toBe(0);
});

test('the flowchart opens with its buttons on screen, and a pick keeps it there (UV-5, UV-6)', async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openSample(page);
  await openFrameFactory(page);
  const chart = page.getByTestId('flowchart');
  for (const name of ['Fullscreen', 'Fit the whole plan'])
    await expect(chart.getByRole('button', { name })).toBeInViewport({ ratio: 1 });
  // Picking a node opens its pop-up and leaves the page where it is.
  // Water opens in view: the chart opens at its left edge, the ore band (A107).
  const node = chart.locator('.react-flow__node[data-id="recipe:water"]');
  await expect(node).toBeInViewport({ ratio: 1 });
  await node.click();
  await expect(page.locator('.flow-tooltip')).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(await shown(page, '.flow-tooltip')).toBe(1);
  // The tweak actions now show above the chart; its buttons stay on screen.
  await expect(page.getByRole('button', { name: /use this recipe/ })).toBeVisible();
  await expect(chart.getByRole('button', { name: 'Fullscreen' })).toBeInViewport({ ratio: 1 });
  // Its row is still marked in the Recipes table below.
  await expect(page.locator('tr.selected')).toContainText('Water');
});

test('the area buttons leave the first area title clear (UV-7)', async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await page.goto('simple/');
  await page.getByLabel('Per minute').fill('10');
  await page.getByLabel('Target item').fill('Modular Frame');
  await page.getByLabel('Target item').press('Enter');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  const chart = page.getByTestId('flowchart');
  const buttons = chart.locator('.flow-expand-all');
  await expect(buttons).toBeAttached();
  await chart.hover({ position: { x: 300, y: 200 } });
  await expect(buttons).toHaveCSS('opacity', '1');
  const overlaps = await chart.evaluate((c) => {
    const b = c.querySelector('.flow-expand-all')!.getBoundingClientRect();
    return [...c.querySelectorAll('.flow-area-head')]
      .map((h) => h.getBoundingClientRect())
      .filter((h) => h.left < b.right && h.right > b.left && h.top < b.bottom && h.bottom > b.top)
      .length;
  });
  expect(overlaps).toBe(0);
});

test('a panel button that opens the link editor shows it below the top bar (UV-8)', async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openSample(page);
  await page.getByRole('tab', { name: /^Spare/ }).click();
  await page.getByRole('button', { name: 'Link Steel Beam from Steel Mill' }).click();
  const editor = page.getByRole('form', { name: 'New link' });
  await expect(editor.getByLabel('Part')).toBeFocused();
  await animationsDone(page);
  // The editor sits above the panel, so it scrolls up into view: not under the sticky bar.
  const bar = await page.locator('header.topbar').evaluate((e) => e.getBoundingClientRect().bottom);
  const top = await editor.evaluate((e) => e.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(bar);
  await expect(editor).toBeInViewport({ ratio: 1 });
});

test('the Shortfalls radios are spaced and clear of the tab row (UV-9)', async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await openSample(page);
  const tabs = page.getByRole('tablist', { name: 'World panels' });
  await tabs.getByRole('tab', { name: /^Shortfalls/ }).click();
  const group = page.getByRole('radiogroup', { name: 'Built factories' });
  await expect(group).toBeVisible();
  const gaps = await group.evaluate((g) => {
    const box = (e: Element) => e.getBoundingClientRect();
    const parts = [...g.children];
    const between = parts.slice(1).map((e, i) => box(e).left - box(parts[i]!).right);
    // From each radio button to its text.
    const text = [...g.querySelectorAll('label')].map((l) => {
      const range = document.createRange();
      range.selectNodeContents(l.lastChild!);
      return range.getBoundingClientRect().left - box(l.querySelector('input')!).right;
    });
    return { between, text };
  });
  for (const gap of gaps.between) expect(gap).toBeGreaterThanOrEqual(8);
  for (const gap of gaps.text) expect(gap).toBeGreaterThanOrEqual(4);
  const tabsBottom = (await tabs.boundingBox())!;
  const groupTop = (await group.boundingBox())!;
  expect(groupTop.y - (tabsBottom.y + tabsBottom.height)).toBeGreaterThanOrEqual(8);
});

test('the world canvas keeps its place while the world is laid out (UV-10)', async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  // Hold the layout worker, so the drawing stays pending until the placeholder is measured.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/layout\.worker[-\w]*\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  await openSample(page);
  const pending = page.locator('.world-canvas .canvas-pending');
  await expect(pending).toBeVisible();
  const before = (await pending.boundingBox())!;
  release();
  const canvas = page.getByTestId('world-canvas');
  await expect(canvas.locator('.react-flow__node').first()).toBeVisible();
  const after = (await canvas.boundingBox())!;
  // The tab row, an open panel and a link editor below don't move when the drawing arrives.
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.height).toBeCloseTo(before.height, 0);
});
