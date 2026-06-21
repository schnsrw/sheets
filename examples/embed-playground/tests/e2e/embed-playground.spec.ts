import { expect, test } from '@playwright/test';

/**
 * Drives the embed playground end-to-end: loads the host page, waits for
 * the SDK's in-iframe runtime to boot + render the workbook, triggers a
 * host-side save, and asserts the host received the snapshot back over
 * postMessage.
 *
 * Serving: this spec assumes the playground dir is served at baseURL with
 * the SDK runtime already copied in (see README → "Run it"). The companion
 * config `playwright.embed.config.ts` starts `npx serve` over this dir; run
 * with `npx playwright test -c playwright.embed.config.ts`.
 *
 * The host page exposes two test hooks on `window`:
 *   - `__log`          — the event-log entries (kind + msg).
 *   - `__lastSnapshot` — the most recent snapshot the host persisted.
 */

declare global {
  interface Window {
    __log?: { ts: number; kind: string; msg: string }[];
    __lastSnapshot?: unknown;
  }
}

test('iframe boots, renders, and round-trips a save snapshot to the host', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/index.html', { waitUntil: 'load' });

  // 1) Host served the document bytes to the iframe on load.request.
  await page.waitForFunction(
    () => (window.__log ?? []).some((e) => e.msg.includes('load.response ok')),
    null,
    { timeout: 30_000 },
  );

  // 2) The in-iframe editor parsed + mounted the workbook — a sized grid
  //    canvas means Univer's workbench constructed and painted (this is
  //    what regressed when the runtime shipped without a locale bundle).
  await page.waitForFunction(
    () => {
      const f = document.getElementById('editor') as HTMLIFrameElement | null;
      const doc = f?.contentDocument;
      if (!doc) return false;
      return Array.from(doc.querySelectorAll('canvas')).some((c) => c.clientWidth > 0);
    },
    null,
    { timeout: 30_000 },
  );

  // 3) Host clicks Save → runtime snapshots → save.notify → host persists.
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => window.__lastSnapshot != null, null, { timeout: 15_000 });

  // The snapshot is a Univer IWorkbookData — assert the shape the host got.
  const keys = await page.evaluate(() => {
    const s = window.__lastSnapshot as Record<string, unknown> | null;
    return s && typeof s === 'object' ? Object.keys(s) : [];
  });
  expect(keys).toEqual(expect.arrayContaining(['id', 'sheetOrder', 'sheets', 'styles']));

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('view-mode toggle reaches the editor', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'load' });
  await page.waitForFunction(
    () => (window.__log ?? []).some((e) => e.msg.includes('load.response ok')),
    null,
    { timeout: 30_000 },
  );

  await page.getByLabel('View').selectOption('preview');
  await page.waitForFunction(
    () => (window.__log ?? []).some((e) => e.msg.includes('set.viewmode preview')),
    null,
    { timeout: 10_000 },
  );
});
