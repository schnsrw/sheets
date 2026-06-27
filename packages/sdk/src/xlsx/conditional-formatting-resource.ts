import type ExcelJS from 'exceljs';
import type { IRange, IWorkbookData } from '@univerjs/core';

/**
 * xlsx-native `worksheet.conditionalFormattings` ⇄ Univer
 * `SHEET_CONDITIONAL_FORMATTING_PLUGIN` resource bridge.
 *
 * Conditional-formatting rules live inline in `xl/worksheets/sheetN.xml`
 * (`<conditionalFormatting>`); ExcelJS surfaces them as
 * `worksheet.conditionalFormattings` (`[{ ref, rules }]`). Univer's CF plugin
 * keeps them in a resource keyed by sheet id under the name below (serialized as
 * `{ [sheetId]: IConditionFormattingRule[] }`, see the fork's
 * conditional-formatting.service.ts `toJson`). We mirror in both directions so a
 * file authored in real Excel keeps its highlight rules when opened here, and our
 * save round-trip preserves them.
 *
 * Scope: **highlight-cell** rules — `cellIs` (numeric comparisons) and
 * `expression` (formula) — with the rule's fill / font style. Visual rule types
 * (colorScale, dataBar, iconSet) and text/timePeriod operators are not mapped
 * yet; unmapped rules are skipped, never corrupted.
 */

export const CONDITIONAL_FORMATTING_RESOURCE = 'SHEET_CONDITIONAL_FORMATTING_PLUGIN';

// Numeric comparison operators shared verbatim between ExcelJS `cellIs` and
// Univer's CFNumberOperator (same string values).
const NUMBER_OPERATORS = new Set([
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'between',
  'notBetween',
  'equal',
  'notEqual',
]);

interface CfStyle {
  bg?: { rgb: string };
  cl?: { rgb: string };
  bl?: number;
  it?: number;
  st?: { s: number };
}

interface SynthCfRule {
  cfId: string;
  ranges: IRange[];
  stopIfTrue: boolean;
  // `rule` mirrors Univer's IHighlightCell (number/formula subtypes only here).
  rule: {
    type: 'highlightCell';
    subType: 'number' | 'formula';
    operator?: string;
    value?: number | [number, number] | string;
    style: CfStyle;
  };
}

function lettersToCol(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
  return col - 1;
}

function colToLetters(n: number): string {
  let out = '';
  let v = n;
  while (v >= 0) {
    out = String.fromCharCode(65 + (v % 26)) + out;
    v = Math.floor(v / 26) - 1;
  }
  return out;
}

function rangeStrToIRange(s: string): IRange | null {
  const part = s.includes('!') ? (s.split('!').pop() ?? s) : s;
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(part.trim());
  if (!m) return null;
  const c0 = lettersToCol(m[1]);
  const r0 = Number(m[2]) - 1;
  const c1 = m[3] ? lettersToCol(m[3]) : c0;
  const r1 = m[4] ? Number(m[4]) - 1 : r0;
  return { startRow: r0, endRow: r1, startColumn: c0, endColumn: c1 };
}

function iRangeToStr(r: IRange): string {
  const a = `${colToLetters(r.startColumn)}${r.startRow + 1}`;
  const b = `${colToLetters(r.endColumn)}${r.endRow + 1}`;
  return a === b ? a : `${a}:${b}`;
}

function normalizeArgb(argb: string | undefined): string | undefined {
  if (typeof argb !== 'string') return undefined;
  const hex = /^#?([0-9A-Fa-f]{6,8})$/.exec(argb)?.[1];
  if (!hex) return undefined;
  return `#${(hex.length === 8 ? hex.slice(2) : hex).toLowerCase()}`;
}

function toArgb(rgb: string | undefined): string | undefined {
  if (typeof rgb !== 'string') return undefined;
  const hex = /^#?([0-9A-Fa-f]{6,8})$/.exec(rgb)?.[1];
  if (!hex) return undefined;
  return (hex.length === 8 ? hex : `FF${hex}`).toUpperCase();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dxfToCfStyle(style: any): CfStyle {
  const out: CfStyle = {};
  // CF differential fills carry the highlight colour in bgColor (the OOXML
  // dxf patternFill convention); fall back to fgColor just in case.
  const bg = normalizeArgb(style?.fill?.bgColor?.argb) ?? normalizeArgb(style?.fill?.fgColor?.argb);
  if (bg) out.bg = { rgb: bg };
  const cl = normalizeArgb(style?.font?.color?.argb);
  if (cl) out.cl = { rgb: cl };
  if (style?.font?.bold) out.bl = 1;
  if (style?.font?.italic) out.it = 1;
  if (style?.font?.strike) out.st = { s: 1 };
  return out;
}

function cfStyleToDxf(style: CfStyle): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const font: Record<string, unknown> = {};
  if (style.bl === 1) font.bold = true;
  if (style.it === 1) font.italic = true;
  if (style.st?.s === 1) font.strike = true;
  const cl = toArgb(style.cl?.rgb);
  if (cl) font.color = { argb: cl };
  if (Object.keys(font).length) out.font = font;
  const bg = toArgb(style.bg?.rgb);
  if (bg)
    out.fill = { type: 'pattern', pattern: 'solid', bgColor: { argb: bg }, fgColor: { argb: bg } };
  return out;
}

