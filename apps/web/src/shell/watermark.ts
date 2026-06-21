import type { FUniver } from '@univerjs/core/facade';
import { WatermarkService } from '@univerjs/watermark';
import { IWatermarkTypeEnum } from '@univerjs/engine-render';

/**
 * "Confidential watermark" toggle plumbing for the View menu.
 *
 * The app hides Univer's ribbon, so the stock watermark panel never mounts.
 * Instead we drive the `WatermarkService` (registered by `UniverWatermarkPlugin`
 * in `univer/extra-plugins.ts`) directly: ON writes a repeating diagonal
 * "CONFIDENTIAL" text layer, OFF clears it. The service persists the config to
 * `ILocalStorageService` under `UNIVER_WATERMARK_STORAGE_KEY`, and the plugin
 * re-reads it on boot, so the toggle survives a reload for free.
 */

const CONFIDENTIAL_TEXT = 'CONFIDENTIAL';

// Reach the service the same way the rest of the shell reaches Univer
// internals — via the facade's private `_injector` (see App.tsx /
// useAutosave.ts). Returns undefined before the workbook unit exists or if a
// Univer bump renames the back door.
function watermarkService(api: FUniver): WatermarkService | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const injector = (api as any)._injector as { get: (t: unknown) => unknown } | undefined;
  return injector?.get(WatermarkService) as WatermarkService | undefined;
}

/** Apply (true) or clear (false) the CONFIDENTIAL text watermark. */
export function setConfidentialWatermark(api: FUniver, on: boolean): void {
  const svc = watermarkService(api);
  if (!svc) return;
  if (on) {
    svc.updateWatermarkConfig({
      type: IWatermarkTypeEnum.Text,
      config: {
        text: {
          content: CONFIDENTIAL_TEXT,
          fontSize: 24,
          color: 'rgb(120,120,120)',
          bold: true,
          italic: false,
          direction: 'ltr',
          x: 60,
          y: 36,
          repeat: true,
          spacingX: 240,
          spacingY: 160,
          rotate: -30,
          opacity: 0.12,
        },
      },
    });
  } else {
    svc.deleteWatermarkConfig();
  }
}

/** Whether a watermark is currently applied (used to seed the menu's checked state). */
export async function isWatermarkOn(api: FUniver): Promise<boolean> {
  const svc = watermarkService(api);
  if (!svc) return false;
  const config = await svc.getWatermarkConfig();
  return !!config?.config?.text?.content;
}
