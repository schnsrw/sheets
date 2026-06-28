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

import { useMemo, useState } from 'react';
import type { FUniver } from '@univerjs/core/facade';
import { Dialog } from './Dialog';
import { BUILTIN_LISTS, customListSort, parseOrder, type SortRow } from './custom-list-sort';

/**
 * Sort by custom list (Excel's Data → Sort → Order → "Custom List…"). The
 * selection is sorted by one column using a built-in Day/Month list or a
 * user-typed order; values outside the list fall to the end alphabetically.
 * The sort maths lives in `custom-list-sort.ts`; this reads the selection's
 * cell data, runs it, and writes back with one atomic `setValues`.
 */

type Props = {
  api: FUniver;
  onClose: () => void;
};

function colToLetters(col: number): string {
  let s = '';
  let n = col;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

const stringifyHeader = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'object' && 'v' in (v as Record<string, unknown>)) {
    return String((v as { v: unknown }).v ?? '');
  }
  return String(v);
};

const CUSTOM = '__custom__';

export function CustomListSortDialog({ api, onClose }: Props) {
  const wb = api.getActiveWorkbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ws = wb?.getActiveSheet() as any;
  const range = ws?.getActiveRange?.();

  const width: number = range?.getWidth?.() ?? 0;
  const startCol: number = range?.getColumn?.() ?? 0;
  const firstRow: unknown[] = useMemo(() => (range ? (range.getValues()?.[0] ?? []) : []), [range]);

  const [hasHeaders, setHasHeaders] = useState(true);
  const [keyColumn, setKeyColumn] = useState(0);
  const [listId, setListId] = useState<string>(BUILTIN_LISTS[0].id);
  const [customText, setCustomText] = useState('');
  const [ascending, setAscending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const columnLabel = (i: number): string => {
    const letter = colToLetters(startCol + i);
    if (hasHeaders) {
      const h = stringifyHeader(firstRow[i]).trim();
      return h !== '' ? h : `Column ${letter}`;
    }
    return `Column ${letter}`;
  };

  const resolveOrder = (): string[] => {
    if (listId === CUSTOM) return parseOrder(customText);
    return BUILTIN_LISTS.find((l) => l.id === listId)?.items ?? [];
  };

  const apply = () => {
    if (!range) return;
    const order = resolveOrder();
    if (order.length === 0) {
      setError('Enter at least one value for the custom order.');
      return;
    }
    const rows = range.getCellDatas() as SortRow[];
    const out = customListSort({ rows, hasHeaders, keyColumn, order, ascending });
    range.setValues(out.rows as never);
    onClose();
  };

  return (
    <Dialog
      title="Sort by custom list"
      onClose={onClose}
      data-testid="custom-list-sort-dialog"
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            data-testid="custom-list-sort-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            data-testid="custom-list-sort-ok"
            onClick={apply}
            disabled={width === 0}
          >
            Sort
          </button>
        </>
      }
    >
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, minWidth: 320 }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            data-testid="custom-list-sort-headers"
            checked={hasHeaders}
            onChange={(e) => setHasHeaders(e.target.checked)}
          />
          My data has headers
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Sort by column</span>
          <select
            data-testid="custom-list-sort-column"
            value={keyColumn}
            onChange={(e) => setKeyColumn(Number(e.target.value))}
          >
            {Array.from({ length: width }, (_, i) => (
              <option key={i} value={i}>
                {columnLabel(i)}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Order</span>
          <select
            data-testid="custom-list-sort-list"
            value={listId}
            onChange={(e) => setListId(e.target.value)}
          >
            {BUILTIN_LISTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
            <option value={CUSTOM}>Custom list…</option>
          </select>
        </label>

        {listId === CUSTOM && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Custom order (one per line, or comma-separated)</span>
            <textarea
              data-testid="custom-list-sort-custom"
              rows={4}
              value={customText}
              spellCheck={false}
              placeholder={'High\nMedium\nLow'}
              onChange={(e) => {
                setCustomText(e.target.value);
                if (error) setError(null);
              }}
            />
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Direction</span>
          <select
            data-testid="custom-list-sort-direction"
            value={ascending ? 'asc' : 'desc'}
            onChange={(e) => setAscending(e.target.value === 'asc')}
          >
            <option value="asc">A → Z (list order)</option>
            <option value="desc">Z → A (reverse)</option>
          </select>
        </label>

        {error && (
          <div
            data-testid="custom-list-sort-error"
            style={{ color: 'var(--color-danger, #c4321a)' }}
          >
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
