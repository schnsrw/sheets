import { useEffect, useRef, useState } from 'react';
import { LocaleType, LogLevel, Univer, UniverInstanceType, type IWorkbookData } from '@univerjs/core';
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
import { UniverSheetsSortPlugin } from '@univerjs/sheets-sort';
import { UniverSheetsSortUIPlugin } from '@univerjs/sheets-sort-ui';
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter';
import { UniverSheetsFilterUIPlugin } from '@univerjs/sheets-filter-ui';
import { UniverFindReplacePlugin } from '@univerjs/find-replace';
import { UniverSheetsFindReplacePlugin } from '@univerjs/sheets-find-replace';

// Per-plugin CSS — Univer ships its own design tokens & layout primitives;
// each plugin's `lib/index.css` must be imported once.
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';
import '@univerjs/sheets-formula-ui/lib/index.css';
import '@univerjs/sheets-sort-ui/lib/index.css';
import '@univerjs/sheets-filter-ui/lib/index.css';
import '@univerjs/sheets-numfmt-ui/lib/index.css';
import '@univerjs/find-replace/lib/index.css';

// Facade extensions — side-effect imports that attach methods to FUniver.
import '@univerjs/sheets/facade';
import '@univerjs/sheets-ui/facade';
import '@univerjs/sheets-formula/facade';
import '@univerjs/sheets-numfmt/facade';
import '@univerjs/sheets-sort/facade';
import '@univerjs/sheets-filter/facade';
import '@univerjs/docs-ui/facade';
import '@univerjs/ui/facade';
import '@univerjs/engine-formula/facade';

import { LOCALES } from './locale';
import { useSetUniverAPI } from './use-univer';
import { extendContextMenu } from './context-menu-extensions';

type Props = { snapshot: IWorkbookData };

declare global {
  interface Window {
    __univerAPI?: FUniver;
  }
}

export function UniverSheet({ snapshot }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const setApi = useSetUniverAPI();

  useEffect(() => {
    if (!hostRef.current) return;

    const univer = new Univer({
      theme: defaultTheme,
      locale: LocaleType.EN_US,
      locales: LOCALES,
      logLevel: LogLevel.WARN,
    });

    univer.registerPlugin(UniverRenderEnginePlugin);
    univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverUIPlugin, {
      container: hostRef.current,
      header: false,
      toolbar: false,
      footer: false,
      contextMenu: true,
    });
    univer.registerPlugin(UniverDocsPlugin);
    univer.registerPlugin(UniverDocsUIPlugin);
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsUIPlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin);
    univer.registerPlugin(UniverSheetsFormulaUIPlugin);
    univer.registerPlugin(UniverSheetsNumfmtPlugin);
    univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
    univer.registerPlugin(UniverSheetsSortPlugin);
    univer.registerPlugin(UniverSheetsSortUIPlugin);
    univer.registerPlugin(UniverSheetsFilterPlugin);
    univer.registerPlugin(UniverSheetsFilterUIPlugin);
    univer.registerPlugin(UniverFindReplacePlugin);
    univer.registerPlugin(UniverSheetsFindReplacePlugin);

    univer.createUnit(UniverInstanceType.UNIVER_SHEET, snapshot);

    // Augment the built-in cell context menu with Merge / Unmerge entries.
    extendContextMenu(univer);

    const api = FUniver.newAPI(univer);
    setApi(api);

    const raf = requestAnimationFrame(() => setReady(true));

    if (import.meta.env.DEV) {
      window.__univerAPI = api;
    }

    return () => {
      cancelAnimationFrame(raf);
      setApi(null);
      univer.dispose();
      if (import.meta.env.DEV) {
        delete window.__univerAPI;
      }
    };
    // Mount once per snapshot identity. Re-mounting on every render would tear Univer down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  return (
    <>
      {!ready && (
        <div className="grid-skeleton" data-testid="grid-skeleton" aria-hidden="true">
          <span className="grid-skeleton__chip">
            <span className="grid-skeleton__spinner" />
            Loading workbook…
          </span>
        </div>
      )}
      <div ref={hostRef} data-testid="univer-host" />
    </>
  );
}
