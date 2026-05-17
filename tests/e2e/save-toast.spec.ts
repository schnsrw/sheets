import { expect, test } from '@playwright/test';
import { waitForUniver } from './_helpers';

/**
 * Save confirmation toast. Each File → Save / Export path calls Univer's
 * IMessageService.show() with the resolved filename so the user gets in-app
 * feedback (the browser's download notification alone is too easy to miss).
 *
 * Univer renders the toast via Sonner under the `univer-message-toaster`
 * region — we assert by text rather than DOM id so the test is decoupled
 * from Sonner's internal markup.
 */
test('File → Save shows a "Saved as …" toast', async ({ page }) => {
  await page.goto('/');
  await waitForUniver(page);

  // Suppress the actual download anchor click — we only care about the
  // toast (which fires after triggerDownload). Use a targeted selector
  // instead of overriding HTMLAnchorElement.prototype.click globally,
  // which on slower CI runners can race with Univer's own initialization
  // (one flake observed). The anchor has download=… attr; intercept that.
  await page.addInitScript(() => {
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute('download')) return;
      return orig.call(this);
    };
  });

  await page.getByTestId('menubar-file').click();
  await page.getByTestId('menu-item-save').click();

  // Give Sonner a beat to mount the toast portal on first run (cold caches
  // on CI take longer than local). 8s headroom over the prior 5s avoids the
  // intermittent fail; toast actually appears in ~200 ms locally.
  await expect(page.getByText(/Saved as .+\.xlsx/i)).toBeVisible({
    timeout: 8_000,
  });
});
