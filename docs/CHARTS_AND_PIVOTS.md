# Charts + Pivots — v0.1.1 design

The plan for shipping Excel-similar charts and pivot tables on top of
Univer OSS without forking (per [`CLAUDE.md`](../CLAUDE.md)). Charts
and pivots are both Univer Pro features; this doc lays out how we
build them on the OSS surface, what the per-feature scope is for
v0.1.1, and what we explicitly defer.

Companion to [`docs/LARGE_FILE_PIPELINE.md`](./LARGE_FILE_PIPELINE.md)
and [`PLAN.md`](../PLAN.md).

---

## Goal

A user opening Casual Sheets v0.1.1 should be able to:

- Select a range → Insert → Chart → see a column/bar/line/pie/scatter/area chart appear, anchored to a cell range. Move it, resize it, double-click to change type, change source range. Round-trips to xlsx (best-effort) and across collab peers.
- Select a range → Insert → Pivot Table → see a drag-fields panel; drag column headers into Rows / Columns / Values / Filters; pick Sum / Count / Avg / Min / Max per value field; output cells materialize on a new sheet or below the source. Refresh button re-aggregates when the source changes.

That bar is "useful Excel", not "Excel-complete". The scope cuts below.

---

## How Univer OSS lets us do this without forking

Discovery: Univer's `DrawingTypeEnum` (`vendor/univer/packages/core/src/types/interfaces/i-drawing.ts:46`) already reserves slots for things the OSS UI doesn't implement:

| Enum value | OSS UI? | What it gives us |
|---|---|---|
| `DRAWING_IMAGE = 0` | ✅ done | Existing image insert / move / resize |
| `DRAWING_CHART = 2` | ❌ reserved | Position, transform, persistence — UI is ours to build |
| `DRAWING_DOM = 8` | ✅ partial | Anchor an HTML/React node to a cell range with `SheetCanvasPopManagerService.attachPopupToCell` (`apps/web/src/.../sheets-ui` exposes this) |

That means **charts can be implemented as Univer "drawing" objects whose render is a DOM overlay containing the chart library's canvas**. We get for free:

- Range-anchored positioning (chart moves when rows/cols insert/delete).
- Move + resize handles via Univer's existing transform system.
- Save/load via `data.resources` (custom plugin resource key).
- Collab — every drawing mutation already flows through Univer's command bus, so our op-log bridge picks it up unchanged.

Pivots don't need drawing infra at all — they're a data transform that writes back into the same workbook as regular cells.

---

## Charts — design

### Renderer choice: ECharts

| Lib | License | Why pick / not pick |
|---|---|---|
| **Apache ECharts** | Apache-2.0 | Comprehensive chart types out of the box; canvas + SVG; battle-tested at scale; the de facto open-source choice. Tree-shakable so we ship only the types we use. **Picked.** |
| Recharts | MIT | React-first, but SVG-only (slower for big series) and missing chart types we'd need (scatter quirks, area variants). |
| Chart.js | MIT | Smaller bundle, simpler API, but the type ecosystem is less rich and react-chartjs-2 is an extra dep. |
| D3 (raw) | BSD-3 | We'd write everything ourselves. Months of work. Pass. |
| Univer chart | — | Doesn't exist in OSS. Building from scratch on `engine-render` would be months. |

**ECharts**, registered piecewise (e.g. `import { ColumnChart, LineChart } from 'echarts/charts'`) so the lazy-plugins infra ships only the chart types currently in the bundle.

### Data flow

```
                ┌─────────────────────────┐
                │ Insert > Chart command  │
                └────────────┬────────────┘
                             ▼
                ┌─────────────────────────┐
                │ ChartInsertDialog       │  ← React modal
                │ (range + type picker)   │
                └────────────┬────────────┘
                             ▼
                ┌─────────────────────────┐
                │ ChartModel              │  ← workbook.resources['CASUAL_CHARTS']
                │ { id, sheetId, range,  │
                │   type, options }       │
                └────────────┬────────────┘
                             ▼
                ┌─────────────────────────┐
                │ Drawing (DRAWING_CHART) │  ← Univer drawing model
                │ position + transform    │
                └────────────┬────────────┘
                             ▼
                ┌─────────────────────────┐
                │ ChartOverlay (React)    │  ← DOM portal anchored to drawing
                │ + ECharts instance      │
                └─────────────────────────┘
```

When source data changes (cell mutation in the bound range), the
overlay re-reads + re-renders. We listen via `api.addEvent(api.Event.SheetValueChanged, …)`
with a per-chart debounce so an arrow-key drag through a 1000-cell
range doesn't trigger 1000 chart re-renders.

