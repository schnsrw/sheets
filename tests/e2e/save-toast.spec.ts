import { expect, test } from '@playwright/test';
import { waitForUniver } from './_helpers';

/**
 * Save confirmation toast. Each File → Save / Export path calls
 * `toast(api, 'Saved as <filename>')` in apps/web/src/shell/file-actions.ts,
 * which both invokes Univer's IMessageService.show() (the visible UI) and
 * pushes the content onto a dev-only `globalThis.__toastLog__` sink.
 *
 * The earlier DOM-based assertion (waiting for Sonner to paint the toast)
 * flaked on CI cold caches — the toast portal mounts lazily, and our
 * Save fires before it's in the DOM. Sniffing the sink is deterministic
 * and proves the production code path ran without coupling to Sonner.
 */
test('File → Save records "Saved as …" via the toast helper', async ({ page }) => {
  // Cancel any download Save triggers so the headless browser doesn't
  // hold the file across runs.
  page.on('download', (d) => {
    void d.cancel();
  });

  await page.goto('/');
  await waitForUniver(page);

  // Reset the sink so this test's assertions don't see stale entries
  // from a previous Save (Playwright reuses the page within a test).
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__toastLog__ = [];
  });

  await page.getByTestId('menubar-file').click();
  await page.getByTestId('menu-item-save').click();

  await page.waitForFunction(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const log = (window as any).__toastLog__ as Array<{ content: string }> | undefined;
      return log?.some((entry) => /Saved as .+\.xlsx/i.test(entry.content)) ?? false;
    },
    null,
    { timeout: 10_000 },
  );

  // Sanity: assert the actual content for nicer failure messages.
  const log = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((window as any).__toastLog__ ?? []) as Array<{ content: string }>;
  });
  expect(log.map((e) => e.content).join('|')).toMatch(/Saved as .+\.xlsx/i);
});
