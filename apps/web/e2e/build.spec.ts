/**
 * M15 (docs/PLAN.md): build marks. Mark as built matches; raising the target
 * flags Needs expansion; Restore build switches to manual with the built
 * plan; Clear mark removes it; the world view counts factories off their
 * build.
 */
import { expect, test } from './fixtures';
import { openFactory } from './helpers';

test('mark as built, drift, restore, clear', async ({ page }) => {
  await openFactory(page);
  await page.getByLabel('Per minute').fill('60');
  await page.getByLabel('Target item').fill('Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');

  // The Build panel starts closed until the factory is marked (UX-2).
  await page.getByRole('button', { name: /^Build not marked/ }).click();
  await page.getByRole('button', { name: 'Mark as built' }).click();
  const bar = page.getByTestId('build-bar');
  await expect(bar).toContainText('Matches build');

  // Ask for more than the build makes.
  await page.getByLabel('Per minute').fill('80');
  await expect(bar).toContainText("Can't run as built");
  const flags = bar.getByRole('list', { name: 'Build flags' });
  await expect(flags).toContainText('Needs expansion');
  await expect(flags).toContainText('Iron Plate: 20.0/min short');
  await expect(flags).toContainText('Plan changed');
  await expect(bar).toContainText('Changed since the mark: this factory’s settings.');

  // Restore build: manual mode with the built plan, which can't make 80.
  await bar.getByRole('button', { name: 'Restore build' }).click();
  await expect(
    page.getByRole('radiogroup', { name: 'Plan mode' }).getByRole('radio', { name: 'Manual' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(flags).not.toContainText('Plan changed');

  await bar.getByRole('button', { name: 'Clear mark' }).click();
  await expect(page.getByRole('button', { name: 'Mark as built' })).toBeVisible();
});

test('Machines tab: buildings to place, materials, and what an expansion adds (TI-1)', async ({
  page,
}) => {
  await openFactory(page);
  await page.getByLabel('Per minute').fill('60');
  await page.getByLabel('Target item').fill('Iron Plate');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');

  await page.getByRole('tab', { name: /Machines/ }).click();
  const machines = page.getByRole('table', { name: 'Machines' });
  await expect(machines.locator('thead th')).toHaveText(['Machine', 'Build']);
  await expect(machines.getByRole('row', { name: /^Constructor/ })).toBeVisible();
  // Materials to build starts folded, below the machine list.
  const fold = page.locator('details.fold', { hasText: 'Materials to build' });
  await expect(fold).not.toHaveAttribute('open', '');
  await fold.locator('summary').click();
  const materials = page.getByRole('table', { name: 'Materials to build' });
  await expect(materials.getByRole('row', { name: /^Iron Plate/ })).toBeVisible();

  // Marked as built, then raised: To expand shows what to add.
  await page.getByRole('button', { name: /^Build not marked/ }).click();
  await page.getByRole('button', { name: 'Mark as built' }).click();
  await expect(page.getByTestId('build-bar')).toContainText('Matches build');
  await page.getByLabel('Per minute').fill('120');
  await expect(page.getByTestId('build-bar')).toContainText('Needs expansion');
  await expect(machines.locator('thead th')).toHaveText(['Machine', 'Build', 'To expand']);
  await expect(
    machines
      .getByRole('row', { name: /^Constructor/ })
      .getByRole('cell')
      .last(),
  ).toHaveText(/^[1-9]\d*$/);
  await expect(materials.locator('thead th').last()).toHaveText('To expand');

  // Left open, it is folded again after a reload.
  await page.reload();
  await page.getByRole('button', { name: 'Open Factory', exact: true }).click();
  await expect(machines).toBeVisible();
  await expect(fold).not.toHaveAttribute('open', '');
  await expect(materials).toBeHidden();
});
