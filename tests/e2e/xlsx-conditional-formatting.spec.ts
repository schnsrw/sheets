import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { waitForUniver } from './_helpers';

/**
 * Conditional-formatting fidelity. Highlight-cell rules (cellIs numeric
 * comparisons + expression/formula rules, with a fill/font style) were dropped
 * on import. They now bridge to Univer's `SHEET_CONDITIONAL_FORMATTING_PLUGIN`
 * resource and survive a full xlsx round-trip.
 */
declare global {
  interface Window {
    __xlsx?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      xlsxToWorkbookData: (buf: ArrayBuffer) => Promise<any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workbookDataToXlsx: (data: any) => Promise<Blob>;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __composeCfStyle__?: (row: number, col: number) => any;
  }
}

const CF_RESOURCE = 'SHEET_CONDITIONAL_FORMATTING_PLUGIN';

test('conditional formatting highlight rules survive import + round-trip', async ({ page }) => {
  test.setTimeout(60_000);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  for (let r = 1; r <= 5; r++) ws.getCell(`A${r}`).value = r * 50;
  // cellIs: A1:A5 > 100 → red fill.
  ws.addConditionalFormatting({
    ref: 'A1:A5',
    rules: [
      {
        type: 'cellIs',
        operator: 'greaterThan',
        formulae: ['100'],
        priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFF0000' } } },
      },
    ],
  });
  // expression: B1:B5 formula rule → bold.
  ws.addConditionalFormatting({
    ref: 'B1:B5',
    rules: [
      {
        type: 'expression',
        formulae: ['MOD(ROW(),2)=0'],
        priority: 1,
        style: { font: { bold: true } },
      },
    ],
  });
  const bytes = Array.from(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer));

  await page.goto('/');
  await waitForUniver(page);

  const out = await page.evaluate(
    async ({ buf, resKey }: { buf: number[]; resKey: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const xlsx = await import(/* @vite-ignore */ '/src/xlsx/index.ts' as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rulesOf = (data: any) => {
        const entry = (data.resources ?? []).find((r: { name: string }) => r.name === resKey);
        if (!entry?.data) return [];
        const parsed = JSON.parse(entry.data);
        const sid = Object.keys(parsed)[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (parsed[sid] ?? []).map((x: any) => ({
          subType: x.rule?.subType,
          operator: x.rule?.operator,
          value: x.rule?.value,
          bg: x.rule?.style?.bg?.rgb ?? null,
          bold: x.rule?.style?.bl ?? null,
        }));
      };
      const imported = await xlsx.xlsxToWorkbookData(new Uint8Array(buf).buffer);
      const blob = await xlsx.workbookDataToXlsx(imported);
      const round = await xlsx.xlsxToWorkbookData(await blob.arrayBuffer());
      return { imported: rulesOf(imported), round: rulesOf(round) };
    },
    { buf: bytes, resKey: CF_RESOURCE },
  );

  const expected = [
    { subType: 'number', operator: 'greaterThan', value: 100, bg: '#ff0000', bold: null },
    { subType: 'formula', operator: undefined, value: 'MOD(ROW(),2)=0', bg: null, bold: 1 },
  ];
  expect(out.imported).toEqual(expected);
  expect(out.round).toEqual(expected);
});

/**
 * Render-on-import: a rule that round-trips in the resource is not enough — it
 * must actually MATCH + PAINT when the file opens. The CF number-rule evaluator
 * keys off the cell's `t` (CellValueType) directly, so an imported numeric cell
 * that lacked `t` never matched a `cellIs` rule — the highlight stayed blank no
 * matter how long you waited or how much you scrolled. parse-impl now tags
 * imported cells with their value type. We read the result through the CF
 * service's `composeStyle` (the highlight is canvas-drawn, not in cell data),
 * asserting a matching cell composes the red fill while a non-matching cell
 * composes nothing — immediately on open, without any interaction.
 */
test('imported conditional formatting paints on open without interaction', async ({ page }) => {
  test.setTimeout(60_000);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  // A1..A5 = 50,100,150,200,250 → only A3:A5 (>100) should highlight.
  for (let r = 1; r <= 5; r++) ws.getCell(`A${r}`).value = r * 50;
  ws.addConditionalFormatting({
    ref: 'A1:A5',
    rules: [
      {
        type: 'cellIs',
        operator: 'greaterThan',
        formulae: ['100'],
        priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFF0000' } } },
      },
    ],
  });
  const bytes = Array.from(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer));

  await page.goto('/');
  await waitForUniver(page);

  // Write the fixture and open it through the real File → Open picker so the
  // workbook-swap path (UniverSheet revision effect) runs, exactly as a user's
  // open would.
  const fixture = '/tmp/casual-sheets-cf-render.xlsx';
  const fs = await import('node:fs');
  fs.writeFileSync(fixture, Buffer.from(bytes));

  await page.getByTestId('menubar-file').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId('menu-item-open').click(),
  ]);
  await chooser.setFiles(fixture);

  // The matching cell A5 (row 4, col 0, value 250 > 100) must compose the red
  // fill — poll because the CF recompute the pump triggers is async, but assert
  // WITHOUT any scroll/click that would itself force a recompute.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s = window.__composeCfStyle__?.(4, 0);
          return (s?.style?.bg?.rgb ?? null) as string | null;
        }),
      { timeout: 10_000, message: 'A5 should compose the imported red CF fill on open' },
    )
    .toBe('#ff0000');

  // The non-matching cell A1 (row 0, col 0, value 50) composes no CF style.
  const a1 = await page.evaluate(() => {
    const s = window.__composeCfStyle__?.(0, 0);
    return s?.style?.bg?.rgb ?? null;
  });
  expect(a1).toBeNull();
});
