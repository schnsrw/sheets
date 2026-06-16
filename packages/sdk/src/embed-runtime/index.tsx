/**
 * embed-runtime — the in-iframe entry point for the sheet SDK's iframe
 * delivery mode. Sheet sibling of `@schnsrw/docx-js-editor`'s
 * `embed-runtime`; see doc 16 in the parent repo.
 *
 * Lifecycle:
 *
 *   1. Wrapper renders <iframe src="${embedBasePath}/embed.html?...">.
 *   2. iframe loads embed.html which imports + runs `mountEmbedded()`
 *      from this module's compiled bundle.
 *   3. `mountEmbedded` parses URL params, opens an EmbedTransport,
 *      waits for the host's `casual.hello`, issues a load.request
 *      for the docId, parses the returned xlsx bytes via
 *      `xlsxToWorkbookData` → IWorkbookData, mounts <CasualSheets>
 *      with that snapshot into #casual-embed-root.
 *   4. Selection / autosave / signing events all bubble out via the
 *      same transport.
 */

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { EmbedTransport } from '../embed/EmbedTransport';
import type { CasualApp } from '../embed/protocol';
import { CasualSheets } from '../sheets/CasualSheets';
import { xlsxToWorkbookData } from '../xlsx';
import type { IWorkbookData } from '@univerjs/core';

interface EmbedUrlConfig {
  app: CasualApp;
  docId: string;
  viewMode: 'preview' | 'editor';
}

function parseUrlConfig(search: string): EmbedUrlConfig {
  const params = new URLSearchParams(search);
  const app: CasualApp = params.get('app') === 'docs' ? 'docs' : 'sheet';
  const docId = params.get('docId') ?? '';
  const viewModeParam = params.get('viewMode');
  const viewMode: 'preview' | 'editor' = viewModeParam === 'editor' ? 'editor' : 'preview';
  return { app, docId, viewMode };
}

export interface MountEmbeddedOptions {
  root: HTMLElement;
  search?: string;
  hostOrigin?: string;
  identity?: { version: string; commit: string; capabilities?: string[] };
}

/** Public entry — called by embed.html. */
// Side-effect import: pull in Univer's CSS modules so the embed
// runtime is fully self-contained. Without these, the embed.html has
// no <link rel="stylesheet"> and Univer's workbench renders unstyled
// (the canvas mounts at 0×0 size, all chrome divs have no layout).
// `injectStyle: true` in tsup turns each import into a runtime
// <style> tag append.
import '../styles';

// Side-effect imports: augment the FUniver facade with the
// `getActiveWorkbook` / `getActiveSheet` / `getActiveRange` chain
// the toolbar bridge calls. The sheet SDK ships these on Univer's
// sheets / sheets-ui packages as facade extensions; without the
// import the typings are missing and the runtime calls noop.
import '@univerjs/sheets/facade';
import '@univerjs/sheets-ui/facade';

export function mountEmbedded(opts: MountEmbeddedOptions): void {
  const search = opts.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const config = parseUrlConfig(search);

  const hostOrigin =
    opts.hostOrigin ??
    inferHostOrigin() ??
    (typeof window !== 'undefined' ? window.location.origin : '');

  const identity = opts.identity ?? {
    version: '0.0.0',
    commit: 'unknown',
    capabilities: ['load', 'save', 'selection', 'signing'],
  };

  const transport = new EmbedTransport({
    app: config.app,
    hostOrigin,
    version: identity.version,
    commit: identity.commit,
    capabilities: identity.capabilities ?? ['load', 'save', 'selection', 'signing'],
  });

  opts.root.setAttribute('data-view-mode', config.viewMode);

  transport.on({
    onCommandSetViewMode: ({ viewMode }) => {
      opts.root.setAttribute('data-view-mode', viewMode);
      // v0.5.x will toggle CasualSheets's `ui` prop in response;
      // v0.5.0 only updates the data attribute so iframe-side CSS
      // can react.
    },
  });

  transport.sendHello();
  // Also send `casual.ready` so the host's `onEditorReady` fires without
  // waiting for the host to send `casual.hello` first. The protocol's
  // sendReady-on-receiving-hello path stays as a fallback for hosts that
  // do send hello eagerly; this just kicks off the handshake on the
  // iframe side so we don't deadlock when the host's strategy is to
  // wait for `casual.ready`.
  transport.sendReady();

  const reactRoot = createRoot(opts.root);
  reactRoot.render(
    <EmbeddedSheets transport={transport} docId={config.docId} initialViewMode={config.viewMode} />,
  );
}

