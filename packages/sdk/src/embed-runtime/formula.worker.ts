/**
 * Formula calculation worker for the iframe embed.
 *
 * Runs a stripped-down Univer in a Web Worker so the main thread doesn't
 * HANG recalculating a formula-heavy workbook on open (the symptom: opening a
 * real sheet froze the page). The main-thread instance owns the data model +
 * UI; this one only computes. Communication is via Univer's RPC plugins —
 * `UniverRPCMainThreadPlugin` on the main thread (wired by `<CasualSheets>` via
 * the `formula={{ worker }}` prop) and `UniverRPCWorkerThreadPlugin` here.
 *
 * Mirrors the reference app's `apps/web/src/univer/formula-worker.ts`. Bundled
 * self-contained (the tsup embed config inlines all deps) since a module worker
 * has no import map at runtime.
 */
import { LocaleType, LogLevel, Univer } from '@univerjs/core';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverRPCWorkerThreadPlugin } from '@univerjs/rpc';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter';
import { UniverRemoteSheetsFormulaPlugin } from '@univerjs/sheets-formula';

const univer = new Univer({
  locale: LocaleType.EN_US,
  logLevel: LogLevel.WARN,
});

univer.registerPlugins([
  // Skip the half of the sheets plugin that mutates UI / selection — the
  // worker renders nothing, it only consumes data mutations to compute.
  [UniverSheetsPlugin, { onlyRegisterFormulaRelatedMutations: true }],
  [UniverFormulaEnginePlugin],
  [UniverRPCWorkerThreadPlugin],
  [UniverRemoteSheetsFormulaPlugin],
  // Filters affect formula visibility (SUBTOTAL etc.); keep the plugin so
  // calculations see the same hidden state as the UI.
  [UniverSheetsFilterPlugin],
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).univer = univer;
