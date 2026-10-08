/**
 * Miner support (A71): a factory whose miner fluid is supplied from outside
 * (a new world's default, A69) gets it from one click's Miner support factory.
 */
import { expect, test } from './fixtures';
import { openFactory, worldSettled } from './helpers';

test('one click adds Miner support and links the supplied fluid', async ({ page }) => {
  await openFactory(page);
  await page.getByLabel('Target item').fill('Kerr Crystal');
  await page.getByLabel('Per minute').fill('30');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('button', { name: 'World' })
    .click();
  await worldSettled(page);

  await page.getByRole('button', { name: 'Add Miner support factory' }).click();
  await expect(page.getByRole('region', { name: 'Notifications' })).toContainText(
    /Linked \d+ miner fluids? from Miner support\./,
  );
  await expect(page.getByRole('button', { name: 'Open Miner support', exact: true })).toBeVisible();
  await worldSettled(page);
  // Everything supplied is now linked, so the button goes away.
  await expect(page.getByRole('button', { name: /Miner support (factory|\()/ })).toHaveCount(0);
});
