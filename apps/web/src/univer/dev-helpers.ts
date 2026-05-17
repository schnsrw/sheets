import type { FUniver } from '@univerjs/core/facade';
import { SheetTableService } from '@univerjs/sheets-table';

declare global {
  interface Window {
    __univerAPI?: FUniver;
    __getTableStyleId__?: (tableId: string) => string | undefined;
  }
}

/**
 * DEV-only window helpers used by e2e specs. Anything that needs to reach
 * into Univer's internals from a Playwright test belongs here, not in
 * production code paths.
 *
 * Currently:
 *   - __univerAPI exposes the FUniver facade.
 *   - __getTableStyleId__ exposes the underlying Table's tableStyleId, which
 *     FWorkbook.getTableList intentionally strips from its public projection.
 */
export function installDevHelpers(api: FUniver): () => void {
  if (!import.meta.env.DEV) return () => {};

  window.__univerAPI = api;
  window.__getTableStyleId__ = (tableId) => {
    const wb = api.getActiveWorkbook();
    if (!wb) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = (wb as any)._injector?.get(SheetTableService) as
      | {
          _tableManager?: {
            getTable: (u: string, t: string) =>
              | { getTableStyleId: () => string }
              | undefined;
          };
        }
      | undefined;
    return svc?._tableManager?.getTable(wb.getId(), tableId)?.getTableStyleId();
  };

  return () => {
    delete window.__univerAPI;
    delete window.__getTableStyleId__;
  };
}
