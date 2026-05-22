import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for running against the production docker stack on
 * http://localhost:3000 (single port — Fastify serves web + api + WS).
 *
 *   docker compose up -d
 *   pnpm exec playwright test -c playwright.docker.config.ts <spec>
 *
 * Skips the auto-spawned Vite dev server (which the default config uses
 * for tests against the dev build). Use this when you want to verify
 * that the bundled prod image actually works end-to-end.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // No webServer — we expect the docker stack to already be running.
});
