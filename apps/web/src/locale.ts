import { LocaleType, Tools } from '@univerjs/core';

import UniverSheetsEnUS from '@univerjs/sheets/locale/en-US';
import UniverSheetsUIEnUS from '@univerjs/sheets-ui/locale/en-US';
import UniverSheetsFormulaEnUS from '@univerjs/sheets-formula/locale/en-US';
import UniverDocsUIEnUS from '@univerjs/docs-ui/locale/en-US';
import UniverUIEnUS from '@univerjs/ui/locale/en-US';

const enUS = Tools.deepMerge(
  {},
  UniverSheetsEnUS,
  UniverSheetsUIEnUS,
  UniverSheetsFormulaEnUS,
  UniverDocsUIEnUS,
  UniverUIEnUS,
);

export const LOCALES = {
  [LocaleType.EN_US]: enUS,
};
