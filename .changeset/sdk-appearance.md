---
"@casualoffice/sheets": minor
---

`<CasualSheets appearance="light" | "dark">` — reactive light/dark mode.

Flipping it re-themes the live editor via Univer's `ThemeService.setDarkMode`
(canvas colours, notifications, and Univer's `univer-dark` class). Distinct from
the existing `theme` prop, which sets the Univer colour-theme object. Defaults to
light. Note: Univer applies its dark CSS class to the document root, so dark mode
is page-global by Univer's design.
