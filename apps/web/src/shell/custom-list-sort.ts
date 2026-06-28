/**
 * Copyright 2026 Casual Office
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Sort a range by a custom list — Excel's Data → Sort → Order → "Custom
 * List…" (and the built-in Day/Month lists). Rows are reordered by where
 * their key-column value falls in the custom order; values not in the list
 * sort after the listed ones, alphabetically (Excel's behaviour).
 *
 * Pure + Univer/React-free so it's unit-testable; the dialog feeds it
 * `getCellDatas()` and writes the result back with a single `setValues`,
 * which keeps the whole reorder one atomic, undoable mutation and preserves
 * each cell's value / formula / style.
 */

/** Minimal cell shape we read/write — a subset of Univer's ICellData. */
export interface SortCell {
  v?: unknown;
  f?: string;
  p?: unknown;
  [k: string]: unknown;
}

export type SortRow = Array<SortCell | null>;

/** Built-in custom lists, matching Excel's defaults. */
export const BUILTIN_LISTS: ReadonlyArray<{ id: string; label: string; items: string[] }> = [
  {
    id: 'dow-short',
    label: 'Sun, Mon, Tue, …',
    items: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
  {
    id: 'dow-long',
    label: 'Sunday, Monday, …',
    items: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  },
  {
    id: 'mon-short',
    label: 'Jan, Feb, Mar, …',
    items: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
  {
    id: 'mon-long',
    label: 'January, February, …',
    items: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
  },
];

export interface CustomSortInput {
  /** Full cell data of the selection, row-major. */
  rows: SortRow[];
  /** Treat the first row as a header (kept in place, never sorted). */
  hasHeaders: boolean;
  /** Column index (0-based within the selection) whose value drives the sort. */
  keyColumn: number;
  /** The custom order, outermost first. Compared case-insensitively. */
  order: string[];
  /** Ascending follows the list order; descending reverses it. */
  ascending: boolean;
}

/** The text we compare on — prefer the literal value `v`; ignore styling. */
function cellText(cell: SortCell | null): string {
  if (cell == null || cell.v == null) return '';
  return String(cell.v).trim();
}

const norm = (s: string): string => s.toLowerCase();

const naturalCompare = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Reorder the data rows by the custom list. Returns a new matrix with the
 * same dimensions; the header row (if any) stays first. Stable — rows whose
 * key isn't in the list keep their relative order among themselves only via
 * the alphabetical fallback, and exact ties preserve input order.
 */
export function customListSort(input: CustomSortInput): { rows: SortRow[] } {
  const { rows, hasHeaders, keyColumn, order, ascending } = input;
  const headerCount = hasHeaders ? 1 : 0;
  const header = rows.slice(0, headerCount);
  const data = rows.slice(headerCount);

  const rank = new Map<string, number>();
  order.forEach((v, i) => {
    const k = norm(v.trim());
    if (!rank.has(k)) rank.set(k, i); // first wins on dup entries
  });
  const dir = ascending ? 1 : -1;

  const decorated = data.map((row, i) => {
    const key = cellText(row[keyColumn]);
    const r = rank.has(norm(key)) ? (rank.get(norm(key)) as number) : Number.POSITIVE_INFINITY;
    return { row, i, key, r };
  });

  decorated.sort((a, b) => {
    if (a.r !== b.r) {
      // Listed values order by rank; unlisted (Infinity) fall to the end for
      // ascending, to the front for descending — matching Excel.
      if (a.r === Number.POSITIVE_INFINITY) return ascending ? 1 : -1;
      if (b.r === Number.POSITIVE_INFINITY) return ascending ? -1 : 1;
      return dir * (a.r - b.r);
    }
    if (a.r === Number.POSITIVE_INFINITY) {
      const byText = dir * naturalCompare(a.key, b.key);
      if (byText !== 0) return byText;
    }
    return a.i - b.i; // stable tie-break
  });

  // Clone every cell. `getCellDatas()` hands back live references to the
  // model's cell objects; `setValues` mutates them as it writes, so a
  // reordered array of the originals corrupts mid-write (rows alias each
  // other). Returning fresh cell objects keeps the reorder safe.
  const cloneRow = (row: SortRow): SortRow => row.map((c) => (c == null ? null : { ...c }));
  return { rows: [...header, ...decorated.map((d) => d.row)].map(cloneRow) };
}

/** Parse a user-typed custom order (comma- or newline-separated, trimmed). */
export function parseOrder(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
