---
'@casualoffice/sheets': minor
---

SDK chrome (`chrome="full"` / the iframe embed) now matches the real app's Home-tab toolbar + menus. **Toolbar** gains: font family/size selectors + grow/shrink, clipboard (paste/cut/copy/paste-values), format painter, text & fill color pickers, borders, vertical align + wrap text, a number-format dropdown, and AutoSum. **Menus** gain the full Edit/View/Insert/Format/Data/Help sets (freeze panes, show formulas, gridlines, insert sheet/table/image/hyperlink/comment, number-format submenu, increase/decrease decimals, borders, sort/filter/recalculate, etc.) — all driven purely through the FUniver facade + the same Univer command ids the app uses.

Two new optional props on the chrome:

- `features?: Record<string, boolean>` — hide any control/group (and block its command) when its flag is false. Lets hosts disable features.
- `onDialogRequest?: (kind, context?) => void` — controls backed by a dialog the SDK doesn't ship yet (Format Cells, Insert Chart, PivotTable, Find & Replace, …) call this so the host can render its OWN dialog; without it they're omitted (no fake dialog). Built-in dialogs land in a later release.
