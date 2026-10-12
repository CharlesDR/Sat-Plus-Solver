/** M10: the README's sample-world link opens the sample, and it solves cleanly. */
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { worldSettled } from './helpers';

const README = new URL('../../../README.md', import.meta.url);

test('the README sample world opens from its link and solves without errors', async ({ page }) => {
  const readme = await readFile(README, 'utf8');
  const hash = /https:\/\/charlesdr\.github\.io\/Sat-Plus-Solver\/(#w=[\w$+\-.]+)/.exec(
    readme,
  )?.[1];
  expect(hash).toBeDefined();
  await page.goto(`/${hash}`);
  for (const name of ['Iron Works', 'Frame Factory', 'Steel Mill', 'Coal Power'])
    await expect(page.getByRole('button', { name: `Open ${name}`, exact: true })).toBeVisible();
  await worldSettled(page);
  await expect(page.locator('.world [role=status]').first()).toHaveText(/World solved in/);
  await page.getByRole('tab', { name: /^Factories/ }).click();
  const statuses = await page.getByTestId('factory-status').allTextContents();
  expect(statuses).toEqual(['ok', 'ok', 'ok', 'ok']);
  // Its power plant nets world power to 0 MW, so the world chip shows no deficit (B4).
  await expect(page.getByTestId('world-status')).toHaveText('World ok');
  await expect(page.getByRole('region', { name: 'World diagnostics' })).toHaveCount(0);
});

test('the world canvas refits as groups collapse and expand, under a docked Add factory (B3)', async ({
  page,
}) => {
  const readme = await readFile(README, 'utf8');
  const hash = /https:\/\/charlesdr\.github\.io\/Sat-Plus-Solver\/(#w=[\w$+\-.]+)/.exec(
    readme,
  )![1]!;
  await page.goto(`/${hash}`);
  await worldSettled(page);
  const canvas = page.getByTestId('world-canvas');
  const group = (id: string) => canvas.locator(`.react-flow__node[data-id="group:${id}"]`);
  // Every box and line label drawn on the canvas, by its text, that sticks out of it.
  const outside = () =>
    canvas.evaluate((el) => {
      const c = el.getBoundingClientRect();
      return [...el.querySelectorAll('.react-flow__node, .world-edge-label')]
        .filter((x) => {
          const r = x.getBoundingClientRect();
          return (
            r.left < c.left - 1 ||
            r.right > c.right + 1 ||
            r.top < c.top - 1 ||
            r.bottom > c.bottom + 1
          );
        })
        .map((x) => x.textContent ?? '');
    });
  await expect.poll(outside).toEqual([]);
  // Add factory sits above the canvas, not over it.
  const form = await page.locator('form.add-factory').boundingBox();
  const box = await canvas.boundingBox();
  expect(form!.y + form!.height).toBeLessThanOrEqual(box!.y);

  await group('starter').getByRole('button', { name: 'Collapse' }).click();
  await expect(group('starter')).toContainText('Group of 2');
  await expect.poll(outside).toEqual([]);
  await group('power').getByRole('button', { name: 'Collapse' }).click();
  await expect(group('power')).toContainText('Group of 1');
  await expect.poll(outside).toEqual([]);
  await group('starter').getByRole('button', { name: 'Expand' }).click();
  await expect(canvas.locator('.react-flow__node[data-id^="factory:"]').first()).toBeVisible();
  await expect.poll(outside).toEqual([]);
});
