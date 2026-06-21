---
'@casualoffice/sheets': patch
---

Two embed fixes found opening real files in a host (Drive):

- **Page hung on open.** The embed ran formula recalc on the MAIN thread (no worker), so a formula-heavy workbook froze the page. The embed now bundles a formula worker (`formula.worker.js`, mirroring the reference app) and wires it via `<CasualSheets formula={{ worker }}>`, so compute runs off-thread. Verified: `=1+2*3` → 7 across 300 formula cells with the page staying responsive.
- **Feature-plugin UIs showed raw i18n keys** (the comment panel rendered `thread-comment-ui.editor.reply` instead of "Reply"; tables/filter/CF dialogs likewise). The embed locale bundle only had the base plugins; it now includes every lazily-loaded feature plugin's en-US strings (comments, tables, sort, filter, conditional formatting, data validation, drawing, hyperlinks, notes, find/replace).
