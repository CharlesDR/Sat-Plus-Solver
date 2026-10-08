/**
 * Starting over (N1–N8): name the world, start a new one from Ctrl+K with a
 * save first, undo it from the toast, and open the sample from the start screen.
 */
import { expect, test } from './fixtures';

test('new world: name, save first, undo, start screen', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New factory name').fill('Smelter');
  await page.getByRole('button', { name: 'Add factory' }).click();
  const smelter = page.getByRole('button', { name: 'Open Smelter', exact: true });
  await expect(smelter).toBeVisible();

  // Name the world in the File menu; the top bar shows it.
  const panel = page.locator('details.saves');
  await panel.locator('summary').click();
  await panel.getByLabel('World name').fill('Phase 1');
  await panel.getByLabel('World name').press('Enter');
  await expect(page.locator('.topbar .world-name')).toHaveText('Phase 1');
  await page.keyboard.press('Escape');

  // Ctrl+K › New world, keeping settings and saving the old world first.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search factories and items' }).fill('new world');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'New world' });
  await expect(dialog.getByLabel('Keep my settings')).toBeChecked();
  await dialog.getByLabel('Name', { exact: true }).fill('Phase 2');
  await dialog.getByLabel('Save the current world first as').check();
  await expect(dialog.getByLabel('Save name')).toHaveValue('Phase 1');
  await dialog.getByRole('button', { name: 'Start new world' }).click();
  await expect(dialog).toBeHidden();

  const toast = page.getByRole('region', { name: 'Notifications' });
  await expect(toast).toContainText('Started “Phase 2”.');
  await expect(page.locator('.topbar .world-name')).toHaveText('Phase 2');
  await expect(smelter).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Start here' })).toBeVisible();
  await panel.locator('summary').click();
  await expect(panel.getByRole('button', { name: 'Load Phase 1' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Undo brings the old world back.
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(smelter).toBeVisible();
  await expect(page.locator('.topbar .world-name')).toHaveText('Phase 1');

  // File › New world, empty, then the start screen's sample card.
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: 'New world…' }).click();
  await dialog.getByLabel('Empty').check();
  await dialog.getByRole('button', { name: 'Start new world' }).click();
  await expect(page.locator('.topbar .world-name')).toHaveCount(0);
  await page.getByRole('button', { name: /Open the sample world/ }).click();
  await expect(page.getByRole('button', { name: 'Open Iron Works', exact: true })).toBeVisible();
});
