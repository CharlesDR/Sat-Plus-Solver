/**
 * MV-1 (A111): the SF+ chip in the top bar. A new world starts on the newest
 * mod version; switching re-solves, keeps a manual plan's counts with a note
 * naming the recipes that changed, undoes from the toast and survives a reload.
 */
import { expect, test } from './fixtures';
import { autosaved, openFactory } from './helpers';

test('switch a world between SF+ versions', async ({ page }) => {
  await openFactory(page);
  const chip = page.getByRole('combobox', { name: 'SF+ mod version' });
  await expect(chip).toHaveValue('2026.4.651');
  await expect(chip.locator('option:checked')).toHaveText('2026.4.651 (newest)');

  // Cobalt Plates takes 30 ingots a minute per constructor in 2026.4.651, 60 in 2026.3.489;
  // three recipes further up its chain changed too.
  await page.getByLabel('Per minute').fill('30');
  await page.getByLabel('Target item').fill('Cobalt Plates');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await page
    .getByRole('radiogroup', { name: 'Plan mode' })
    .getByRole('radio', { name: 'Manual' })
    .click();
  await expect(page.getByTestId('plan-status')).toContainText('manual plan, not solver-checked');

  await chip.selectOption('2026.3.489');
  const toast = page.getByRole('region', { name: 'Notifications' });
  await expect(toast).toContainText('Now on SF+ 2026.3.489; every factory re-solves.');
  await expect(toast).toContainText('Manual factory Factory kept its machine counts');
  await expect(chip).toHaveValue('2026.3.489');
  const note = page.getByRole('region', { name: 'Manual plan' }).locator('.version-note');
  await expect(note).toContainText(
    'SF+ 2026.3.489 changed 4 recipes in this plan: Apple, Cobalt Plates, Molten Cobalt, Mycelia (fertilized).',
  );
  await expect
    .poll(
      async () => ((await autosaved(page)) as { meta: { modVersion?: string } }).meta.modVersion,
    )
    .toBe('2026.3.489');

  // The version is part of the world: it comes back after a reload.
  await page.reload();
  await expect(chip).toHaveValue('2026.3.489');
  await page.getByRole('button', { name: 'Open Factory', exact: true }).click();
  await expect(note).toBeVisible();
  await note.getByRole('button', { name: 'Dismiss' }).click();
  await expect(note).toHaveCount(0);

  // Switching back is one undo step from its toast.
  await chip.selectOption('2026.4.651');
  await expect(toast).toContainText('Now on SF+ 2026.4.651');
  await toast.getByRole('button', { name: 'Undo' }).last().click();
  await expect(chip).toHaveValue('2026.3.489');
});
