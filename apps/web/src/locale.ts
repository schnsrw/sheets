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
import UniverSheetsConditionalFormattingUIEnUS from '@univerjs/sheets-conditional-formatting-ui/locale/en-US';
import UniverSheetsDataValidationUIEnUS from '@univerjs/sheets-data-validation-ui/locale/en-US';
import UniverSheetsHyperLinkUIEnUS from '@univerjs/sheets-hyper-link-ui/locale/en-US';
import UniverSheetsNoteUIEnUS from '@univerjs/sheets-note-ui/locale/en-US';
import UniverSheetsTableUIEnUS from '@univerjs/sheets-table-ui/locale/en-US';
import UniverThreadCommentUIEnUS from '@univerjs/thread-comment-ui/locale/en-US';
import UniverSheetsThreadCommentUIEnUS from '@univerjs/sheets-thread-comment-ui/locale/en-US';
import UniverDrawingUIEnUS from '@univerjs/drawing-ui/locale/en-US';
import UniverSheetsDrawingUIEnUS from '@univerjs/sheets-drawing-ui/locale/en-US';
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
  UniverSheetsConditionalFormattingUIEnUS,
  UniverSheetsDataValidationUIEnUS,
  UniverSheetsHyperLinkUIEnUS,
  UniverSheetsNoteUIEnUS,
  UniverSheetsTableUIEnUS,
  UniverThreadCommentUIEnUS,
  UniverSheetsThreadCommentUIEnUS,
  UniverDrawingUIEnUS,
  UniverSheetsDrawingUIEnUS,
  UniverDocsUIEnUS,
  UniverUIEnUS,
);

export const LOCALES = {
  [LocaleType.EN_US]: enUS,
};
