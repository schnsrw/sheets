---
'@sheet/web': patch
---

Retry the desktop external-change reload once on a transient failure. When another app saves the open file, the filesystem watcher often fires while the write is still in flight (an atomic save briefly truncates/replaces the file), so the first reload reads short and threw — previously swallowed, leaving the user on stale content. The reload now retries once after a short settle delay, by which point the external write has completed and the reload succeeds.
