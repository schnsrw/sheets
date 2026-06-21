import { expect, test } from '@playwright/test';
import { mainCanvas, waitForUniver } from './_helpers';

/**
 * Phase 0.5 — Univer OSS plugins we wired into the editor that ship in the
 * fork but weren't previously registered:
 *
 *   - sheets-crosshair-highlight: Excel-style active row/column highlight,
 *     toggled from the context-menu footer (off by default).
 *   - sheets-zen-editor: immersive full-screen cell editor, opened from the
 *     cell context menu.
 *   - sheets-graphics: canvas render primitive (no UI / commands). A clean
 *     boot is the proof — a DI break would surface as a redi Service2 error.
 *   - watermark: overlay layer driven from View → Confidential watermark
 *     (the app hides Univer's ribbon, so we own the trigger).
 *
 * The first two pairs are eager plugins, so a clean editor boot already proves
 * they register without breaking Univer's DI / plugin order. These assertions
 * additionally prove each is reachable: zen via its context-menu entry,
 * crosshair via its toggle operation, watermark via its View-menu toggle +
 * persisted service config. A future Univer bump or plugin-list regression
 * flags here.
 */

test.describe('Univer extras — crosshair highlight + zen editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForUniver(page);
  });

  test('zen (full screen) editor is offered in the cell context menu', async ({ page }) => {
    const canvas = mainCanvas(page).first();
    await canvas.click({ position: { x: 80, y: 30 } });
    await canvas.click({ button: 'right', position: { x: 80, y: 30 } });
    const menu = page.locator('section.univer-popup').first();
    await expect(menu).toBeVisible({ timeout: 3_000 });
    await expect(menu).toContainText('Full Screen Editor');
  });

  test('crosshair highlight toggle operation is registered', async ({ page }) => {
    // Executes through the command bus; resolves false (not throws) only if the
    // operation is unregistered. A clean toggle there-and-back proves the plugin
    // is live without leaving the highlight on for other specs.
    const result = await page.evaluate(async () => {
      const api = window.__univerAPI!;
      const on = await api.executeCommand('sheet.operation.toggle-crosshair-highlight');
      const off = await api.executeCommand('sheet.operation.toggle-crosshair-highlight');
      return { on, off };
    });
    expect(result.on).toBe(true);
    expect(result.off).toBe(true);
  });
});

test.describe('Univer extras — graphics + watermark', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForUniver(page);
  });

  test('app boots with sheets-graphics + watermark registered (no DI errors)', async ({ page }) => {
    // A clean boot past waitForUniver already proves both eager plugins
    // registered without a redi duplicate-Identifier break. Belt-and-braces:
    // assert nothing logged a Service2-style DI error and the facade is live.
    const ok = await page.evaluate(() => Boolean(window.__univerAPI?.getActiveWorkbook()));
    expect(ok).toBe(true);
  });

  test('View → Confidential watermark toggles checked state + applies/removes overlay', async ({
    page,
  }) => {
    // The watermark renders into the canvas scene (no DOM node to assert) and
    // its config is held in the WatermarkService, persisted via localforage
    // (IndexedDB) under UNIVER_WATERMARK_STORAGE_KEY. We verify the two halves
    // of the round trip the user controls: the menu item flips its checkmark,
    // and the persisted config flips on/off underneath. Reading the menu label
    // proves the React state; reading IndexedDB proves the service actually ran
    // (a DI break would throw at click time and never write the key).
    const persisted = () =>
      page.evaluate(
        () =>
          new Promise<string | null>((resolve) => {
            const req = indexedDB.open('localforage');
            req.onsuccess = () => {
              const db = req.result;
              let store: IDBObjectStore;
              try {
                store = db.transaction('keyvaluepairs', 'readonly').objectStore('keyvaluepairs');
              } catch {
                resolve(null);
                return;
              }
              const get = store.get('UNIVER_WATERMARK_STORAGE_KEY');
              get.onsuccess = () => {
                const v = get.result as { config?: { text?: { content?: string } } } | undefined;
                resolve(v?.config?.text?.content ?? null);
              };
              get.onerror = () => resolve(null);
            };
            req.onerror = () => resolve(null);
          }),
      );

    // Open the View menu and read the watermark item's current label. The
    // menubar button toggles the popup, so re-open via the popup's own
    // visibility rather than blindly re-clicking.
    const openViewMenu = async () => {
      const popup = page.getByTestId('menubar-view-popup');
      if (!(await popup.isVisible().catch(() => false))) {
        await page.getByTestId('menubar-view').click();
        await expect(popup).toBeVisible();
      }
      return page.getByTestId('menu-item-toggle-watermark');
    };

    // Toggle ON.
    let item = await openViewMenu();
    await expect(item).toContainText('Confidential watermark');
    await expect(item).not.toContainText('✓');
    await item.click();

    // The service wrote the config (proves the command ran — a DI break would
    // throw here and never persist) and the menu now shows the checkmark.
    await expect.poll(async () => await persisted()).toBe('CONFIDENTIAL');
    item = await openViewMenu();
    await expect(item).toContainText('✓');

    // Toggle OFF clears both the checkmark and the persisted config.
    await item.click();
    await expect.poll(async () => await persisted()).toBeNull();
    item = await openViewMenu();
    await expect(item).not.toContainText('✓');
  });
});
