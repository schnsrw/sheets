---
'@casualoffice/sheets': minor
---

`attachCollab` now accepts an optional `share` token (`{ token, password? }`) which is forwarded on the collab WebSocket as `?share=`/`?sp=` and suppresses the client-asserted `?role=` (the server becomes authoritative for the joiner's role). Backward-compatible: without a `share` token the connection URL is byte-identical to before. Underpins server-enforced share links (sharing-model §6.1).
