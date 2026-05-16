import { expect, test } from '@playwright/test';

test.describe('Smoke — app shell + Univer mount', () => {
  test('renders title bar, ribbon, grid host, and status bar', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('titlebar')).toBeVisible();
    await expect(page.getByTestId('titlebar-filename')).toHaveText('Untitled');
    await expect(page.getByTestId('ribbon')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-home')).toBeVisible();
    await expect(page.getByTestId('grid-host')).toBeVisible();
    await expect(page.getByTestId('statusbar')).toBeVisible();
  });

  test('Univer canvas mounts inside the grid host', async ({ page }) => {
    await page.goto('/');

    // Univer renders one or more <canvas> elements once mounted.
    const grid = page.getByTestId('grid-host');
    await expect(grid.locator('canvas').first()).toBeVisible({ timeout: 15_000 });

    // Facade API exposed for tests in dev mode.
    const hasApi = await page.evaluate(() => Boolean((window as unknown as { __univerAPI?: unknown }).__univerAPI));
    expect(hasApi).toBe(true);
  });

  test('ribbon tabs switch when clicked', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('ribbon-tab-home')).toHaveAttribute('aria-selected', 'true');

    await page.getByTestId('ribbon-tab-insert').click();
    await expect(page.getByTestId('ribbon-tab-insert')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('ribbon-body-insert')).toBeVisible();
  });

  test('can set a cell value via the Facade API', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('grid-host').locator('canvas').first().waitFor({ timeout: 15_000 });

    const value = await page.evaluate(() => {
      type Api = {
        getActiveWorkbook: () => {
          getActiveSheet: () => {
            getRange: (a1: string) => { setValue: (v: unknown) => void; getValue: () => unknown };
          };
        };
      };
      const api = (window as unknown as { __univerAPI: Api }).__univerAPI;
      const range = api.getActiveWorkbook().getActiveSheet().getRange('A1');
      range.setValue({ v: 'Hello' });
      return range.getValue();
    });

    // getValue() returns either the raw value or an ICellData — accept either.
    const v =
      typeof value === 'object' && value !== null && 'v' in (value as Record<string, unknown>)
        ? (value as { v: unknown }).v
        : value;
    expect(v).toBe('Hello');
  });
});
