---
'@casualoffice/sheets': patch
---

Tag imported xlsx cells with their value type (`t`). Univer's conditional-formatting number-rule evaluator reads a cell's `CellValueType` directly, so imported numeric cells — which previously carried only a value, no type — never matched a `cellIs` rule and their highlight fill stayed blank on open. Numeric, boolean, and string cells are now typed on import, so conditional-formatting highlight rules (and anything else that keys off `t`) evaluate and paint immediately, no interaction required.
