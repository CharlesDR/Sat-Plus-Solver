import { expect, type Locator, type Page } from '@playwright/test';

/** Loads the app (the world view is home) and drills into a factory by name. */
export async function openFactory(page: Page, name = 'Factory') {
  await page.goto('/');
  // A new world starts with no factory (UX-8): the default one is added first.
  if (name === 'Factory') await addFactory(page, name);
  await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(name);
  await expect(page.getByLabel('Target item')).toBeVisible();
}

/** The world canvas node of a factory or group, by graph id (`factory:<id>`). */
export const canvasNode = (page: Page, id: string) =>
  page.getByTestId('world-canvas').locator(`.react-flow__node[data-id="${id}"]`);

/** Waits for the world result of the latest edit. */
export async function worldSettled(page: Page) {
  // A whole-world solve (the sample world's four factories) can run past the
  // default 5 s on a CI runner; this is a wait, not a result tolerance.
  await expect(page.locator('.world[aria-busy=false]')).toHaveCount(1, { timeout: 20_000 });
}

/** Adds a factory from the world view and waits for its canvas node. */
export async function addFactory(page: Page, name: string) {
  await page.getByLabel('New factory name').fill(name);
  await page.getByRole('button', { name: 'Add factory' }).click();
  await expect(page.getByRole('button', { name: `Open ${name}`, exact: true })).toBeVisible();
}

/** Drags a link from one canvas node's output handle to another's input handle. */
export async function drawLink(page: Page, from: string, to: string) {
  await worldSettled(page);
  await canvasNode(page, from)
    .locator('.react-flow__handle[data-handleid="new-out"]')
    .dragTo(canvasNode(page, to).locator('.react-flow__handle[data-handleid="new-in"]'));
}

/** The world as autosaved in local storage. */
export const autosaved = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('sps:autosave') ?? 'null') as unknown);

/**
 * Clicks a factory flowchart node. The plan opens at a readable zoom, so a
 * node can lie outside the canvas; Fit shows the whole plan first, so the
 * click lands on the node and not on whatever covers that spot.
 */
export async function clickFlowNode(page: Page, id: string) {
  const chart = page.getByTestId('flowchart');
  await chart.getByRole('button', { name: 'Fit the whole plan' }).click();
  await chart.locator(`.react-flow__node[data-id="${id}"]`).click();
}

/**
 * Opens or closes a section by its header and waits for its transition to end
 * (R5): the browser lists no animation for it, so this waits until its height
 * holds still from one frame to the next.
 */
export async function toggleSection(summary: Locator) {
  await summary.click();
  await expect
    .poll(() =>
      summary.locator('xpath=..').evaluate(
        (el) =>
          new Promise<boolean>((done) => {
            const h = el.getBoundingClientRect().height;
            requestAnimationFrame(() =>
              requestAnimationFrame(() => done(el.getBoundingClientRect().height === h)),
            );
          }),
      ),
    )
    .toBe(true);
}

/**
 * Waits until no finite animation is running, such as a panel's fade-in
 * (pane-in), which shifts and fades the panel while it runs. Polled: an
 * animation inside a closed section never settles its `finished` promise.
 */
export async function animationsDone(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (a) =>
                a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity,
            ).length,
      ),
    )
    .toBe(0);
}
