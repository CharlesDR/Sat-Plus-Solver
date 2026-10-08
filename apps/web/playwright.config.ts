import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
// A preinstalled Chromium can be used instead of `playwright install` (e.g. in a sandbox).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const ISOLATED = /slice\.spec\.ts$/;

/** Smoke tests against the production build (`pnpm build` first). */
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: ISOLATED },
    // The "no main-thread task over 50 ms" check (M3) measures wall time, which
    // other browsers sharing the CPU inflate. It runs after everything else, alone.
    {
      name: 'isolated',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ISOLATED,
      dependencies: ['chromium'],
    },
  ],
  webServer: {
    command: `pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
