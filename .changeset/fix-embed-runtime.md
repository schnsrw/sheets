---
'@casualoffice/sheets': patch
---

Fix the in-iframe embed runtime (the `<iframe>` embed path had never been integration-tested): it mounted `<CasualSheets>` without locales, so Univer's workbench never painted (blank grid / `LocaleService: Locale not initialized`), and `embed.html` linked an `embed-runtime.css` that tsup no longer emits (now inlined), causing a 404. The embed path now boots and round-trips load → edit → save end-to-end, demonstrated by the new `examples/embed-playground`.
