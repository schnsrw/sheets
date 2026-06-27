---
'@casualoffice/sheets': patch
---

Preserve conditional-formatting highlight rules through the xlsx round-trip. Previously all conditional formatting was dropped on import and export. Now `cellIs` (numeric comparisons) and `expression` (formula) rules — with their fill/font style — bridge to and from Univer's `SHEET_CONDITIONAL_FORMATTING_PLUGIN` resource, so a workbook's highlight rules survive Excel → open here → save → Excel instead of being lost. Visual rule types (color scales, data bars, icon sets) and text/time-period operators aren't mapped yet and are skipped (never corrupted); live in-editor re-rendering of imported rules is a follow-up.
