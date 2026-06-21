import { test, expect } from '@playwright/test';

async function dispatchEditAndCount(page) {
  return page.evaluate(async () => {
    const w = (document.getElementById('editor') as HTMLIFrameElement).contentWindow as any;
    (w as any).__casualEmbedBlocked = 0; // reset
    const api = w.__casualEmbedApi;
    // dispatch a few mutating commands; the read-only veto cancels each
    for (const id of ['sheet.command.set-bold', 'sheet.command.clear-selection-content']) {
      try {
        await api.executeCommand(id);
      } catch {
        /* ignore */
      }
    }
    return (w as any).__casualEmbedBlocked ?? 0;
  });
}

test('embed preview vetoes edits; editor does not', async ({ page }) => {
  await page.goto('/index.html');
  const frame = page.frameLocator('#editor');
  await frame.locator('[id^="univer-sheet-main-canvas_"]').waitFor({ timeout: 45_000 });
  await page.waitForTimeout(1200);

  // Editor mode: no read-only veto registered → 0 blocks.
  const editorBlocks = await dispatchEditAndCount(page);
  expect(editorBlocks, 'editor mode must NOT veto edits').toBe(0);

  // Preview mode: the veto cancels every mutating command.
  await page.getByLabel('View').selectOption('preview');
  await page.waitForTimeout(3500);
  const previewBlocks = await dispatchEditAndCount(page);
  expect(previewBlocks, 'preview must veto mutating commands').toBeGreaterThan(0);

  await page.screenshot({ path: 'test-results/readonly-preview.png' });
  console.log(`READONLY VERIFIED — editorBlocks=${editorBlocks} previewBlocks=${previewBlocks}`);
});
