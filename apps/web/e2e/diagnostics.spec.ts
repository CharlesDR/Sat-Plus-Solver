/**
 * M10 diagnostics UX: a world diagnostic opens the factory that failed, and
 * the factory's diagnostic offers the recipe that fixes it, in one click each.
 * A world solve shows which factory it is on.
 */
import { expect, test } from './fixtures';
import { addFactory, worldSettled } from './helpers';

test('an unreachable target: world diagnostic → factory → one-click recipe fix', async ({
  page,
}) => {
  await page.goto('/');
  await addFactory(page, 'Biomass');
  await page.getByRole('button', { name: 'Open Biomass', exact: true }).click();
  await page.getByLabel('Target item').fill('Compact Biomass');
  await page.getByLabel('Per minute').fill('10');
  await expect(page.getByTestId('plan-status')).toContainText('Status: unreachable');
  const plan = page.getByRole('region', { name: 'Plan diagnostics' });
  await expect(plan.getByRole('heading')).toHaveText('Plan diagnostics: 1 error');
  await expect(plan).toContainText('Error: Nothing can produce Compact Biomass');

  // The world view names the failed factory and links back to it.
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('button', { name: 'World' })
    .click();
  await worldSettled(page);
  const world = page.getByRole('region', { name: 'World diagnostics' });
  await expect(world).toContainText('Biomass has no plan');
  await world.getByRole('button', { name: 'Open Biomass' }).click();

  await plan.getByRole('button', { name: 'Turn on Compact Biomass' }).click();
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await expect(plan).toHaveCount(0);
  await page.locator('summary', { hasText: 'Recipes' }).click();
  await page.getByLabel('Search recipes').fill('compact biomass');
  await expect(page.getByRole('checkbox', { name: 'Compact Biomass', exact: true })).toBeChecked();
});

test('a node budget below the plan: one click per node raises its cap', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Factory', exact: true }).click();
  await page.getByLabel('Target item').fill('Iron Plate');
  await page.getByLabel('Per minute').fill('20');
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');
  await page.locator('summary', { hasText: 'Node budget' }).click();
  await page.getByLabel('Explicit caps').check();
  for (const cap of await page.getByLabel(/^Cap for /).all()) await cap.fill('0');
  await expect(page.getByTestId('plan-status')).toContainText('Status: infeasible');
  const plan = page.getByRole('region', { name: 'Plan diagnostics' });
  await expect(plan).toContainText('Error: Not enough resources');
  const fixes = plan.getByRole('button', { name: /^Raise the .* cap by [\d.e-]+$/ });
  const status = page.getByTestId('plan-status');
  await expect(fixes.first()).toBeVisible();
  // Each fix raises one cap by what the elastic solve asks for; the next solve may ask for
  // another node, so click until the plan is feasible (a handful of clicks at most).
  for (let k = 0; k < 10 && (await status.textContent())?.includes('infeasible'); k++) {
    await fixes.first().click();
    await expect(page.locator('[aria-busy=true]')).toHaveCount(0);
    await expect(page.getByTestId('plan')).toBeVisible();
  }
  await expect(status).toContainText('Status: ok');
  await expect(plan).toHaveCount(0);
});

test('the world status line reports the finished solve', async ({ page }) => {
  await page.goto('/');
  await addFactory(page, 'One');
  await addFactory(page, 'Two');
  await worldSettled(page);
  await expect(page.locator('.world').getByRole('status').first()).toHaveText(
    /World solved in \d+ ms\./,
  );
});
