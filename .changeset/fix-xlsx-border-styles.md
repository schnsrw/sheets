---
'@casualoffice/sheets': patch
---

Improve xlsx style fidelity for Excel users. Three formatting properties that were dropped on import/export now round-trip:

- **Border line styles** — the mapping hardcoded every border to thin, so dashed, double, thick, medium, hair, dotted, and the dash-dot variants all collapsed to a thin line. They now map both directions between Excel's line styles and Univer's `BorderStyleTypes` (unrecognized styles still fall back to thin so a border is never dropped).
- **Strikethrough** — `font.strike` now maps to/from Univer's `st`.
- **Text rotation** — angled and stacked (`vertical`) cell text now maps to/from Univer's `tr`, preserving the angle and direction.
