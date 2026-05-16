import { LocaleType, type IWorkbookData } from '@univerjs/core';

export function emptyWorkbook(): IWorkbookData {
  return {
    id: 'workbook-1',
    rev: 1,
    name: 'Untitled',
    appVersion: '0.22.1',
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: ['sheet-1'],
    sheets: {
      'sheet-1': {
        id: 'sheet-1',
        name: 'Sheet1',
        cellData: {},
        rowCount: 1000,
        columnCount: 26,
      },
    },
  };
}
