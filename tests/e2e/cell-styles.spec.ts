import { test, expect } from '@playwright/test';
import { waitForUniver } from './_helpers';
test('Format > Cell styles > Good applies fill + font color', async ({ page }) => {
  await page.goto('/');
  await waitForUniver(page);
  await page.evaluate(() => {
    const ws = window.__univerAPI!.getActiveWorkbook().getActiveSheet();
    ws.getRange('A1').setValue({ v: 'ok' });
    ws.getRange('A1').activate();
  });
  await page.getByTestId('menubar-format').click();
  await page.getByTestId('menu-item-cell-styles').hover();
  await page.getByTestId('menu-item-cell-style-good').click();
  await page.waitForTimeout(500);
  const style = await page.evaluate(() => {
    const api = window.__univerAPI!;
    const ws = api.getActiveWorkbook().getActiveSheet();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cd: any = ws.getRange(0, 0).getCellData?.();
    const s = cd?.s;
    const st = typeof s === 'string' ? api.getActiveWorkbook().getWorkbook().getStyles().get(s) : s;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = st as any;
    return { fill: a?.bg?.rgb, color: a?.cl?.rgb };
  });
  console.log('CELL STYLE:', JSON.stringify(style));
  expect((style.fill || '').toLowerCase()).toContain('c6efce');
});