/** Inner React component — handles the async xlsx load + workbook
 *  mount. Splitting it out lets useEffect orchestrate the
 *  request/response without blocking the React tree at mount. */
function EmbeddedSheets({
  transport,
  docId,
  initialViewMode,
}: {
  transport: EmbedTransport;
  docId: string;
  initialViewMode: 'preview' | 'editor';
}) {
  const [data, setData] = useState<IWorkbookData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'preview' | 'editor'>(initialViewMode);
  // Editor mode flips `header: true` so Univer's formula bar (A1 cell
  // ref, fx button) and menubar render at the top of the iframe —
  // visually distinct from preview's canvas-only surface. `toolbar` and
  // `footer` stay off: Univer's ribbon and sheet-tabs slot resolve
  // services (IRPCChannelService, sheet-drawing) at construction that
  // the SDK doesn't bundle a worker for, and turning them on lights up
  // `[redi]: Cannot find "Kb" registered by any injector` and the
  // canvas never paints. Cells stay editable in editor mode via direct
  // keyboard input on the focused cell.
  const ui =
    viewMode === 'editor'
      ? { header: true, toolbar: false, footer: false, contextMenu: true }
      : { header: false, toolbar: false, footer: false, contextMenu: true };

  useEffect(() => {
    transport.on({
      onCommandSetViewMode: ({ viewMode: next }) => setViewMode(next),
    });
  }, [transport]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resp = await transport.requestLoad(docId);
        if (cancelled) return;
        if (!resp.ok) {
          setErrorMsg(resp.message ?? `load failed: ${resp.code}`);
          transport.sendError({
            code: 'load_failed',
            message: resp.message ?? resp.code,
          });
          return;
        }
        const snapshot = await xlsxToWorkbookData(resp.bytes);
        if (cancelled) return;
        setData(snapshot);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setErrorMsg(message);
        transport.sendError({ code: 'parse_failed', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transport, docId]);

  if (errorMsg) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          textAlign: 'center',
          color: 'var(--danger, #d63a2f)',
          fontSize: 13,
        }}
      >
        Failed to load workbook: {errorMsg}
      </div>
    );
  }

  if (!data) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted, #5a5a5a)',
          fontSize: 13,
        }}
      >
        Loading workbook…
      </div>
    );
  }

  // Force a remount when viewMode flips — CasualSheets locks the UI
  // config at registerPlugin time and won't pick up new props.
  return (
    <CasualSheets
      key={viewMode}
      initialData={data}
      ui={ui}
      onReady={(api) => {
        // Wire host → editor command.execute (Drive's custom toolbar
        // calls this for bold / italic / undo / …). Maps the small
        // protocol union to the Univer command id the FUniver facade
        // dispatches. The command set is intentionally narrow — v0.6
        // ships the always-relevant operations, font / color / fill
        // land in v0.7 once we lock the cell-mutate payload shape.
        // Cast through `unknown` — the FUniver type is augmented via
        // @univerjs/sheets/facade module augmentation (the side-effect
        // import above), but tsc doesn't always pick up the merged
        // signature when the facade is imported as a side effect inside
        // a different module. The runtime behaviour is fine.
        const apiAny = api as unknown as {
          executeCommand(id: string, params?: object): Promise<unknown>;
          getActiveWorkbook(): { getActiveSheet(): SheetLike | null } | null;
        };
        transport.on({
          onCommandExecute: ({ command }) => {
            const id = SHEET_COMMAND_MAP[command];
            if (!id) return;
            const params: object | undefined =
              command === 'align-left'
                ? { value: 'left' }
                : command === 'align-center'
                  ? { value: 'center' }
                  : command === 'align-right'
                    ? { value: 'right' }
                    : undefined;
            try {
              void apiAny.executeCommand(id, params);
            } catch {
              /* swallow — bad command id from a stale host shouldn't crash the iframe */
            }
          },
        });

        // Editor → host: emit format state on a coarse interval. The
        // FUniver facade in 0.24 doesn't expose a stable
        // selection-changed event hook on FWorksheet (the public API
        // is in flux); polling every 200 ms is the smallest reliable
        // surface that keeps the toolbar buttons in sync without
        // hooking the internal command service. Drive throttles its
        // own re-renders, so the wire stays cheap.
        const emit = () => {
          try {
            const wb = apiAny.getActiveWorkbook();
            const sheet = wb?.getActiveSheet();
            const range = sheet?.getActiveRange?.();
            if (!range) return;
            const cell = range.getCell?.(0, 0) ?? range;
            const fmt = readFormatFlags(cell);
            transport.sendSelectionFormatState(fmt);
          } catch {
            /* selection may not exist yet during boot — ignore */
          }
        };
        emit();
        const interval = setInterval(emit, 200);
        // Best-effort cleanup — there's no unmount hook here, but if
        // the iframe navigates away the interval is GC'd with the
        // closure.
        void interval;
      }}
    />
  );
}

