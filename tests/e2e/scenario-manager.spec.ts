import { expect, test } from '@playwright/test';
import { waitForUniver } from './_helpers';

/**
 * Scenario Manager (Data → Scenario Manager…). A scenario captures the current
 * values of "changing cells"; showing it writes them back and the sheet
 * recalculates. The model + ref parsing are unit-tested in scenarios.ts; this
 * drives the dialog: capture two scenarios, flip between them, and check a
 * dependent formula follows.
 */

test('capture two scenarios and switch between them', async ({ page }) => {
  await page.goto('/');
  await waitForUniver(page);

  // B1 is the input; B2 = B1 * 2 depends on it.
  await page.evaluate(() => {
    const api = window.__univerAPI!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook()!.getActiveSheet();
    ws.getRange('B1').setValue({ v: 10 });
    ws.getRange('B2').setValue({ f: '=B1*2' });
  });

  const open = async () => {
    await page.getByTestId('menubar-data').click();
    await page.getByTestId('menu-item-scenario-manager').click();
    await expect(page.getByTestId('scenario-manager-dialog')).toBeVisible();
  };

  // Scenario "Low" with B1 = 10.
  await open();
  await page.getByTestId('scenario-add').click();
  await page.getByTestId('scenario-name-input').fill('Low');
  await page.getByTestId('scenario-cells-input').fill('B1');
  await page.getByTestId('scenario-add-save').click();
  await expect(page.getByTestId('scenario-row')).toHaveCount(1);
  await page.getByTestId('scenario-close').click();

  // Change B1 to 50, capture as "High".
  await page.evaluate(() => {
    const api = window.__univerAPI!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook()!.getActiveSheet();
    ws.getRange('B1').setValue({ v: 50 });
  });
  await open();
  await page.getByTestId('scenario-add').click();
  await page.getByTestId('scenario-name-input').fill('High');
  await page.getByTestId('scenario-cells-input').fill('B1');
  await page.getByTestId('scenario-add-save').click();
  await expect(page.getByTestId('scenario-row')).toHaveCount(2);

  // Show "Low" → B1 back to 10, B2 recalculates to 20.
  await page.getByTestId('scenario-show').first().click();
  await page.waitForFunction(() => {
    const api = window.__univerAPI!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook()!.getActiveSheet();
    return ws.getRange('B1').getValue() === 10 && ws.getRange('B2').getValue() === 20;
  });

  // Show "High" → B1 = 50, B2 = 100.
  await page.getByTestId('scenario-show').nth(1).click();
  await page.waitForFunction(() => {
    const api = window.__univerAPI!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook()!.getActiveSheet();
    return ws.getRange('B1').getValue() === 50 && ws.getRange('B2').getValue() === 100;
  });
});
