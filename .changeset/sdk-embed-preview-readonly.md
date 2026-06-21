---
'@casualoffice/sheets': patch
---

Embed runtime `viewMode="preview"` is now genuinely READ-ONLY. Previously preview only hid the chrome (toolbar/menu) — Univer's cell editor still opened on double-click/F2, so a host's "preview" was editable.

`applyReadOnly(univerApi, unitId, onBlock?)` now vetoes mutating commands via `beforeCommandExecuted` (throwing `CustomCommandExecutionError`, which the command service cancels cleanly). This is the load-bearing layer: the iframe's minimal plugin set does **not** enforce `WorkbookEditablePermission` (the editor still accepts edits with it flipped off), so the veto — not the permission — is what stops typing, paste, styling and structural edits. The permission flip is kept as a second layer for full `<CasualSheets>` hosts (greys out mutating menu items). The optional `onBlock(commandId)` callback lets hosts react to a blocked edit (e.g. a "read-only" toast).

Applied in a `requestAnimationFrame` after `onReady` so it wins the race against Univer's post-mount permission init. Editor mode is unchanged. Also exposes `getEditable(univerApi, unitId)` and an `__casualEmbedApi` debug handle on the iframe window for host/e2e introspection.
