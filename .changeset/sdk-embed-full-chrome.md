---
'@casualoffice/sheets': minor
---

Embed runtime `viewMode="editor"` now renders the **full SDK chrome** — the menu bar (Edit/Insert/Format/Data/View), the rich formatting toolbar (font, B/I/U, alignment, borders, number formats, colors), the formula bar, sheet tabs and status bar — so a host embeds a _complete_ spreadsheet editor and only frames/brands it, rather than hand-rolling its own toolbar.

Previously the embed used Univer's built-in `ui` toggles, which could only show the formula bar (turning on Univer's ribbon/sheet-tabs threw `[redi]: Cannot find … registered by any injector` in the single-file bundle). It now mounts `<CasualSheets chrome="full">` — the SDK's own React chrome over the facade, which has no such service dependency and bundles cleanly into the iframe. `viewMode="preview"` stays `chrome="none"` (bare, read-only grid).
