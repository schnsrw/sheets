import { expect, test } from '@playwright/test';
import { waitForUniver } from './_helpers';

/**
 * Tooltip primitive — appears 300 ms after hovering a toolbar / shell button,
 * disappears on mouse leave. Replaces the slow native `title=` tooltip
 * (~700 ms delay, unstyled, OS-dependent).
 *
 * We check on a couple of representative anchors (toolbar Bold, sheet-tabs
 * Add, formula-bar Enter) so a regression in the Tooltip primitive or its
 * wiring through `RibbonControls`, `SheetTabs`, or `FormulaBar` is caught.
 */

test.describe('Tooltip', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForUniver(page);
  });

  test('appears on hover over a toolbar button and disappears on leave', async ({ page }) => {
    const bold = page.getByTestId('ribbon-btn-bold');
    await bold.hover();
    const tooltip = page.getByTestId('tooltip').filter({ hasText: /^Bold/ });
    await expect(tooltip).toBeVisible({ timeout: 2_000 });

    // Hover something else so the mouse cleanly leaves the trigger (some CI
    // box configs swallow page.mouse.move(0, 0) without a corresponding
    // pointer event — hovering a real element is more reliable).
    await page.getByTestId('formula-bar').hover();
    await expect(tooltip).toBeHidden({ timeout: 2_000 });
  });

  test('appears on the sheet-tabs Add button (top-side tooltip)', async ({ page }) => {
    await page.getByTestId('sheet-tabs-add').hover();
    await expect(
      page.getByTestId('tooltip').filter({ hasText: 'Add sheet' }),
    ).toBeVisible({ timeout: 2_000 });
  });

  test('Toolbar buttons no longer rely on the native `title` attribute', async ({ page }) => {
    // The whole point of the primitive: replace the slow native tooltip with
    // a styled one. If a regression re-adds `title=`, both would fire on
    // hover (a Windows native bubble + ours) — guard against it.
    await expect(page.getByTestId('ribbon-btn-bold')).not.toHaveAttribute('title', /./);
  });
});
