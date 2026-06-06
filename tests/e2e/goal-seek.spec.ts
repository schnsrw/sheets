import { expect, test } from '@playwright/test';
import { waitForUniver } from './_helpers';

/**
 * Goal Seek — iterative solver. Sets up a tiny scenario, runs the
 * solver via the dialog, and verifies the input cell converged to a
 * value that makes the goal cell hit the target.
 */

test.describe('Goal Seek', () => {
  test('drives an input cell to make the goal formula hit the target', async ({ page }) => {
    await page.goto('/');
    await waitForUniver(page);
    // A1 = input (start at 1), B1 = =A1*A1 (square). Target B1 = 49.
    await page.evaluate(() => {
      const api = window.__univerAPI!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws: any = api.getActiveWorkbook()!.getActiveSheet();
      ws.getRange('A1').setValue({ v: 1 });
      ws.getRange('B1').setValue({ f: '=A1*A1' });
    });
    // Wait for the formula worker to populate B1's cached value before
    // running goal-seek. A fixed 300 ms was racy after the Univer fork
    // wire-up shifted formula evaluation timing — poll the cell so the
    // test isn't tied to that wall clock.
    await page.waitForFunction(
      () => {
        const api = window.__univerAPI!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ws: any = api.getActiveWorkbook()!.getActiveSheet();
        return ws.getRange('B1').getCellData()?.v === 1;
      },
      null,
      { timeout: 5_000 },
    );

    await page.getByTestId('menubar-data').click();
    await page.getByTestId('menu-item-goal-seek').click();
    await expect(page.getByTestId('goal-seek-dialog')).toBeVisible();
    await page.getByTestId('goal-seek-goal-input').fill('B1');
    await page.getByTestId('goal-seek-target-input').fill('49');
    await page.getByTestId('goal-seek-input-input').fill('A1');
    await page.getByTestId('goal-seek-run').click();
    // Wait for the result line to render.
    await expect(page.getByTestId('goal-seek-result')).toBeVisible({ timeout: 5_000 });
    const text = await page.getByTestId('goal-seek-result').innerText();
    expect(text).toContain('Converged');

    // x² = 49 has two roots (±7); the solver may converge to either
    // depending on how the bracket search expanded. Assert |x| ≈ 7
    // rather than the positive root specifically.
    const finalA1 = await page.evaluate(() => {
      const api = window.__univerAPI!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws: any = api.getActiveWorkbook()!.getActiveSheet();
      const v = ws.getRange('A1').getCellData()?.v;
      return typeof v === 'number' ? v : Number(v);
    });
    expect(Math.abs(Math.abs(finalA1) - 7)).toBeLessThan(0.001);
  });

  test('reports failure when no bracket is found', async ({ page }) => {
    await page.goto('/');
    await waitForUniver(page);
    // B1 always returns 5; no value of A1 makes B1 = 100.
    await page.evaluate(() => {
      const api = window.__univerAPI!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws: any = api.getActiveWorkbook()!.getActiveSheet();
      ws.getRange('A1').setValue({ v: 1 });
      ws.getRange('B1').setValue({ v: 5 });
    });
    await page.waitForTimeout(200);

    await page.getByTestId('menubar-data').click();
    await page.getByTestId('menu-item-goal-seek').click();
    await page.getByTestId('goal-seek-goal-input').fill('B1');
    await page.getByTestId('goal-seek-target-input').fill('100');
    await page.getByTestId('goal-seek-input-input').fill('A1');
    await page.getByTestId('goal-seek-run').click();
    await expect(page.getByTestId('goal-seek-result')).toBeVisible({ timeout: 5_000 });
    const text = await page.getByTestId('goal-seek-result').innerText();
    expect(text).toMatch(/Could not find a bracket|Did not converge|does not change/);
  });
});
