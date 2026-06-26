---
'@sheet/web': patch
---

Fix a desktop open race where a workbook that parsed before Univer finished booting was dropped, leaving a blank grid still bound to the real file (a subsequent edit + save could then overwrite the original .xlsx with an empty workbook). The revision swap effect no longer advances its revision marker when the api isn't ready yet; it waits and re-applies the pending snapshot once the editor signals ready.
