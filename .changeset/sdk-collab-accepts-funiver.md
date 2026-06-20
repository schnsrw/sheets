---
'@casualoffice/sheets': minor
---

feat(collab): `attachCollab` accepts the bare `FUniver` facade, not just `CasualSheetsAPI`

The first argument is now `CollabAttachable = CasualSheetsAPI | FUniver`. Collab
only needs the facade, so a host that holds the raw `FUniver` (e.g. via Univer's
own bootstrap) can attach without first wrapping it in a `CasualSheetsAPI`.
Existing `attachCollab(api, …)` calls are unaffected.