### Persistence

- **Snapshot side**: a new `CASUAL_CHARTS` resource on `IWorkbookData.resources` holds the chart model array. Round-trips via our existing hidden-`__casual_sheets_resources__` sheet mechanism, so it survives xlsx save/load. (xlsx native chart format is out of scope — see "Explicitly skipped" below.)
- **Drawing side**: a `DRAWING_CHART` entry in the drawing model holds position + transform. Univer's drawing plugin already round-trips this.

### Excel-similar UX scope for v0.1.1

| Type | In | Out |
|---|---|---|
| Column / Bar | ✅ | — |
| Line / Area | ✅ | — |
| Pie / Doughnut | ✅ | — |
| Scatter | ✅ | — |
| Combo (column + line) | ✅ | — |
| Stacked / 100% stacked | ✅ | — |
| Histogram / Box / Waterfall | — | v0.2 |
| Trendlines, error bars | — | v0.2 |
| Sparklines (in-cell) | — | v0.2 — different infra (no drawing) |
| 3D charts | — | Excel deprecated them too; skip |

| Editing | In | Out |
|---|---|---|
| Double-click → change type | ✅ | — |
| Drag handles → resize | ✅ via drawing | — |
| Click + drag → move | ✅ via drawing | — |
| Change source range | ✅ — small dialog | — |
| Title / axis label / legend toggle | ✅ — sidebar | — |
| Per-series color | ✅ | — |
| Custom fonts / advanced formatting | — | v0.2 — Excel's format pane is huge |
| Animation, transitions | — | not Excel-similar; skip |

### Bundle impact

ECharts core + the listed chart types ~ 250 KB gzipped. Ships as its own lazy chunk via `lazy-plugins.ts` so the initial 6.3 MB main bundle doesn't grow. Loaded on first Insert > Chart or when a workbook's snapshot references a chart.

---

## Pivots — design

### Data model

Pure JS; no drawing, no overlay.

```ts
type PivotTable = {
  id: string;
  sheetId: string;
  sourceRange: IRange;        // e.g. rows 1..1000, cols A..F
  targetSheetId: string;
  targetAnchor: ICell;        // top-left where the output is written

  rows:    PivotField[];      // grouped row dimensions
  columns: PivotField[];      // grouped column dimensions
  values:  PivotValueField[]; // { fieldName, aggregator: 'sum'|'count'|'avg'|'min'|'max' }
  filters: PivotField[];      // not-yet-implemented v0.1.1 — see scope below
};

type PivotField = { name: string; sourceColIndex: number };
type PivotValueField = PivotField & { aggregator: 'sum'|'count'|'avg'|'min'|'max'|'product' };
```

### Algorithm

Single pass over source rows:

```
for each row in sourceRange:
    rowKey   = tuple of row-field values
    colKey   = tuple of column-field values
    cell[(rowKey, colKey)][valueField] += aggregator(row[valueField.sourceColIndex])
```

Output written as a normal cell range — header rows for column groups + grand totals, label column for row groups, cells for aggregated values. Uses the existing `setRangeValues` mutation, so it round-trips through xlsx and collab automatically.

### UX

- **Side panel** ("Pivot fields") opens when the user is on a pivot output range. Three drop zones: Rows / Columns / Values. Drag column headers from a list into a zone to add. Click an active value field to change aggregator.
- **Source range badge** at the top of the panel — click to re-open the source range picker.
- **Refresh button** — re-runs the aggregation against the current source range. Manual; auto-refresh on every source edit is v0.2 (could be expensive on big sources).
- **Move pivot** — delete + re-insert from a different anchor. No move-in-place for v0.1.1 (would require a custom mutation pair).

### Excel-similar UX scope for v0.1.1

| Pivot capability | In | Out |
|---|---|---|
| Rows / Columns / Values drop zones | ✅ | — |
| Aggregators: Sum / Count / Avg / Min / Max / Product | ✅ | — |
| Multiple value fields | ✅ | — |
| Multi-level rows / columns (nested grouping) | ✅ | — |
| Manual Refresh | ✅ | — |
| Grand totals row + column | ✅ | — |
| Subtotals per group | ✅ — collapsible (uses outline plugin) | — |
| Filters drop zone | — | v0.2 |
| Slicer UI | — | v0.2 |
| Calculated fields | — | v0.2 |
| GETPIVOTDATA() formula | — | v0.2 — needs custom function in formula engine |
| Auto-refresh on source edit | — | v0.2 — opt-in toggle |
| Pivot from external source (CSV upload, etc.) | — | not in scope |

