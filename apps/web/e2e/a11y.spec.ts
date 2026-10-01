/**
 * M10 a11y pass (Q-M10-2 default): the main views are axe-clean against
 * WCAG 2.1 A/AA rules, and the core controls work from the keyboard.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addFactory, drawLink, worldSettled } from './helpers';

async function axe(page: Page, what: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} — ${v.nodes
        .map((n) => `${n.target.join(' ')} ${n.html} ${n.failureSummary ?? ''}`)
        .join('; ')}`,
  );
  expect(summary, `axe violations in ${what}`).toEqual([]);
}

test('world view, every panel, the link editor and the save panel are axe-clean', async ({
  page,
}) => {
  await page.goto('/');
  await addFactory(page, 'A');
  await addFactory(page, 'B');
  await worldSettled(page);
  for (const tab of ['Ledger', 'Factories', 'Links', 'Power', 'Nodes', 'Groups']) {
    await page.getByRole('tab', { name: tab }).click();
    await axe(page, `the ${tab} panel`);
  }
  await drawLink(page, 'factory:factory-1', 'factory:factory-2');
  await expect(page.getByRole('form', { name: 'New link' })).toBeVisible();
  await axe(page, 'the link editor');
  await page.locator('details.saves summary').click();
  await axe(page, 'the save panel');
});

test('factory view with a plan, diagnostics and every section open is axe-clean', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Factory', exact: true }).click();
  await page.getByLabel('Target item').fill('Compact Biomass');
  await page.getByLabel('Per minute').fill('10');
  await expect(page.getByRole('region', { name: 'Plan diagnostics' })).toBeVisible();
  await axe(page, 'a plan with diagnostics');

  await page.getByLabel('Target item').fill('Reinforced Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  for (const s of await page.locator('.controls details summary').all()) await s.click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await axe(page, 'the factory view');
});

test('the core controls work from the keyboard', async ({ page }) => {
  await page.goto('/');
  // Add a factory without the mouse.
  await page.getByLabel('New factory name').focus();
  await page.keyboard.type('Keys');
  await page.keyboard.press('Enter');
  const open = page.getByRole('button', { name: 'Open Keys', exact: true });
  await expect(open).toBeVisible();
  await worldSettled(page);

  // The panel tabs follow the tab pattern: arrows move between them, Home/End jump.
  await page.getByRole('tab', { name: 'Factories' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Links' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Links' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Links' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Groups' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Ledger' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Ledger' })).toBeFocused();
  // Only the selected tab is in the tab order.
  await page.keyboard.press('Tab');
  await expect(page.locator('[role=tab]:focus')).toHaveCount(0);

  // Drill in with Enter from the Factories panel, plan, and come back by the breadcrumb.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Factories' })).toBeFocused();
  await open.focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Target item').focus();
  await page.keyboard.type('Iron Plate');
  await page.getByLabel('Per minute').focus();
  await page.keyboard.type('30');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  const world = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', {
    name: 'World',
  });
  await world.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText('World');
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });
  test('the world and factory views are axe-clean in dark mode too', async ({ page }) => {
    await page.goto('/');
    await worldSettled(page);
    await axe(page, 'the dark world view');
    await page.getByRole('button', { name: 'Open Factory', exact: true }).click();
    await page.getByLabel('Target item').fill('Compact Biomass');
    await page.getByLabel('Per minute').fill('10');
    await expect(page.getByRole('region', { name: 'Plan diagnostics' })).toBeVisible();
    await axe(page, 'the dark factory view with diagnostics');
    await page.getByLabel('Target item').fill('Iron Plate');
    await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    await axe(page, 'the dark factory view');
  });
});
