---
'@sheet/web': minor
'@casualoffice/sheets': patch
---

Data Validation parity: add the **Time** Allow-type and fix DV i18n.

- **Time validation type** — Excel exposes Time as a distinct Allow-type (Whole / Decimal / List / Date / **Time** / Text length / Custom). Univer's `DataValidationType.TIME` enum and the cell-edit time-picker already existed but no validator/view was registered; the fork now registers `TimeValidator` (parses to a fractional serial, validates the standard operators, normalizes to `HH:mm:ss`) and its panel view.
- **Input Message editor** — the DV panel's Advance options now expose the input-message toggle + title/text fields (the on-hover popup shipped previously).
- **i18n fix** — the locale bundle merged only the DV _UI_ strings, so the DV Type/Operator selectors and cell error messages rendered raw i18n keys (`sheets-data-validation.date.title` instead of "Date") for every type. The base `@univerjs/data-validation` + `@univerjs/sheets-data-validation` locales are now merged in both the app and the SDK embed runtime.
