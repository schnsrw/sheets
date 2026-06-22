/**
 * PDF export — "Download as PDF" (File menu). Renders the active sheet's used
 * range as a real vector table via jsPDF + jspdf-autotable: searchable text,
 * auto-paginated across A4 pages, with column letters + row numbers and a
 * title. Values come from the workbook snapshot (same `.v` the print path uses);
 * rich per-cell styling (fonts/fills/borders) is a follow-up — this ships the
 * MUST-have one-click PDF that OnlyOffice/Google Sheets have and we lacked.
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { FUniver } from '@univerjs/core/facade';
import { saveWorkbook } from '../univer-facade';

export type PdfResult = { ok: true } | { ok: false; reason: 'empty' };

/** 0-based column index → spreadsheet letter (0→A, 25→Z, 26→AA). */
function colLetter(n: number): string {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function cellText(v: unknown): string {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? v : String(v);
}

export function exportActiveSheetPdf(api: FUniver): PdfResult {
  const wb = api.getActiveWorkbook();
  const ws = wb?.getActiveSheet();
  if (!wb || !ws) return { ok: false, reason: 'empty' };

  const snap = saveWorkbook(wb);
  const sId = (ws as { getSheetId?: () => string }).getSheetId?.();
  const sheet = sId ? snap?.sheets?.[sId] : undefined;
  const cellData = (sheet?.cellData ?? {}) as Record<string, Record<string, { v?: unknown }>>;

  // Used range from populated cells.
  let maxRow = -1;
  let maxCol = -1;
  for (const rk of Object.keys(cellData)) {
    const row = cellData[rk];
    for (const ck of Object.keys(row)) {
      const v = row[ck]?.v;
      if (v === undefined || v === null || v === '') continue;
      const r = Number(rk);
      const c = Number(ck);
      if (r > maxRow) maxRow = r;
      if (c > maxCol) maxCol = c;
    }
  }
  if (maxRow < 0 || maxCol < 0) return { ok: false, reason: 'empty' };

  const head = [['', ...Array.from({ length: maxCol + 1 }, (_, c) => colLetter(c))]];
  const body: string[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    const cells: string[] = [String(r + 1)];
    const row = cellData[r] as Record<string, { v?: unknown }> | undefined;
    for (let c = 0; c <= maxCol; c++) cells.push(cellText(row?.[c]?.v));
    body.push(cells);
  }

  const wbName = (wb as { getName?: () => string }).getName?.() ?? 'Workbook';
  const sName = (ws as { getSheetName?: () => string }).getSheetName?.() ?? 'Sheet';

  // Wide sheets read better in landscape.
  const doc = new jsPDF({ orientation: maxCol > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text(`${wbName} — ${sName}`, 40, 36);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(new Date().toLocaleString(), 40, 50);
  doc.setTextColor(0);

  autoTable(doc, {
    head,
    body,
    startY: 62,
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak', lineColor: [203, 213, 225], lineWidth: 0.5 },
    headStyles: { fillColor: [241, 245, 249], textColor: 30, fontStyle: 'bold' },
    // Row-number gutter column.
    columnStyles: { 0: { fillColor: [241, 245, 249], textColor: 90, halign: 'right', cellWidth: 30 } },
    theme: 'grid',
    margin: { top: 62, left: 40, right: 40, bottom: 40 },
  });

  const file = `${wbName}-${sName}`.replace(/[^\w.-]+/g, '_');
  doc.save(`${file}.pdf`);
  return { ok: true };
}
