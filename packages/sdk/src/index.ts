/**
 * @schnsrw/casual-sheets — Casual Sheets SDK
 *
 * Three surfaces:
 *   - `./signing` — anchored cell signatures (drawn / typed / uploaded).
 *   - `./embed`   — iframe postMessage protocol for host integrations.
 *   - `./sheets`  — `CasualSheets` React wrapper around Univer Sheets.
 *
 * The `./styles` side-effect entry brings in the eager plugin CSS:
 *
 *   import '@schnsrw/casual-sheets/styles';
 */

export * from './signing';
export * from './embed';
export * from './sheets';
