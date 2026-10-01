/**
 * The test fixture every spec uses (M10: "no console errors"). Each page a
 * test opens, in its own context or through `freshPage`, is watched, and a
 * console error or an uncaught page error fails the test.
 */
import { test as base, expect, type Page } from '@playwright/test';

export { expect };

function watch(page: Page, errors: string[]) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error on ${page.url()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`uncaught on ${page.url()}: ${e.message}`));
}

export const test = base.extend<{
  consoleErrors: string[];
  /** A page in a fresh browser context (no storage), watched like `page`. */
  freshPage: () => Promise<Page>;
}>({
  consoleErrors: [
    async ({ context }, provide) => {
      const errors: string[] = [];
      context.on('page', (p) => watch(p, errors));
      for (const p of context.pages()) watch(p, errors);
      await provide(errors);
      expect(errors, 'console errors').toEqual([]);
    },
    { auto: true },
  ],
  freshPage: async ({ browser, consoleErrors }, provide) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await provide(async () => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      watch(page, consoleErrors);
      return page;
    });
    for (const c of contexts) await c.close();
  },
});
