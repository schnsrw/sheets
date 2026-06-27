---
'@casualoffice/sheets': patch
---

Preserve cell indentation on xlsx import/export. Excel's `alignment.indent` level was dropped, so indented/outline data flattened to the left edge on open and on save. It now maps to Univer's left padding (`pd.l`, which the renderer applies as a text indent) at ~10px per level on top of the 2px default, and round-trips exactly back to the Excel level.
