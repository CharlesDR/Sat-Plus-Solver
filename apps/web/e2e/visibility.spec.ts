/**
 * UI visibility review (UV-1 to UV-7, Charles 2026-11-01): on a laptop-sized
 * window the controls a view needs are on screen without scrolling, and a
 * pick or a pop-up never lands out of view.
 */
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { animationsDone, worldSettled } from './helpers';

const README = new URL('../../../README.md', import.meta.url);
const LAPTOP = { width: 1366, height: 768 };

async function openSample(page: Page) {
  const readme = await readFile(README, 'utf8');
  const hash = /https:\/\/charlesdr\.github\.io\/Sat-Plus-Solver\/(#w=[\w$+\-.]+)/.exec(readme)![1];
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
  const node = chart.locator('.react-flow__node', { hasText: 'Cast Iron Ingot' });
  await expect(node).toBeInViewport({ ratio: 1 });
  await node.click();
  await expect(page.locator('.flow-tooltip')).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(await shown(page, '.flow-tooltip')).toBe(1);
  // The tweak actions now show above the chart; its buttons stay on screen.
  await expect(page.getByRole('button', { name: /use this recipe/ })).toBeVisible();
  await expect(chart.getByRole('button', { name: 'Fullscreen' })).toBeInViewport({ ratio: 1 });
  // Its row is still marked in the Recipes table below.
  await expect(page.locator('tr.selected')).toContainText('Cast Iron Ingot');
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
