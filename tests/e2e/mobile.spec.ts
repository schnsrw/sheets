import { expect, test } from '@playwright/test';
import { waitForUniver } from './_helpers';

// Phone-sized viewport. Drives the @media (max-width: 480px) / 720px
// rules in styles.css.
const PHONE_VIEWPORT = { width: 375, height: 667 };

/**
 * Mobile shell — viewer + light-editor lane per CLAUDE.md's mobile
 * scope. Univer's canvas owns its own touch gestures; the React shell's
 * job is making sure the chrome around the canvas reads and behaves
 * properly on a phone.
 *
 * NOT a "full mobile editing" suite — chart insert, pivot field-list,
 * complex formula composition are explicitly out-of-scope on mobile.
 * These tests lock the surfaces a viewer + casual editor needs.
 */
test.describe('Mobile shell (375 × 667)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
  });

  // Dismiss the home overlay (added in the home-gallery commit) so the
  // editor chrome behind it is reachable. The home is the right default
  // for real users but it covers menu bar / toolbar / formula bar for
  // the chrome assertions below.
  async function dismissHome(page: import('@playwright/test').Page) {
    await page.goto('/');
    await waitForUniver(page);
    const home = page.getByTestId('home-screen');
    if (await home.count()) {
      await page.getByTestId('home-close').click();
      await expect(home).toHaveCount(0);
    }
  }

  test('renders without horizontal overflow', async ({ page }) => {
    await page.goto('/');
    await waitForUniver(page);

    // Document width may slightly exceed viewport because the menubar +
    // toolbar are designed to horizontally scroll on phones. The BODY
    // itself shouldn't overflow.
    const bodyOverflow = await page.evaluate(() => {
      const body = document.body;
      return body.scrollWidth - body.clientWidth;
    });
    expect(bodyOverflow, `body overflowed by ${bodyOverflow}px`).toBeLessThanOrEqual(2);
  });

  test('menu bar is reachable and scrolls horizontally to reveal all items', async ({ page }) => {
    await dismissHome(page);

    // Every menubar item must still exist in the DOM (we don't drop any
    // on mobile — they're scrollable, not hidden).
    for (const id of ['file', 'edit', 'view', 'insert', 'format', 'data', 'help']) {
      await expect(page.getByTestId(`menubar-${id}`)).toBeAttached();
    }

    // File menu still opens and shows its core items.
    await page.getByTestId('menubar-file').click();
    await expect(page.getByTestId('menu-item-open')).toBeVisible();
    await expect(page.getByTestId('menu-item-save')).toBeVisible();
  });

  test('toolbar stays visible (compact) on a 375 px viewport', async ({ page }) => {
    await dismissHome(page);
    // Mobile-pass change (was hidden previously): the toolbar is now
    // a single-row horizontal-scroll strip so light formatting is one
    // tap away. Row 2 of every ribbon group is hidden via CSS.
    await expect(page.getByTestId('toolbar')).toBeVisible();
    await expect(page.getByTestId('formula-bar')).toBeVisible();
    await expect(page.getByTestId('grid-host')).toBeVisible();
  });

  test('formula-bar input is ≥ 16 px so iOS Safari does not focus-zoom', async ({ page }) => {
    await dismissHome(page);
    const input = page.locator('.formula-bar__input').first();
    await expect(input).toBeAttached();
    const fontSize = await input.evaluate(
      (el) => parseFloat(window.getComputedStyle(el).fontSize),
    );
    // iOS Safari triggers an auto-zoom on inputs with computed font-size
    // < 16 px. The mobile breakpoint pins this; if it ever regresses,
    // the whole layout shifts on focus and editing becomes unusable.
    expect(fontSize, `formula-bar input font-size was ${fontSize}px`).toBeGreaterThanOrEqual(16);
  });
});

test.describe('Collab indicator', () => {
  test('renders in solo mode by default', async ({ page }) => {
    await page.goto('/');
    await waitForUniver(page);
    const indicator = page.getByTestId('collab-indicator');
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute('data-collab-status', 'off');
    await expect(indicator).toContainText(/Solo/i);
  });
});
