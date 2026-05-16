import { expect, test } from '@playwright/test';
import { waitForUniver } from './_helpers';

test.describe('Sheet tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForUniver(page);
  });

  test('Renders a tab for the initial sheet and the Add button on the left', async ({ page }) => {
    await expect(page.getByTestId('sheet-tabs')).toBeVisible();
    await expect(page.getByTestId('sheet-tabs-add')).toBeVisible();

    // Initial sheet has a tab labelled "Sheet1".
    const tabs = page.getByTestId('sheet-tabs').locator('.sheet-tab');
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toContainText('Sheet1');
  });

  test('Plus button adds a new sheet', async ({ page }) => {
    await page.getByTestId('sheet-tabs-add').click();
    const tabs = page.getByTestId('sheet-tabs').locator('.sheet-tab');
    await expect(tabs).toHaveCount(2);
  });

  test('Clicking a tab switches the active sheet', async ({ page }) => {
    await page.getByTestId('sheet-tabs-add').click();
    const tabs = page.getByTestId('sheet-tabs').locator('.sheet-tab');

    // First tab is active initially. Click second tab.
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false');
  });

  test('Double-click on a tab enables rename, Enter commits', async ({ page }) => {
    const tab = page.getByTestId('sheet-tabs').locator('.sheet-tab').first();
    await tab.dblclick();

    const input = page.locator('.sheet-tab__input').first();
    await expect(input).toBeVisible();
    await input.fill('Forecast');
    await input.press('Enter');

    await expect(tab).toContainText('Forecast');
  });

  test('Right-click opens the context menu with Delete', async ({ page }) => {
    await page.getByTestId('sheet-tabs-add').click();
    const tabs = page.getByTestId('sheet-tabs').locator('.sheet-tab');
    await tabs.nth(1).click({ button: 'right' });

    await expect(page.getByTestId('sheet-context-menu')).toBeVisible();
    await page.getByTestId('sheet-context-menu-delete').click();

    await expect(page.getByTestId('sheet-tabs').locator('.sheet-tab')).toHaveCount(1);
  });

  test('Cannot delete the last remaining sheet', async ({ page }) => {
    const tab = page.getByTestId('sheet-tabs').locator('.sheet-tab').first();
    await tab.click({ button: 'right' });

    await expect(page.getByTestId('sheet-context-menu')).toBeVisible();
    await expect(page.getByTestId('sheet-context-menu-delete')).toBeDisabled();
  });
});
