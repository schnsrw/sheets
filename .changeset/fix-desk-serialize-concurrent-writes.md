---
'@sheet/web': patch
---

Serialize desktop file writes so two overlapping saves can't corrupt the file. A fast double Ctrl+S — or a Ctrl+S issued while a large save is still streaming chunks — previously ran two `begin_save_document` / `write_save_chunk` / `commit_save_document` sequences concurrently against the same per-path temp file, which could interleave and produce a corrupt or truncated result. Writes now run through a chain so each save fully completes before the next begins; a failed save no longer wedges later ones, and its error still surfaces to the caller.
