import { LocaleType, Tools } from '@univerjs/core';

import UniverSheetsEnUS from '@univerjs/sheets/locale/en-US';
import UniverSheetsUIEnUS from '@univerjs/sheets-ui/locale/en-US';
import UniverSheetsFormulaEnUS from '@univerjs/sheets-formula/locale/en-US';
import UniverSheetsFormulaUIEnUS from '@univerjs/sheets-formula-ui/locale/en-US';
import UniverSheetsSortUIEnUS from '@univerjs/sheets-sort-ui/locale/en-US';
import UniverSheetsFilterUIEnUS from '@univerjs/sheets-filter-ui/locale/en-US';
import UniverSheetsNumfmtUIEnUS from '@univerjs/sheets-numfmt-ui/locale/en-US';
import UniverFindReplaceEnUS from '@univerjs/find-replace/locale/en-US';
import UniverSheetsFindReplaceEnUS from '@univerjs/sheets-find-replace/locale/en-US';
import UniverDocsUIEnUS from '@univerjs/docs-ui/locale/en-US';
import UniverUIEnUS from '@univerjs/ui/locale/en-US';

const enUS = Tools.deepMerge(
  {},
  UniverSheetsEnUS,
  UniverSheetsUIEnUS,
  UniverSheetsFormulaEnUS,
  UniverSheetsFormulaUIEnUS,
  UniverSheetsSortUIEnUS,
  UniverSheetsFilterUIEnUS,
  UniverSheetsNumfmtUIEnUS,
  UniverFindReplaceEnUS,
  UniverSheetsFindReplaceEnUS,
  UniverDocsUIEnUS,
  UniverUIEnUS,
);

export const LOCALES = {
  [LocaleType.EN_US]: enUS,
};
