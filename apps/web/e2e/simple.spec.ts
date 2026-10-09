/**
 * Simple mode (A72): /simple/ opens straight into one factory, solves, keeps
 * its own autosave apart from the full planner's, and its share links open
 * in simple mode.
 */
import { expect, test } from './fixtures';

test('simple mode: one factory, own saves, share link', async ({ page, freshPage }) => {
  await page.goto('simple/');
  await expect(page.locator('.mode-badge')).toHaveText('Simple mode');
  await expect(page.getByTestId('factory-view')).toBeVisible();
  // No world view, breadcrumb, settings scope, nesting or search.
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: 'Settings apply to' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Search/ })).toHaveCount(0);

  await page.getByLabel('Per minute').fill('60');
  await page.getByLabel('Target item').fill('Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  // Icons resolve from the site root, not /simple/.
  const icon = page.locator('img.cell-icon').first();
  await expect(icon).toBeVisible();
  expect(await icon.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);

  // Its own autosave; the full planner's stays untouched.
  const stored = () =>
    page.evaluate(() => ({
      simple: localStorage.getItem('sps:simple:autosave') !== null,
      main: localStorage.getItem('sps:autosave'),
    }));
  await expect.poll(async () => (await stored()).simple).toBe(true);
  expect((await stored()).main).toBeNull();
  await page.reload();
  await expect(page.getByLabel('Target item')).toHaveValue('Iron Plate');

  // The full planner starts its own world and doesn't see the simple one.
  await page.getByRole('link', { name: 'Full planner' }).click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Factory', exact: true }).click();
  await expect(page.getByLabel('Target item')).toHaveValue('');
  await page.goto('simple/');
  await expect(page.getByLabel('Target item')).toHaveValue('Iron Plate');

  // A share link opens in simple mode.
  await page.locator('details', { hasText: 'Share this factory' }).locator('summary').click();
  await page.getByRole('button', { name: 'Share link to this factory' }).click();
  const url = await page.getByLabel(/^Share link/).inputValue();
  expect(new URL(url).pathname).toMatch(/\/simple\/$/);
  const other = await freshPage();
  await other.goto(url);
  await expect(other.locator('.mode-badge')).toHaveText('Simple mode');
  await expect(other.getByLabel('Target item')).toHaveValue('Iron Plate');
  await expect(other.getByTestId('plan-status')).toContainText('Status: ok');
});
