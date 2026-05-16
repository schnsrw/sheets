import type { Page } from '@playwright/test';

/**
 * Returns the main grid canvas (the one users interact with).
 * Univer also renders a hidden formula-editor canvas; that one has no stable
 * id and we never want to target it from tests.
 */
export function mainCanvas(page: Page) {
  return page.locator('#univer-sheet-main-canvas_workbook-1');
}

export async function waitForUniver(page: Page) {
  await mainCanvas(page).waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__univerAPI), null, { timeout: 5_000 });
}

export async function selectRange(page: Page, a1: string) {
  await page.evaluate((cell) => {
    const api = window.__univerAPI!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook()!.getActiveSheet();
    ws.getRange(cell).activate();
  }, a1);
}

export async function readCell(page: Page, a1: string) {
  return page.evaluate((cell) => {
    const api = window.__univerAPI!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook()!.getActiveSheet();
    return ws.getRange(cell).getCellData();
  }, a1);
}
