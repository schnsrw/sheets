/**
 * Minimal en-US locale bundle for the in-iframe runtime.
 *
 * The embed runtime mounts the MINIMAL editor (`lazyPlugins={false}`):
 * render + formula engines, UI, docs/docs-ui, sheets, sheets-ui,
 * sheets-formula-ui, numfmt (+ ui). Univer's `LocaleService` throws
 * `Locale not initialized` and the workbench canvas never paints if the
 * `locales` map is empty — so we MUST seed the string bundle for exactly
 * those plugins. (The React `<CasualSheets>` host path supplies its own
 * `locales` prop; the iframe has no host to pass one, so it bundles this.)
 *
 * Kept narrow on purpose: only the plugins the minimal runtime registers.
 * Adding strings for plugins it never loads is dead weight in the
 * self-contained iframe bundle.
 */

import { LocaleType, Tools } from '@univerjs/core';

import UniverSheetsEnUS from '@univerjs/sheets/locale/en-US';
import UniverSheetsUIEnUS from '@univerjs/sheets-ui/locale/en-US';
import UniverSheetsFormulaUIEnUS from '@univerjs/sheets-formula-ui/locale/en-US';
import UniverSheetsNumfmtUIEnUS from '@univerjs/sheets-numfmt-ui/locale/en-US';
import UniverDocsUIEnUS from '@univerjs/docs-ui/locale/en-US';
import UniverUIEnUS from '@univerjs/ui/locale/en-US';

const enUS = Tools.deepMerge(
  {},
  UniverUIEnUS,
  UniverDocsUIEnUS,
  UniverSheetsEnUS,
  UniverSheetsUIEnUS,
  UniverSheetsFormulaUIEnUS,
  UniverSheetsNumfmtUIEnUS,
);

export const EMBED_LOCALES = {
  [LocaleType.EN_US]: enUS,
};
