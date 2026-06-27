---
'@sheet/web': patch
---

Fix File → Open overwriting the previously-open file in the desktop app. Opening a file in-window replaced the workbook but left the bridge bound to the old file path, so the next Save wrote the newly-opened content over it. Open now unbinds the path so Save prompts for a location.
