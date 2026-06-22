---
'@sheet/web': minor
---

Add **Protect (read-only)** toggle (Data menu). Locks the workbook so edits are blocked, reusing the SDK's `applyReadOnly` engine (command veto + permission flip); toggling again lifts protection. Closes a gap vs OnlyOffice + Google Sheets (sheet/range protection).
