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
  const statuses = await page.getByTestId('factory-status').allTextContents();
  expect(statuses).toEqual(['ok', 'ok', 'ok', 'ok']);
  await expect(page.getByRole('region', { name: 'World diagnostics' })).toHaveCount(0);
});
