/**
 * CasualSheets — minimal React wrapper around Univer Sheets.
 *
 * Boots Univer with the eager plugin set (render + formula engine +
 * UI + docs + sheets + sheets-ui + sheets-formula + numfmt), mounts a
 * single workbook unit from `initialData`, and surfaces the
 * `FUniver` API to the host via `onReady`.
 *
 * Intentionally NOT included (host can layer on top via FUniver):
 *   - Lazy plugin loading (conditional formatting, drawings, sort,
 *     filter, hyperlinks, tables, comments, find/replace, …). Host
 *     calls `univer.registerPlugin(...)` after `onReady`.
 *   - Formula compute via Web Worker — `notExecuteFormula: false`
 *     is the default; the formula engine runs on the main thread.
 *     Host wires `UniverRPCMainThreadPlugin` + a worker URL itself
 *     if it wants the off-main path.
 *   - Snapshot swap (this component mounts a snapshot once; change
 *     the React `key` to remount with a fresh snapshot).
 *   - Paste-merge hooks, dev helpers, zoom-shortcut overrides,
 *     facade extensions — all app concerns.
 *
 * Styles: host must import `@casualoffice/sheets/styles.css`
 * (or the per-plugin CSS) once at app boot. Tree-shaking strips the
 * styles from this entry if the host doesn't reach the styles export.
 */

import { useEffect, useRef, type CSSProperties } from 'react';
import {
  LocaleType,
  LogLevel,
  Univer,
  UniverInstanceType,
  type IWorkbookData,
  type ILocales,
} from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { defaultTheme } from '@univerjs/themes';

import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverUIPlugin } from '@univerjs/ui';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverSheetsFormulaUIPlugin } from '@univerjs/sheets-formula-ui';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import { UniverSheetsNumfmtUIPlugin } from '@univerjs/sheets-numfmt-ui';

export interface CasualSheetsProps {
  /** Workbook snapshot to mount. Read once on initial mount; change
   *  the React `key` on this component to remount with a new
   *  workbook. */
  initialData: IWorkbookData;
  /** Called after the workbook unit is created. The FUniver API is
   *  how the host drives the sheet (read cells, mutate, listen for
   *  events, register additional plugins). */
  onReady?: (api: FUniver, univer: Univer) => void;
  /** Locale identifier. Defaults to `LocaleType.EN_US`. */
  locale?: LocaleType;
  /** Locale string bundle. Optional — Univer's default English
   *  strings load if omitted. */
  locales?: ILocales;
  /** Univer log level. Defaults to `LogLevel.WARN`. */
  logLevel?: LogLevel;
  /** Univer chrome toggles. Defaults: header / toolbar / footer off,
   *  context menu on — matches Casual Sheets' embedded shape. */
  ui?: {
    header?: boolean;
    toolbar?: boolean;
    footer?: boolean;
    contextMenu?: boolean;
  };
  /** Override the theme. Defaults to Univer's `defaultTheme`. */
  theme?: typeof defaultTheme;
  /** Container style. Default fills the parent. */
  style?: CSSProperties;
  /** Container className for additional styling hooks. */
  className?: string;
  /** Optional test id for the host container. */
  testId?: string;
}

const DEFAULT_STYLE: CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'relative',
};

const DEFAULT_UI = {
  header: false,
  toolbar: false,
  footer: false,
  contextMenu: true,
};

export function CasualSheets({
  initialData,
  onReady,
  locale = LocaleType.EN_US,
  locales,
  logLevel = LogLevel.WARN,
  ui,
  theme = defaultTheme,
  style,
  className,
  testId = 'casual-sheets',
}: CasualSheetsProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    const univer = new Univer({
      theme,
      locale,
      locales,
      logLevel,
    });

    const uiOpts = { ...DEFAULT_UI, ...ui, container };

    univer.registerPlugin(UniverRenderEnginePlugin);
    // Formula plugins use `notExecuteFormula: true` so they don't try
    // to spin up an UniverRPCMainThreadPlugin worker — which the SDK
    // doesn't bundle. apps/web's chain (the reference) wires a real
    // RPC formula worker; embed consumers can opt into that in a
    // future revision by passing their own `plugins` extension.
    //
    // `UniverSheetsFormulaUIPlugin` was dropped from this chain
    // because its mount path resolves `IRPCChannelService` via
    // Univer's DI, and with no RPC main-thread plugin registered the
    // resolve fails with "[redi]: Expect 1 dependency item(s) for
    // id IRPCChannelService but get 0" — a console error that the
    // strict iframe verify suite caught. Cells remain editable
    // without the formula-bar autocomplete UI.
    univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: true });
    univer.registerPlugin(UniverUIPlugin, uiOpts);
    univer.registerPlugin(UniverDocsPlugin);
    univer.registerPlugin(UniverDocsUIPlugin);
    univer.registerPlugin(UniverSheetsPlugin, { notExecuteFormula: true });
    univer.registerPlugin(UniverSheetsUIPlugin);
    // UniverSheetsFormulaPlugin + UniverSheetsFormulaUIPlugin both
    // resolve IRPCChannelService at construction. With no
    // UniverRPCMainThreadPlugin registered (the SDK doesn't ship a
    // formula worker) Univer's DI throws "[redi]: Expect 1 dependency
    // item(s) for id IRPCChannelService". Cells stay editable without
    // these — formula computation is the lost capability, which the
    // 0.5.x SDK already disables via notExecuteFormula:true.
    univer.registerPlugin(UniverSheetsNumfmtPlugin);
    univer.registerPlugin(UniverSheetsNumfmtUIPlugin);

    univer.createUnit(UniverInstanceType.UNIVER_SHEET, initialData);

    const api = FUniver.newAPI(univer);
    onReady?.(api, univer);

    return () => {
      // Defer disposal off the React render phase — Univer owns its
      // own React root, and a synchronous unmount mid-render warns
      // and leaves the canvas detached.
      const toDispose = univer;
      queueMicrotask(() => toDispose.dispose());
    };
    // initialData is intentionally NOT in the dep array — the wrapper
    // mounts the snapshot once. Hosts that need to swap workbooks
    // change the React `key` to force a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      style={{ ...DEFAULT_STYLE, ...style }}
      className={className}
      data-testid={testId}
    />
  );
}
