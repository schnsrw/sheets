import { expect, test, type Page } from '@playwright/test';
import { mainCanvas, waitForUniver } from './_helpers';

/**
 * PivotTable Fields pane — drag-and-drop. Dragging a field-list item onto a
 * zone assigns it; dragging a placed chip to another zone moves it. The drop
 * reducer (applyDrop) is unit-tested in fields-model.unit.test.ts; this drives
 * the real native drag through the app and asserts the pivot recomputes.
 */

async function readCell(page: Page, a1: string) {
  return page.evaluate((ref) => {
    const api = window.__univerAPI!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook()!.getActiveSheet();
    return ws.getRange(ref).getValue();
  }, a1);
}

async function seedSales(page: Page) {
  await page.evaluate(() => {
    const api = window.__univerAPI!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook()!.getActiveSheet();
    ws.getRange('A1').setValue({ v: 'Region' });
    ws.getRange('B1').setValue({ v: 'Quarter' });
    ws.getRange('C1').setValue({ v: 'Sales' });
    ws.getRange('A2').setValue({ v: 'North' });
    ws.getRange('B2').setValue({ v: 'Q1' });
    ws.getRange('C2').setValue({ v: 100 });
    ws.getRange('A3').setValue({ v: 'South' });
    ws.getRange('B3').setValue({ v: 'Q1' });
    ws.getRange('C3').setValue({ v: 80 });
    ws.getRange('A4').setValue({ v: 'North' });
    ws.getRange('B4').setValue({ v: 'Q2' });
    ws.getRange('C4').setValue({ v: 120 });
    ws.getRange('A5').setValue({ v: 'South' });
    ws.getRange('B5').setValue({ v: 'Q2' });
    ws.getRange('C5').setValue({ v: 95 });
    ws.getRange('A1:C5').activate();
  });
  await mainCanvas(page)
    .first()
    .click({ position: { x: 100, y: 100 } });
  await page.evaluate(() => {
    const api = window.__univerAPI!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook()!.getActiveSheet();
    ws.getRange('A1:C5').activate();
  });
}

async function insertSalesPivot(page: Page) {
  await page.getByTestId('menubar-insert').click();
  await page.getByTestId('menu-item-insert-pivot').click();
  await expect(page.getByTestId('insert-pivot-dialog')).toBeVisible();
  await page.getByTestId('insert-pivot-range').fill('A1:C5');
  await page.getByTestId('insert-pivot-target').fill('E1');
  await page.getByTestId('insert-pivot-row-field').selectOption('0');
  await page.getByTestId('insert-pivot-value-field').selectOption('2');
  await page.getByTestId('insert-pivot-aggregation').selectOption('sum');
  await page.getByTestId('insert-pivot-confirm').click();
  await page.waitForTimeout(150);
}

test.describe('PivotTable Fields pane — drag and drop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForUniver(page);
    await seedSales(page);
    await insertSalesPivot(page);
  });

  test('dragging a field onto Columns builds the matrix', async ({ page }) => {
    expect(await readCell(page, 'F1')).toBe('Sum of Sales');

    // Drag the Quarter field (source column 1) onto the Columns zone.
    await page
      .getByTestId('pivot-fields-field-1')
      .dragTo(page.getByTestId('pivot-fields-zone-cols'));
    await page.waitForTimeout(200);

    expect(await readCell(page, 'F1')).toBe('Q1');
    expect(await readCell(page, 'G1')).toBe('Q2');
    expect(await readCell(page, 'H1')).toBe('Grand Total');
    await expect(page.getByTestId('pivot-fields-zone-cols')).toContainText('Quarter');
  });

  test('dragging a chip from Rows to Columns moves it', async ({ page }) => {
    // Region starts on Rows; drag its chip to Columns → Region columns, no
    // row field (Grand Total row only) so the header carries Region values.
    await expect(page.getByTestId('pivot-fields-zone-rows')).toContainText('Region');
    await page
      .getByTestId('pivot-fields-chip-rows-0')
      .dragTo(page.getByTestId('pivot-fields-zone-cols'));
    await page.waitForTimeout(200);

    await expect(page.getByTestId('pivot-fields-zone-cols')).toContainText('Region');
    await expect(page.getByTestId('pivot-fields-zone-rows')).toContainText('Drop or add fields');
    // Region values now span the columns: North + South + Grand Total header.
    expect(await readCell(page, 'F1')).toBe('North');
    expect(await readCell(page, 'G1')).toBe('South');
  });
});
