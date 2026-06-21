---
'@casualoffice/sheets': minor
---

Add `CasualSheetsAPI.importXlsx(input)` — parse an `.xlsx` (`File`/`Blob`/`ArrayBuffer`/`Uint8Array`) and load it as the active workbook in one call. The ExcelJS parser is lazy-loaded from the `@casualoffice/sheets/xlsx` subpath (externalised in the build), so hosts that never import a file don't pay for it and the editor entry stays small. When a `File` is passed, its name + on-disk size are recorded on the snapshot (surfaced by the built-in Properties dialog).
