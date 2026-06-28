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

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { customListSort, parseOrder, type SortRow } from './custom-list-sort.js';

/** Build a 1-column-key matrix: each row is [key, payload]. */
function rows(keys: string[]): SortRow[] {
  return keys.map((k, i) => [{ v: k }, { v: `p${i}` }]);
}
const keysOf = (rs: SortRow[]) => rs.map((r) => (r[0] as { v: string }).v);
const payloadsOf = (rs: SortRow[]) => rs.map((r) => (r[1] as { v: string }).v);

const ORDER = ['North', 'South', 'East', 'West'];

test('sorts the key column by the custom order', () => {
  const out = customListSort({
    rows: rows(['West', 'North', 'East', 'South']),
    hasHeaders: false,
    keyColumn: 0,
    order: ORDER,
    ascending: true,
  });
  assert.deepEqual(keysOf(out.rows), ['North', 'South', 'East', 'West']);
});

test('moves the whole row, not just the key cell', () => {
  // rows(): payloads are p0..p3 tied to the original key positions.
  const out = customListSort({
    rows: rows(['West', 'North', 'East', 'South']),
    hasHeaders: false,
    keyColumn: 0,
    order: ORDER,
    ascending: true,
  });
  // North was index 1 (p1), South index 3 (p3), East index 2 (p2), West index 0 (p0).
  assert.deepEqual(payloadsOf(out.rows), ['p1', 'p3', 'p2', 'p0']);
});

test('keeps the header row in place', () => {
  const data: SortRow[] = [[{ v: 'Region' }, { v: 'H' }], ...rows(['West', 'North'])];
  const out = customListSort({
    rows: data,
    hasHeaders: true,
    keyColumn: 0,
    order: ORDER,
    ascending: true,
  });
  assert.equal((out.rows[0][0] as { v: string }).v, 'Region');
  assert.deepEqual(keysOf(out.rows.slice(1)), ['North', 'West']);
});

test('values not in the list sort after, alphabetically (ascending)', () => {
  const out = customListSort({
    rows: rows(['Zebra', 'South', 'Apple', 'North']),
    hasHeaders: false,
    keyColumn: 0,
    order: ORDER,
    ascending: true,
  });
  assert.deepEqual(keysOf(out.rows), ['North', 'South', 'Apple', 'Zebra']);
});

test('descending reverses the list order and puts unlisted at the front', () => {
  const out = customListSort({
    rows: rows(['North', 'West', 'Apple', 'South']),
    hasHeaders: false,
    keyColumn: 0,
    order: ORDER,
    ascending: false,
  });
  // Unlisted first (reverse-alpha), then list order reversed.
  assert.deepEqual(keysOf(out.rows), ['Apple', 'West', 'South', 'North']);
});

test('match is case-insensitive and trims whitespace', () => {
  const out = customListSort({
    rows: rows([' west ', 'NORTH', 'south']),
    hasHeaders: false,
    keyColumn: 0,
    order: ORDER,
    ascending: true,
  });
  assert.deepEqual(keysOf(out.rows), ['NORTH', 'south', ' west ']);
});

test('stable for equal keys (preserves input order)', () => {
  const data: SortRow[] = [
    [{ v: 'North' }, { v: 'a' }],
    [{ v: 'North' }, { v: 'b' }],
    [{ v: 'North' }, { v: 'c' }],
  ];
  const out = customListSort({
    rows: data,
    hasHeaders: false,
    keyColumn: 0,
    order: ORDER,
    ascending: true,
  });
  assert.deepEqual(payloadsOf(out.rows), ['a', 'b', 'c']);
});

test('parseOrder splits on commas and newlines, trims, drops blanks', () => {
  assert.deepEqual(parseOrder('North, South\nEast ,, West\n'), ['North', 'South', 'East', 'West']);
});
