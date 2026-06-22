import { test, expect } from '@playwright/test';
import { waitForUniver } from './_helpers';
test('Data > Protect blocks edits (read-only)', async ({ page }) => {
  await page.goto('/');
  await waitForUniver(page);
  await page.evaluate(() =>
    window.__univerAPI!.getActiveWorkbook().getActiveSheet().getRange('A1').setValue({ v: 'before' }));
  await page.waitForTimeout(300);
  await page.getByTestId('menubar-data').click();
  await page.getByTestId('menu-item-protect-sheet').click();
  await page.waitForTimeout(400);
  await page.evaluate(() =>
    window.__univerAPI!.getActiveWorkbook().getActiveSheet().getRange('A1').setValue({ v: 'BLOCKED' }));
  await page.waitForTimeout(500);
  const v = await page.evaluate(() =>
    String(window.__univerAPI!.getActiveWorkbook().getActiveSheet().getRange('A1').getValue() ?? ''));
  console.log('VALUE AFTER PROTECT+EDIT:', v);
  expect(v).toBe('before');
});
