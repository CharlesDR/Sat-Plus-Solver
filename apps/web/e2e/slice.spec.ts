/**
 * M3 acceptance (docs/PLAN.md): "Iron Plate, 60/min" in the page matches the
 * `pnpm solve` table (alternates off, the app default), and no main-thread
 * task over 50 ms runs during the solve.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

interface CliTable {
  title: string;
  head: string[];
  rows: string[][];
}

/** Splits the CLI output into its tables, using each dash rule for the column widths. */
function parseCliTables(text: string): { tables: CliTable[]; power: string } {
  const lines = text.split('\n');
  const tables: CliTable[] = [];
  for (let k = 2; k < lines.length; k++) {
    if (!/^-+( {2}-+)*$/.test(lines[k]!)) continue;
    const widths = lines[k]!.split('  ').map((d) => d.length);
    const cut = (line: string) => {
      const cells: string[] = [];
      let at = 0;
      for (const w of widths) {
        cells.push(line.slice(at, at + w).trim());
        at += w + 2;
      }
      return cells;
    };
    const rows: string[][] = [];
    for (let j = k + 1; j < lines.length && lines[j] !== ''; j++) rows.push(cut(lines[j]!));
    tables.push({ title: lines[k - 2]!, head: cut(lines[k - 1]!), rows });
  }
  const power = lines.find((l) => l.startsWith('Power: '));
  if (!power) throw new Error(`No power line in CLI output:\n${text}`);
  return { tables, power };
}

async function pageTables(page: Page): Promise<CliTable[]> {
  return page.locator('[data-testid=plan] table').evaluateAll((tables) =>
    tables.map((t) => {
      const text = (el: Element) => el.textContent?.trim() ?? '';
      return {
        title: text(t.querySelector('caption')!),
        head: [...t.querySelectorAll('thead th')].map(text),
        rows: [...t.querySelectorAll('tbody tr')].map((tr) =>
          [...tr.querySelectorAll('td')].map(text),
        ),
      };
    }),
  );
}

test('Iron Plate 60/min matches the CLI table without blocking the main thread', async ({
  page,
}) => {
  const cli = execFileSync(
    'pnpm',
    ['-s', 'solve', '--target', 'Iron Plate:60', '--no-alternates'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  const expected = parseCliTables(cli);
  expect(expected.tables.map((t) => t.title)).toContain('Recipes');

  await page.goto('/');
  const item = page.getByLabel('Target item');
  await expect(item).toBeVisible();

  // Record long tasks (> 50 ms by definition) from here until the plan is shown.
  await page.evaluate(() => {
    const w = window as unknown as { longTasks: { start: number; ms: number }[] };
    w.longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.longTasks.push({ start: e.startTime, ms: e.duration });
    }).observe({ type: 'longtask' });
  });

  await page.getByLabel('Per minute').fill('60');
  await item.fill('Iron Plate');
  await expect(page.getByTestId('plan')).toBeVisible();
  await expect(page.getByTestId('plan-status')).toContainText('Status: ok');

  // Let the observer flush entries from the last frames.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100))));
  const longTasks = await page.evaluate(
    () => (window as unknown as { longTasks: { start: number; ms: number }[] }).longTasks,
  );
  expect(longTasks).toEqual([]);

  // Control: the observer does see a deliberate 80 ms block, so the empty list above is real.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          const t = performance.now();
          while (performance.now() - t < 80);
          setTimeout(resolve, 100);
        }),
      ),
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { longTasks: unknown[] }).longTasks.length),
    )
    .toBe(1);

  expect(await pageTables(page)).toEqual(expected.tables);
  await expect(page.getByTestId('power')).toHaveText(expected.power);
});

test('clearing the target returns to the empty state', async ({ page }) => {
  await page.goto('/');
  const item = page.getByLabel('Target item');
  await item.fill('Iron Plate');
  await expect(page.getByTestId('plan')).toBeVisible();
  await item.fill('');
  await expect(page.getByText('Pick an item and a rate')).toBeVisible();
  await item.fill('Not An Item');
  await expect(page.getByText('No item named')).toBeVisible();
});
