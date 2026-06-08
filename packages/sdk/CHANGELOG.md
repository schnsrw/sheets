# @schnsrw/casual-sheets

## 0.3.0

### Minor Changes

- 73e693f: Ships `CasualSheets` — a React wrapper around Univer Sheets. Mounts a
  workbook from `initialData`, boots the eager plugin set (render +
  formula engine + UI + docs + sheets + sheets-ui + sheets-formula +
  numfmt), and surfaces the `FUniver` API to the host via `onReady`.
  Hosts (Casual Drive in particular) can now `import { CasualSheets }
from '@schnsrw/casual-sheets/sheets'` and drop in a working
  spreadsheet view without re-implementing the boot dance.

  Lazy plugins (CF, drawings, sort, filter, hyperlinks, tables,
  comments, find/replace), the formula web worker, snapshot swap, and
  facade extensions stay app concerns — hosts layer them on top of
  `FUniver` after `onReady`.

  Also adds `./styles` (`import '@schnsrw/casual-sheets/styles'`) as a
  side-effect entry that brings in the eager plugin CSS in one line.

  Univer 0.24.x packages move to peer dependencies (all optional, all
  declared in `peerDependenciesMeta`).

## 0.2.0

### Minor Changes

- 06a5f3a: Initial release: `@schnsrw/casual-sheets` SDK shipping the signing pipeline
  (drawn / typed / uploaded signature surfaces, sequential / concurrent modes)
  and the iframe postMessage protocol (`EmbedTransport`, `casual.*` envelope
  types). Wire shapes are byte-identical to `@schnsrw/docx-js-editor` — only
  the `app` discriminator (`'sheet'` vs `'docs'`) and signature anchor shape
  (`{ kind: 'sheet', sheet, cell }` vs `{ kind: 'doc', paraId }`) differ. The
  Univer-Sheets React wrapper (`CasualSheets` component) is planned for a
  follow-up release.
