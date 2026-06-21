import { defineConfig, devices } from '@playwright/test';

/**
 * Self-contained Playwright config for the embed playground.
 *
 * Serves THIS directory as static files with `npx serve` and runs the
 * round-trip spec against it. Prereq: the SDK runtime must be copied into
 * ./embed/sheets/ and main.ts compiled to main.js — see README → "Run it".
 *
 * Run:  npx playwright test -c playwright.embed.config.ts
 *
 * Note: not part of the repo's default `playwright.config.ts` testDir
 * (./tests/e2e at the repo root) — this example is standalone and runs on
 * demand, so it doesn't gate the main suite on the heavy embed bundle.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5275',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `serve` sets correct MIME types for ES modules and serves this dir
    // flat (index.html + main.js at root, ./embed + ./sample beneath).
    command: 'npx --yes serve -l 5275 .',
    url: 'http://127.0.0.1:5275/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