/** Lift every worksheet's conditional formatting into the synthesised plugin shape. */
export function readConditionalFormattingFromXlsx(
  wb: ExcelJS.Workbook,
  sheetIdForExcel: (excelId: number) => string,
): Record<string, SynthCfRule[]> {
  const out: Record<string, SynthCfRule[]> = {};
  let seq = 0;
  for (const ws of wb.worksheets) {
    const cfs = (ws as unknown as { conditionalFormattings?: unknown }).conditionalFormattings;
    if (!Array.isArray(cfs)) continue;

    const rules: SynthCfRule[] = [];
    for (const cf of cfs) {
      const ref = (cf as { ref?: string }).ref;
      const cfRules = (cf as { rules?: unknown[] }).rules;
      if (typeof ref !== 'string' || !Array.isArray(cfRules)) continue;
      const ranges: IRange[] = [];
      for (const piece of ref.split(/[\s,]+/)) {
        const r = rangeStrToIRange(piece);
        if (r) ranges.push(r);
      }
      if (ranges.length === 0) continue;

      for (const raw of cfRules) {
        const r = raw as {
          type?: string;
          operator?: string;
          formulae?: unknown[];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          style?: any;
        };
        const style = dxfToCfStyle(r.style);
        const formulae = Array.isArray(r.formulae) ? r.formulae : [];
        if (
          r.type === 'cellIs' &&
          typeof r.operator === 'string' &&
          NUMBER_OPERATORS.has(r.operator)
        ) {
          const n0 = Number(formulae[0]);
          if (Number.isNaN(n0)) continue; // non-numeric cellIs — not a number rule
          const between = r.operator === 'between' || r.operator === 'notBetween';
          const n1 = Number(formulae[1]);
          if (between && Number.isNaN(n1)) continue;
          rules.push({
            cfId: `cf-${seq++}`,
            ranges,
            stopIfTrue: false,
            rule: {
              type: 'highlightCell',
              subType: 'number',
              operator: r.operator,
              value: between ? [n0, n1] : n0,
              style,
            },
          });
        } else if (r.type === 'expression' && typeof formulae[0] === 'string') {
          rules.push({
            cfId: `cf-${seq++}`,
            ranges,
            stopIfTrue: false,
            rule: { type: 'highlightCell', subType: 'formula', value: formulae[0], style },
          });
        }
        // Other rule types (colorScale / dataBar / iconSet / text / timePeriod)
        // are intentionally skipped until they're mapped.
      }
    }
    if (rules.length > 0) out[sheetIdForExcel(ws.id)] = rules;
  }
  return out;
}

/** Merge a synthesised CF map into the workbook's `resources` array. */
export function mergeConditionalFormattingIntoResources(
  resources: IWorkbookData['resources'],
  payload: Record<string, SynthCfRule[]>,
): IWorkbookData['resources'] {
  if (Object.keys(payload).length === 0) return resources;
  // Prefer an existing plugin resource (came through Univer's live model with
  // the full rule shape) over our xlsx-derived subset.
  const existing = resources?.find((r) => r.name === CONDITIONAL_FORMATTING_RESOURCE);
  if (existing) return resources;
  const next = [...(resources ?? [])];
  next.push({ name: CONDITIONAL_FORMATTING_RESOURCE, data: JSON.stringify(payload) });
  return next;
}

/** Read the CF resource off a snapshot, keeping only number/formula highlight
 *  rules (the shapes we can export). Tolerant of missing/foreign payloads. */
export function readConditionalFormattingFromSnapshot(
  data: IWorkbookData,
): Record<string, SynthCfRule[]> {
  const entry = data.resources?.find((r) => r.name === CONDITIONAL_FORMATTING_RESOURCE);
  if (!entry?.data) return {};
  try {
    const parsed = JSON.parse(entry.data) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, SynthCfRule[]> = {};
    for (const [sheetId, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      const bucket: SynthCfRule[] = [];
      for (const item of value) {
        const obj = item as SynthCfRule;
        if (
          obj &&
          Array.isArray(obj.ranges) &&
          obj.rule?.type === 'highlightCell' &&
          (obj.rule.subType === 'number' || obj.rule.subType === 'formula')
        ) {
          bucket.push(obj);
        }
      }
      if (bucket.length > 0) out[sheetId] = bucket;
    }
    return out;
  } catch {
    return {};
  }
}

/** Apply a per-sheet CF rule set onto an ExcelJS worksheet. */
export function applyConditionalFormattingToXlsxWorksheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any,
  rules: SynthCfRule[],
): void {
  if (!rules?.length) return;
  rules.forEach((entry, i) => {
    const ref = entry.ranges.map(iRangeToStr).join(' ');
    if (!ref) return;
    const style = cfStyleToDxf(entry.rule.style);
    let exceljsRule: Record<string, unknown> | null = null;
    if (entry.rule.subType === 'number') {
      const v = entry.rule.value;
      const formulae = Array.isArray(v) ? v.map(String) : [String(v)];
      exceljsRule = {
        type: 'cellIs',
        operator: entry.rule.operator,
        formulae,
        priority: i + 1,
        style,
      };
    } else if (entry.rule.subType === 'formula') {
      exceljsRule = {
        type: 'expression',
        formulae: [String(entry.rule.value)],
        priority: i + 1,
        style,
      };
    }
    if (!exceljsRule) return;
    try {
      ws.addConditionalFormatting({ ref, rules: [exceljsRule] });
    } catch {
      // A malformed rule shouldn't kill the export; drop it quietly.
    }
  });
}
