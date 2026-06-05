import { expect, test } from '@playwright/test';
import { waitForUniver } from './_helpers';

/**
 * Home-screen "Pin a folder" control — File System Access integration
 * gating. The button is conditional on the browser exposing the FSA
 * API; non-Chromium browsers (Firefox, Safari) see the existing
 * download flow and no folder UI.
 *
 * Why no click-and-verify-pill test here:
 *   The post-click happy path writes a `FileSystemDirectoryHandle` to
 *   IDB. Real OS-issued handles are structured-cloneable; a stub built
 *   inside an `addInitScript` is not (functions are dropped on clone),
 *   so the IDB write either throws or rounds-trips a corrupt record.
 *   Real Chrome users get this for free. The round-trip is exercised
 *   manually + covered by the type contract; this e2e proves the
 *   visible gating users see.
 */

test.describe('home pin folder', () => {
  test.beforeEach(async ({ page }) => {
    // Each Playwright test gets a fresh BrowserContext with isolated
    // IDB — no manual wipe needed.
    await page.goto('/');
    await waitForUniver(page);
  });

  test('hides the pin control when the FSA API is unavailable', async ({ page }) => {
    await page.addInitScript(`delete window.showDirectoryPicker;`);
    await page.goto('/');
    await waitForUniver(page, { keepHome: true });

    await expect(page.getByTestId('home-pin-folder')).toHaveCount(0);
    await expect(page.getByTestId('home-pinned-folder')).toHaveCount(0);
  });

  test('shows the pin control when the FSA API is present', async ({ page }) => {
    // Chromium ships showDirectoryPicker natively — no stub needed.
    // The pill is rendered in the "none" state until the user clicks
    // (and clicking is what would call the OS picker).
    await page.goto('/');
    await waitForUniver(page, { keepHome: true });

    await expect(page.getByTestId('home-pin-folder')).toBeVisible();
    await expect(page.getByTestId('home-pinned-folder')).toHaveCount(0);
  });
});
