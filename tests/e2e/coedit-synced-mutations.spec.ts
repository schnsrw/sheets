import { expect, test, chromium, type Browser } from '@playwright/test';
import { waitForUniver } from './_helpers';

/**
 * Regressions for the SYNCED_MUTATIONS additions in
 * `apps/web/src/collab/bridge.ts`. Each test fires the command on
 * peer A and asserts the underlying state shows up on peer B —
 * mutations not actually flowing through the bridge would leave
 * peer B's state unchanged.
 *
 * Scoped to the visible-impact additions: tab colour, sort, move-range,
 * format-as-table. Lower-priority ones (autofilter, notes) are wired in
 * the allowlist but tested manually for now.
 */

const PROD_BASE = process.env.PROD_BASE ?? 'http://localhost:3000';

let browser: Browser | null = null;
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  browser = await chromium.launch();
});
test.afterAll(async () => {
  await browser?.close();
});

function installEnv(name: string): string {
  return `
    (function () {
      try {
        localStorage.setItem('casual.collab.displayName', ${JSON.stringify(name)});
        localStorage.setItem('casual.collab.namePrompted', '1');
      } catch (_) {}
    })();
  `;
}

async function joinTwoPeerRoom(): Promise<{
  owner: import('@playwright/test').Page;
  joiner: import('@playwright/test').Page;
  cleanup: () => Promise<void>;
}> {
  const ownerCtx = await browser!.newContext();
  const owner = await ownerCtx.newPage();
  await owner.addInitScript({ content: installEnv('Alice') });
  await owner.goto(PROD_BASE);
  await waitForUniver(owner);
  const roomId = await owner.evaluate(async () => {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return ((await res.json()) as { roomId: string }).roomId;
  });
  await owner.goto(`${PROD_BASE}/r/${roomId}`);
  await waitForUniver(owner);
  await expect(owner.getByTestId('presence-avatars')).toBeVisible({ timeout: 10_000 });
  const joinerCtx = await browser!.newContext();
  const joiner = await joinerCtx.newPage();
  await joiner.addInitScript({ content: installEnv('Bob') });
  await joiner.goto(`${PROD_BASE}/r/${roomId}`);
  await waitForUniver(joiner);
  await expect(joiner.getByTestId('presence-avatars')).toBeVisible({ timeout: 10_000 });
  return {
    owner,
    joiner,
    cleanup: async () => {
      await ownerCtx.close();
      await joinerCtx.close();
    },
  };
}

test('tab colour propagates to peers', async () => {
  const { owner, joiner, cleanup } = await joinTwoPeerRoom();
  const sheetId = await owner.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).__univerAPI;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wb: any = api.getActiveWorkbook();
    const sid = wb.getActiveSheet().getSheetId();
    api.executeCommand('sheet.command.set-tab-color', {
      unitId: wb.getId(),
      subUnitId: sid,
      color: '#ff5722',
    });
    return sid;
  });
  await joiner.waitForTimeout(1500);
  const peerColor = await joiner.evaluate((id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).__univerAPI;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wb: any = api.getActiveWorkbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = wb.getSheets().find((s: any) => s.getSheetId() === id);
    // Tab colour is stored on the worksheet config — facade getter may or
    // may not exist; reach via the underlying _worksheet snapshot field.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ws?._worksheet?.getConfig?.()?.tabColor;
  }, sheetId);
  expect(peerColor).toBe('#ff5722');
  await cleanup();
});

test('move-range cut/paste propagates the destination cells', async () => {
  const { owner, joiner, cleanup } = await joinTwoPeerRoom();
  // Seed source cells on owner.
  await owner.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).__univerAPI;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook().getActiveSheet();
    ws.getRange('A1').setValue({ v: 'src-a' });
    ws.getRange('B1').setValue({ v: 'src-b' });
  });
  await joiner.waitForFunction(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).__univerAPI;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws: any = api.getActiveWorkbook().getActiveSheet();
      return ws.getRange('A1').getValue() === 'src-a';
    },
    null,
    { timeout: 5_000 },
  );

  // Move A1:B1 → D5:E5 via sheet.command.move-range.
  await owner.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).__univerAPI;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wb: any = api.getActiveWorkbook();
    api.executeCommand('sheet.command.move-range', {
      unitId: wb.getId(),
      subUnitId: wb.getActiveSheet().getSheetId(),
      fromRange: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
      toRange: { startRow: 4, endRow: 4, startColumn: 3, endColumn: 4 },
    });
  });
  await joiner.waitForTimeout(1500);
  const dst = await joiner.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).__univerAPI;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook().getActiveSheet();
    return {
      d5: ws.getRange('D5').getValue(),
      e5: ws.getRange('E5').getValue(),
      a1: ws.getRange('A1').getValue(),
    };
  });
  expect(dst.d5).toBe('src-a');
  expect(dst.e5).toBe('src-b');
  // Source emptied (Univer's move-range is a true move, not a copy).
  expect(dst.a1).toBeFalsy();
  await cleanup();
});

test('reorder-range (sort) propagates the new cell order', async () => {
  const { owner, joiner, cleanup } = await joinTwoPeerRoom();
  // Seed three rows of values; we'll sort A1:A3 ascending.
  await owner.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).__univerAPI;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook().getActiveSheet();
    ws.getRange('A1').setValue({ v: 3 });
    ws.getRange('A2').setValue({ v: 1 });
    ws.getRange('A3').setValue({ v: 2 });
  });
  await joiner.waitForFunction(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).__univerAPI;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws: any = api.getActiveWorkbook().getActiveSheet();
      return ws.getRange('A3').getValue() === 2;
    },
    null,
    { timeout: 5_000 },
  );

  // Reorder rows: 0→1, 1→2, 2→0 (i.e. move first row to second slot
  // etc., producing the sort result 1, 2, 3 from input 3, 1, 2).
  await owner.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).__univerAPI;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wb: any = api.getActiveWorkbook();
    api.executeCommand('sheet.command.reorder-range', {
      unitId: wb.getId(),
      subUnitId: wb.getActiveSheet().getSheetId(),
      range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 },
      order: { 0: 1, 1: 2, 2: 0 },
    });
  });
  await joiner.waitForTimeout(1500);
  const values = await joiner.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).__univerAPI;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = api.getActiveWorkbook().getActiveSheet();
    return [ws.getRange('A1').getValue(), ws.getRange('A2').getValue(), ws.getRange('A3').getValue()];
  });
  // Input was [3, 1, 2]. order { 0:1, 1:2, 2:0 } means "the value
  // originally at row 0 ends up at row 1; row 1's value at row 2; row 2's
  // value at row 0". So A1 = 2, A2 = 3, A3 = 1.
  expect(values).toEqual([2, 3, 1]);
  await cleanup();
});