/** Maps the small host-facing protocol union to Univer command ids the
 *  FUniver facade dispatches. Kept inline so the wire surface and the
 *  Univer integration evolve together. */
const SHEET_COMMAND_MAP: Record<string, string> = {
  undo: 'univer.command.undo',
  redo: 'univer.command.redo',
  bold: 'sheet.command.set-range-bold',
  italic: 'sheet.command.set-range-italic',
  underline: 'sheet.command.set-range-underline',
  strikethrough: 'sheet.command.set-range-strike-through',
  'align-left': 'sheet.command.set-horizontal-text-align',
  'align-center': 'sheet.command.set-horizontal-text-align',
  'align-right': 'sheet.command.set-horizontal-text-align',
};

interface CellLike {
  getFontWeight?: () => unknown;
  getFontStyle?: () => unknown;
  getUnderline?: () => unknown;
  getStrikethrough?: () => unknown;
  getHorizontalAlignment?: () => unknown;
}

interface RangeLike {
  getCell?(row: number, col: number): unknown;
  getFontWeight?: () => unknown;
  getFontStyle?: () => unknown;
  getUnderline?: () => unknown;
  getStrikethrough?: () => unknown;
  getHorizontalAlignment?: () => unknown;
}

interface SheetLike {
  getActiveRange?(): RangeLike | null;
}

function readFormatFlags(cell: unknown): {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  align: 'left' | 'center' | 'right' | null;
} {
  const c = cell as CellLike;
  const bold = String(c.getFontWeight?.() ?? '').toLowerCase() === 'bold';
  const italic = String(c.getFontStyle?.() ?? '').toLowerCase() === 'italic';
  const underline = !!c.getUnderline?.();
  const strikethrough = !!c.getStrikethrough?.();
  const ha = String(c.getHorizontalAlignment?.() ?? '').toLowerCase();
  const align: 'left' | 'center' | 'right' | null =
    ha === 'left' || ha === 'center' || ha === 'right' ? ha : null;
  return { bold, italic, underline, strikethrough, align };
}

function inferHostOrigin(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const ref = document.referrer;
  if (!ref) return undefined;
  try {
    return new URL(ref).origin;
  } catch {
    return undefined;
  }
}
