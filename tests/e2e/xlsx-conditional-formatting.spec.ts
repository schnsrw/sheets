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
