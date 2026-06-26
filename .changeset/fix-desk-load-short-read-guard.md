---
'@sheet/web': patch
---

Fail clearly when a desktop file is truncated or replaced mid-open. The chunked read sizes its buffer to `document_size`, so if the file shrinks between sizing and reading (another process truncates or replaces it — the same external edits the file watcher reports), the tail was left zero-padded and parsed as a baffling "corrupt spreadsheet". The bridge now detects the short read and throws a clear "the file changed while opening — try again" error instead of returning a silently-mangled buffer.
