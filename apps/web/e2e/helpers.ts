import { expect, type Page } from '@playwright/test';

/** Loads the app (the world view is home) and drills into a factory by name. */
export async function openFactory(page: Page, name = 'Factory') {
  await page.goto('/');
  await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(name);
  await expect(page.getByLabel('Target item')).toBeVisible();
}
