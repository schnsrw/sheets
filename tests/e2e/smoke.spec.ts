import { expect, test } from '@playwright/test';
import { mainCanvas, waitForUniver } from './_helpers';

test.describe('Smoke — app shell + Univer mount', () => {
  test('renders title bar, ribbon, formula bar, grid, and status bar', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('titlebar')).toBeVisible();
    await expect(page.getByTestId('titlebar-filename')).toHaveText('Untitled');
    await expect(page.getByTestId('ribbon')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-home')).toBeVisible();
    await expect(page.getByTestId('formula-bar')).toBeVisible();
    await expect(page.getByTestId('grid-host')).toBeVisible();
    await expect(page.getByTestId('statusbar')).toBeVisible();
  });

  test('Univer canvas mounts and Facade API is exposed', async ({ page }) => {
    await page.goto('/');
    await expect(mainCanvas(page)).toBeVisible({ timeout: 15_000 });
    const hasApi = await page.evaluate(() => Boolean(window.__univerAPI));
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
    await waitForUniver(page);

    const value = await page.evaluate(() => {
      const api = window.__univerAPI!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws: any = api.getActiveWorkbook()!.getActiveSheet();
      const range = ws.getRange('A1');
      range.setValue({ v: 'Hello' });
      return range.getCellData();
    });

    expect((value as { v?: unknown }).v).toBe('Hello');
  });
});
