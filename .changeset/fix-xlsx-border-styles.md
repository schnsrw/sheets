---
'@casualoffice/sheets': patch
---

Preserve Excel border line styles on xlsx import/export. The style mapping previously hardcoded every border to a thin line, so dashed, double, thick, medium, hair, dotted, and the dash-dot variants all collapsed to thin on open — and again on save. Borders now map both directions between Excel's line styles and Univer's `BorderStyleTypes`, so the full set survives the round-trip (unrecognized styles still fall back to thin so a border is never dropped).
