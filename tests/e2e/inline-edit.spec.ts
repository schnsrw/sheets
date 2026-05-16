import { expect, test } from '@playwright/test';
import { mainCanvas, readCell, selectRange, waitForUniver } from './_helpers';

/**
 * Phase 1.1.1 — inline cell editing works.
 * The cell editor's `FormulaEditor` component is registered by
 * `@univerjs/sheets-formula-ui` (NOT `sheets-formula`). Forgetting it leaves
 * the grid clickable but uneditable — this suite is the canary.
 */

test.describe('Inline cell editing', () => {
  test('Double-click on a cell opens the inline editor and types commit on Enter', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForUniver(page);

    const grid = mainCanvas(page);
    const box = await grid.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Aim at roughly B2 — inside the data area, past row/column headers.
    await page.mouse.dblclick(box.x + 200, box.y + 60);

    // The cell editor is a `[data-u-comp="editor"]` contenteditable. Univer
    // animates it from off-screen, so we don't assert visibility — we assert
    // that keys typed after the dblclick land in the targeted cell.
    await page.keyboard.type('inline-works');
    await page.keyboard.press('Enter');

    // Default column widths put roughly (200, 60) inside B2.
    const cell = await readCell(page, 'B2');
    expect(cell?.v).toBe('inline-works');
  });

  test('Typing on a selected cell starts editing (Excel-style)', async ({ page }) => {
    await page.goto('/');
    await waitForUniver(page);
    await selectRange(page, 'C3');

    // Focus the grid so keystrokes route to Univer, not our shell.
    const grid = mainCanvas(page);
    await grid.click({ position: { x: 5, y: 5 } });
    // Re-select C3 since the click above moved the selection.
    await selectRange(page, 'C3');

    await page.keyboard.type('quick');
    await page.keyboard.press('Enter');

    const cell = await readCell(page, 'C3');
    expect(cell?.v).toBe('quick');
  });
});