### Persistence

`CASUAL_PIVOTS` resource on `IWorkbookData.resources` holds the pivot definitions. Output cells are normal cell data so they survive xlsx save/load even when the reader doesn't know about pivots — opening such an xlsx in Excel will show the values but not let you re-pivot. Acceptable trade-off; native xlsx pivot table format is multi-hundred-line XML + a separate pivot cache file (`xl/pivotTables/`, `xl/pivotCache/`) and writing that is a v0.2 ambition.

### Bundle impact

~ 20 KB for the aggregation logic + the side-panel React tree. Ships in the lazy `pivot` chunk.

---

## What we explicitly skip in v0.1.1

To keep the release in weeks, not months:

- **Native xlsx chart format**. Excel charts in `.xlsx` are stored under `xl/charts/chart1.xml` with their own schema. Round-tripping them means parsing + emitting that on top of ExcelJS (which has basic chart support but is incomplete). We ship our charts in our own resource key — opening an `xlsx` Excel created in Excel will show the data range but not the chart drawing. Acceptable; the in-app experience is the primary use case.
- **Native xlsx pivot format**. Same story — `xl/pivotTables/` + `xl/pivotCache/` is a non-trivial codec. Out of scope.
- **Excel's chart format pane** (the 30-tab right sidebar). We ship a small "Chart options" panel covering title / axis labels / legend / colors. Everything else is v0.2.
- **Slicers, timeline filters, calculated fields, GETPIVOTDATA()** — every one of these is a feature of its own.
- **Pivot from external data sources** — file upload to pivot is outside our scope.

---

## Phased implementation

Each phase ends with a green CI run and demo-able UI; nothing ships half-built.

| Phase | Days | Output |
|---|---|---|
| **Charts P0** — ECharts plumbing | 2 | `lazy-plugins.ts` group `charts`; bare overlay anchored to a hardcoded range renders a column chart |
| **Charts P1** — insert flow | 3 | Insert → Chart command + dialog (range + type), `ChartModel` + resource persistence |
| **Charts P2** — Univer drawing integration | 3 | Move + resize via drawing handles; source-range badge + change-source dialog |
| **Charts P3** — type catalog | 2 | Column / Bar / Line / Area / Pie / Scatter / Combo / Stacked / 100% stacked |
| **Charts P4** — options panel | 3 | Title / axis labels / legend / per-series color; double-click → edit |
| **Charts P5** — collab + xlsx | 2 | Chart drawings sync via existing op-log; resource key round-trips |
| | **15 days** | **Charts MVP complete** |
| **Pivot P0** — data model + aggregator | 2 | Pure-fn `aggregate(source, rows, cols, values)` with the 6 aggregators, unit tested |
| **Pivot P1** — output renderer | 2 | Write aggregated result back into cells via `setRangeValues`; grand totals |
| **Pivot P2** — side panel UI | 4 | Drag-fields panel; field list from source headers; per-value-field aggregator picker; Refresh button |
| **Pivot P3** — subtotals + collapse | 2 | Per-group subtotal rows; integrate with outline plugin so users can collapse |
| **Pivot P4** — persistence | 2 | `CASUAL_PIVOTS` resource; round-trip; collab |
| | **12 days** | **Pivot MVP complete** |
| **Polish + e2e** | 3 | Specs locking in chart + pivot round-trips; README update; release notes |
| **Total** | **30 working days (~6 weeks calendar)** | v0.1.1 ready |

Risk-adjusted: budget **8 weeks** end-to-end. The biggest unknowns are
ECharts ↔ Univer drawing integration (no precedent in their codebase) and
pivot subtotal layout. Both have backout paths — chart can fall back to
a fixed inline overlay; pivot subtotals can ship as a v0.2.

---

## Open questions for sign-off

1. **ECharts vs. Recharts** — ECharts is my pick for breadth + perf. Any concern with adding it (Apache-2.0)?
2. **Pivot output location** — Excel offers "New worksheet" vs. "Existing worksheet at cell". Default to the latter (less surprising); offer both?
3. **Refresh policy** — manual button only for v0.1.1? (Auto-refresh on source edit can be a per-pivot opt-in checkbox.)
4. **Chart-types cut** — comfortable shipping without histograms / waterfalls / box plots in v0.1.1? Those are useful but each is a separate ECharts type.
5. **Excel-format-on-save** — confirm we ship charts/pivots in our custom resource key only (Excel sees the cell values but not the chart drawing / pivot UI). Native xlsx encoding deferred to v0.2.

Once these are decided I start on Charts P0.
