---
"@casualoffice/sheets": minor
---

SDK editor: working formula engine + a stable `CasualSheetsAPI` imperative ref.

- **Formula engine now runs in embedding hosts.** The library entries
  (`index`/`sheets`/`xlsx`/`embed`/`univer`) externalise `@univerjs` so a host
  that already ships Univer no longer gets a second redi copy (which previously
  threw `[redi] loading scripts of redi more than once` and disabled the formula
  plugins). `<CasualSheets>` registers the formula engine + sheets-formula +
  numfmt and computes on the main thread.
- **New `CasualSheetsAPI` imperative ref** handed to the host via
  `onReady(api)` — the SDK's stable integration surface:
  `getSnapshot()`, `loadSnapshot(data)`, `getSelection()`,
  `executeCommand(id, params?)`, and `api.univer` (the FUniver escape hatch,
  not covered by semver). `createCasualSheetsAPI` and the `CasualSheetsAPI` /
  `RangeRef` types are exported from `@casualoffice/sheets/sheets`.

**Breaking:** `onReady` now receives a single `CasualSheetsAPI` argument
instead of `(api: FUniver, univer: Univer)`. Migrate `onReady={(api) => …}`
calls that used FUniver methods to `api.univer.<method>` (or the new
first-class API methods where they exist, e.g. `api.executeCommand`).

Deferred to follow-up batches: `importXlsx`/`exportXlsx` (xlsx-I/O batch),
`setTheme` (runtime theme switch), `attachCollab` (collab adapter phase).
