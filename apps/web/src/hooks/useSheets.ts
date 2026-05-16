import { useEffect, useState } from 'react';
import { useUniverAPI } from '../use-univer';

/**
 * Live list of sheets in the active workbook, plus the active sheet id.
 * Reacts to: SheetCreated, SheetDeleted, SheetNameChanged, ActiveSheetChanged.
 */

export type SheetSummary = { id: string; name: string };

export type SheetsState = {
  ready: boolean;
  sheets: SheetSummary[];
  activeSheetId: string | null;
};

const EMPTY: SheetsState = { ready: false, sheets: [], activeSheetId: null };

export function useSheets(): SheetsState {
  const api = useUniverAPI();
  const [state, setState] = useState<SheetsState>(EMPTY);

  useEffect(() => {
    if (!api) return;

    const compute = (): SheetsState => {
      const wb = api.getActiveWorkbook();
      if (!wb) return EMPTY;
      const sheets = wb.getSheets().map((s) => ({ id: s.getSheetId(), name: s.getSheetName() }));
      const active = wb.getActiveSheet();
      return {
        ready: true,
        sheets,
        activeSheetId: active?.getSheetId() ?? null,
      };
    };

    setState(compute());

    const disposables = [
      api.addEvent(api.Event.SheetCreated, () => setState(compute())),
      api.addEvent(api.Event.SheetDeleted, () => setState(compute())),
      api.addEvent(api.Event.SheetNameChanged, () => setState(compute())),
      api.addEvent(api.Event.ActiveSheetChanged, () => setState(compute())),
      api.addEvent(api.Event.SheetMoved, () => setState(compute())),
    ];
    return () => {
      for (const d of disposables) d.dispose();
    };
  }, [api]);

  return state;
}
