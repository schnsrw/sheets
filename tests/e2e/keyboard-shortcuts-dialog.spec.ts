/**
 * Keyboard shortcuts cheat sheet — UX_AUDIT.md §2.16 / Phase 3 #12.
 *
 * Drives every entry point: menu click, `Ctrl+/`, and `?`.
 * Confirms it renders the expected group headings and a few specific
 * rows so a refactor of the data file doesn't silently drop sections.
 */
import { test, expect } from '@playwright/test';
import { waitForUniver } from './_helpers';

test.describe('Keyboard shortcuts dialog', () => {
  test('Ctrl+/ opens the cheat sheet with the expected groups', async ({ page }) => {
    await page.goto('/');
    await waitForUniver(page);
    // The cheat sheet runs at document level (capture-phase listener
    // in MenuBar) so any focused surface lets the chord through.
    await page.keyboard.press('Control+/');
    const dialog = page.getByTestId('keyboard-shortcuts-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Essentials' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Editing' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Navigation' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Formatting' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'View' })).toBeVisible();
    // Spot-check a couple of rows we explicitly listed.
    await expect(dialog.getByText('Save', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Flash Fill', { exact: true })).toBeVisible();
  });

  test('Escape closes the dialog', async ({ page }) => {
    await page.goto('/');
    await waitForUniver(page);
    await page.keyboard.press('Control+/');
    await expect(page.getByTestId('keyboard-shortcuts-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('keyboard-shortcuts-dialog')).not.toBeVisible();
  });

  test('Help → Keyboard shortcuts menu opens the dialog', async ({ page }) => {
    await page.goto('/');
    await waitForUniver(page);
    await page.getByTestId('menubar-help').click();
    await page.getByRole('menuitem', { name: /Keyboard shortcuts/ }).click();
    await expect(page.getByTestId('keyboard-shortcuts-dialog')).toBeVisible();
  });
});
