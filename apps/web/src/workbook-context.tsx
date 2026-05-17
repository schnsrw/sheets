import { createContext } from 'react';
import type { IWorkbookData } from '@univerjs/core';

/**
 * Lifts the active workbook snapshot to App state so File → Open can replace
 * it. Changing `snapshot` re-mounts `<UniverSheet>` (which keys on snapshot
 * identity), dropping the old Univer instance and creating a new one with
 * the loaded data.
 */

/**
 * The format the current workbook was loaded from. Drives the Save action so
 * Ctrl+S writes back in the same format the user opened (Excel and LibreOffice
 * both behave this way). `null` means "started blank" — Save defaults to xlsx.
 */
export type WorkbookFormat = 'xlsx' | 'ods' | 'csv' | 'tsv';

export type WorkbookCtxValue = {
  snapshot: IWorkbookData;
  replaceWorkbook: (next: IWorkbookData, sourceFormat?: WorkbookFormat | null) => void;
  sourceFormat: WorkbookFormat | null;
};

export const WorkbookContext = createContext<WorkbookCtxValue | null>(null);
