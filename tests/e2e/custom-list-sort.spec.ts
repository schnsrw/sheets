import { expect, test, type Page } from '@playwright/test';
import { waitForUniver } from './_helpers';

/**
 * Sort by custom list (Data → Sort by custom list…). The sort maths is
 * unit-tested in custom-list-sort.ts; this drives the dialog end-to-end and
 * asserts the rows are reordered by the custom order, carrying their whole row.
 */

async function readCol(page: Page, col: string, n: number) {
  return page.evaluate(
    ({ c, count }) => {
      const api = window.__univerAPI!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws: any = api.getActiveWorkbook()!.getActiveSheet();
      const out: unknown[] = [];
      for (let r = 1; r <= count; r += 1) out.push(ws.getRange(`${c}${r}`).getValue());
      return out;
    },
    { c: col, count: n },
  );
}

test('sorts a range by a typed custom list, moving whole rows', async ({ page }) => {
  await page.goto('/');
  await waitForUniver(page);

  await page.evaluate(() => {
    const api = window.__univerAPI!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook()!.getActiveSheet();
    ws.getRange('A1').setValue({ v: 'Region' });
    ws.getRange('B1').setValue({ v: 'Sales' });
    ws.getRange('A2').setValue({ v: 'West' });
    ws.getRange('B2').setValue({ v: 1 });
    ws.getRange('A3').setValue({ v: 'North' });
    ws.getRange('B3').setValue({ v: 2 });
    ws.getRange('A4').setValue({ v: 'East' });
    ws.getRange('B4').setValue({ v: 3 });
    ws.getRange('A5').setValue({ v: 'South' });
    ws.getRange('B5').setValue({ v: 4 });
    ws.getRange('A1:B5').activate();
  });

  await page.getByTestId('menubar-data').click();
  await page.getByTestId('menu-item-sort-custom-list').click();
  await expect(page.getByTestId('custom-list-sort-dialog')).toBeVisible();

  await page.getByTestId('custom-list-sort-list').selectOption('__custom__');
  await page.getByTestId('custom-list-sort-custom').fill('North\nSouth\nEast\nWest');
  await page.getByTestId('custom-list-sort-ok').click();
  await expect(page.getByTestId('custom-list-sort-dialog')).toBeHidden();

  // Header stays; data follows the custom order, Sales carried along.
  expect(await readCol(page, 'A', 5)).toEqual(['Region', 'North', 'South', 'East', 'West']);
  expect(await readCol(page, 'B', 5)).toEqual(['Sales', 2, 4, 3, 1]);
});

test('built-in Month list orders Jan…Dec', async ({ page }) => {
  await page.goto('/');
  await waitForUniver(page);

  await page.evaluate(() => {
    const api = window.__univerAPI!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook()!.getActiveSheet();
    ws.getRange('A1').setValue({ v: 'Mar' });
    ws.getRange('A2').setValue({ v: 'Jan' });
    ws.getRange('A3').setValue({ v: 'Feb' });
    ws.getRange('A1:A3').activate();
  });

  await page.getByTestId('menubar-data').click();
  await page.getByTestId('menu-item-sort-custom-list').click();
  // No header for this one.
  await page.getByTestId('custom-list-sort-headers').uncheck();
  await page.getByTestId('custom-list-sort-list').selectOption('mon-short');
  await page.getByTestId('custom-list-sort-ok').click();
  await expect(page.getByTestId('custom-list-sort-dialog')).toBeHidden();

  expect(await readCol(page, 'A', 3)).toEqual(['Jan', 'Feb', 'Mar']);
});
