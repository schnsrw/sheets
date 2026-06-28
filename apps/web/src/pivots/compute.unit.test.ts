import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dateGroupKey } from './compute.ts';

test('dateGroupKey buckets an Excel serial by year', () => {
  // 45658 = 2025-01-01 (the importer stores dates as serials).
  assert.equal(dateGroupKey(45658, 'year'), '2025');
  assert.equal(dateGroupKey(45658, 'quarter'), '2025-Q1');
  assert.equal(dateGroupKey(45658, 'month'), '2025-01');
});

test('dateGroupKey buckets a date string (DATE() formula shape)', () => {
  // A =DATE() cell surfaces as "2025/06/20" in this app.
  assert.equal(dateGroupKey('2025/06/20', 'year'), '2025');
  assert.equal(dateGroupKey('2025/06/20', 'quarter'), '2025-Q2');
  assert.equal(dateGroupKey('2025/06/20', 'month'), '2025-06');
  assert.equal(dateGroupKey('2025-03-15', 'month'), '2025-03');
  assert.equal(dateGroupKey('2025/12/31', 'quarter'), '2025-Q4');
});

test('quarter boundaries', () => {
  assert.equal(dateGroupKey('2025-01-01', 'quarter'), '2025-Q1');
  assert.equal(dateGroupKey('2025-04-01', 'quarter'), '2025-Q2');
  assert.equal(dateGroupKey('2025-07-01', 'quarter'), '2025-Q3');
  assert.equal(dateGroupKey('2025-10-01', 'quarter'), '2025-Q4');
});

test('non-date values fall back to the raw key', () => {
  assert.equal(dateGroupKey('East', 'year'), 'East');
  assert.equal(dateGroupKey('notadate', 'quarter'), 'notadate');
  assert.equal(dateGroupKey(null, 'year'), '');
});

test("'none' returns the raw key unchanged", () => {
  assert.equal(dateGroupKey(45658, 'none'), '45658');
  assert.equal(dateGroupKey('East', 'none'), 'East');
});

test('grouped keys sort chronologically as strings', () => {
  const keys = ['2025/03/01', '2025/01/01', '2026/01/01'].map((d) => dateGroupKey(d, 'month'));
  assert.deepEqual([...keys].sort(), ['2025-01', '2025-03', '2026-01']);
});
