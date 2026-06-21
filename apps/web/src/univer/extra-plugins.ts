import type { Univer } from '@univerjs/core';
import { UniverSheetsCrosshairHighlightPlugin } from '@univerjs/sheets-crosshair-highlight';
import { UniverSheetsZenEditorPlugin } from '@univerjs/sheets-zen-editor';
import { UniverSheetsGraphicsPlugin } from '@univerjs/sheets-graphics';
import { UniverWatermarkPlugin } from '@univerjs/watermark';

/**
 * Register the app's EXTRA Univer plugins — the ones `<CasualSheets>` (the SDK
 * editor core) does NOT bundle. Passed to `<CasualSheets onBeforeCreateUnit>` so
 * they register before the workbook unit is created, alongside the SDK's own
 * plugin set.
 *
 * The SDK already registers render / formula-engine / UI / docs / sheets /
 * sheets-ui / sheets-formula / numfmt. The off-main formula worker
 * (`UniverRPCMainThreadPlugin`) is wired via the SDK's `formula={{ worker }}`
 * prop, NOT here. What's left that the app wants and the SDK doesn't ship:
 *
 *  - crosshair highlight — Excel-style active row/column highlight (context menu).
 *  - zen editor — immersive full-screen cell editor for long content.
 *  - sheets-graphics — canvas render primitive for custom on-grid graphics; no
 *    UI / commands of its own, a drop-in dependency for higher-level drawing.
 *  - watermark — overlay layer (text / image). We drive it ourselves from the
 *    View menu ("Confidential watermark") since the app hides Univer's ribbon
 *    that would otherwise host the watermark panel; the plugin only registers
 *    the render layer + `WatermarkService`. See `shell/MenuBar.tsx`.
 *
 * (Replaces the bespoke core-plugin registration in `./plugins.ts`, which the
 * app no longer needs now that the SDK owns the core bootstrap.)
 */
export function registerExtraPlugins(univer: Univer): void {
  univer.registerPlugin(UniverSheetsCrosshairHighlightPlugin);
  univer.registerPlugin(UniverSheetsZenEditorPlugin);
  univer.registerPlugin(UniverSheetsGraphicsPlugin);
  univer.registerPlugin(UniverWatermarkPlugin);
}
