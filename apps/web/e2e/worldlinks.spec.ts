/**
 * Drawing links on the world canvas (batch W): a drag with no part picked
 * opens the New link form in view with Part focused, and a drag dropped on
 * empty canvas asks for a name and makes a new factory with the link in place.
 */
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addFactory, canvasNode, drawLink, worldSettled } from './helpers';

const README = new URL('../../../README.md', import.meta.url);

test.use({ viewport: { width: 1366, height: 768 } });

test('a "+" to "+" drag opens the New link form in view, Part focused', async ({ page }) => {
  await page.goto('/');
  await addFactory(page, 'A');
  await addFactory(page, 'B');
  await drawLink(page, 'factory:factory-1', 'factory:factory-2');
  const editor = page.getByRole('form', { name: 'New link' });
  await expect(editor).toBeInViewport();
  await expect(editor.getByLabel('Part', { exact: true })).toBeFocused();
});

/** A point on the world canvas with nothing drawn on it. */
async function emptySpot(page: Page) {
  const at = await page.evaluate(() => {
    const pane = document.querySelector('[data-testid=world-canvas] .react-flow__pane');
    const r = pane!.getBoundingClientRect();
    for (let y = r.top + 12; y < r.bottom - 12; y += 12)
      for (let x = r.right - 12; x > r.left + 12; x -= 12)
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane'))
          return { x, y };
    return undefined;
  });
  expect(at).toBeDefined();
  return at!;
}

test('a port dragged to empty canvas makes a new factory with the link (Cancel makes none)', async ({
  page,
}) => {
  const readme = await readFile(README, 'utf8');
  const hash = /https:\/\/charlesdr\.github\.io\/Sat-Plus-Solver\/(#w=[\w$+\-.]+)/.exec(
    readme,
  )![1]!;
  await page.goto(`/${hash}`);
  await expect(page.locator('.world[aria-busy=false]')).toHaveCount(1, { timeout: 20_000 });
  const factories = page.getByRole('tab', { name: /^Factories/ });
  const before = await factories.textContent();
  const mill = await page
    .locator('.react-flow__node', { has: page.locator('.world-node', { hasText: 'Steel Mill' }) })
    .getAttribute('data-id');
  const port = canvasNode(page, mill!).locator(
    '.react-flow__handle[data-handleid="out:steel-beam"]',
  );
  const drop = async () => {
    const at = await emptySpot(page);
    await port.hover();
    await page.mouse.down();
    await page.mouse.move(at.x, at.y, { steps: 8 });
    await page.mouse.up();
  };
  const prompt = page.getByRole('form', { name: 'New factory for this link' });

  await drop();
  await expect(prompt).toContainText('Steel Beam');
  await prompt.getByRole('button', { name: 'Cancel' }).click();
  await expect(prompt).toHaveCount(0);
  await expect(factories).toHaveText(before!);

  await drop();
  await prompt.getByLabel('Factory name').fill('Beam Yard');
  await prompt.getByRole('button', { name: 'Create factory' }).click();
  await worldSettled(page);
  await expect(page.locator('.world-node', { hasText: 'Beam Yard' })).toBeVisible();
  const row = page.getByRole('table', { name: 'Links' }).locator('tr.flash');
  await expect(row).toContainText('Steel Mill');
  await expect(row).toContainText('Beam Yard');
  await expect(row).toContainText('Steel Beam');
});

test('a new link starts fixed at what the source has spare, byproducts included (DF-4)', async ({
  page,
}) => {
  await page.goto('/');
  await addFactory(page, 'A');
  await addFactory(page, 'B');
  await page.getByRole('button', { name: 'Open A', exact: true }).click();
  await page.getByLabel('Target item').fill('Plastic');
  await page.getByLabel('Per minute').fill('20');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await crumbs.getByRole('button', { name: 'World' }).click();
  await worldSettled(page);

  await drawLink(page, 'factory:factory-1', 'factory:factory-2');
  const editor = page.getByRole('form', { name: 'New link' });
  const part = editor.getByLabel('Part', { exact: true });
  const fixed = editor.getByLabel('Fixed rate');
  const rate = editor.getByLabel('Rate per minute');
  // A target's untaken For links rate: fixed at all of it.
  await part.selectOption({ label: 'Plastic (20.0 of 20.0 available)' });
  await expect(fixed).toBeChecked();
  await expect(rate).toHaveValue('20');
  // A byproduct lists its surplus and starts fixed at it, rounded down to 0.01/min.
  const byproduct = part.locator('option', { hasText: /\/min spare\)$/ }).first();
  const text = (await byproduct.textContent())!;
  const spare = Number(/\(([\d.,]+)\/min spare\)$/.exec(text)![1]!.replace(/,/g, ''));
  await part.selectOption({ label: text });
  await expect(fixed).toBeChecked();
  expect(Number(await rate.inputValue())).toBeLessThanOrEqual(spare);
  expect(Number(await rate.inputValue())).toBeGreaterThan(spare - 0.01 - 1e-9);
  // Once the mode is chosen by hand, another part keeps it.
  await editor.getByLabel('Pull (what the consumer needs)').check();
  await part.selectOption({ label: 'Plastic (20.0 of 20.0 available)' });
  await expect(editor.getByLabel('Pull (what the consumer needs)')).toBeChecked();
});
