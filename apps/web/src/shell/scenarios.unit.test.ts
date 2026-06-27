import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  __clearScenarios,
  deleteScenario,
  getScenarios,
  parseCellRefs,
  upsertScenario,
} from './scenarios.ts';

test('parseCellRefs splits, upper-cases, dedupes, and drops non-cells', () => {
  assert.deepEqual(parseCellRefs('b1, B2  c3'), ['B1', 'B2', 'C3']);
  assert.deepEqual(parseCellRefs('B1, B1'), ['B1']); // dedupe
  assert.deepEqual(parseCellRefs('A1:B2'), []); // ranges rejected
  assert.deepEqual(parseCellRefs('xyz, 5, B2'), ['B2']); // junk dropped
  assert.deepEqual(parseCellRefs(''), []);
});

test('upsert / get / delete round-trip per workbook', () => {
  __clearScenarios();
  upsertScenario('wb1', { name: 'Best', cells: [{ ref: 'B1', value: 10 }] });
  upsertScenario('wb1', { name: 'Worst', cells: [{ ref: 'B1', value: 1 }] });
  assert.deepEqual(
    getScenarios('wb1').map((s) => s.name),
    ['Best', 'Worst'],
  );
  // Different workbook is isolated.
  assert.deepEqual(getScenarios('wb2'), []);
  // Upsert replaces by name.
  upsertScenario('wb1', { name: 'Best', cells: [{ ref: 'B1', value: 99 }] });
  assert.equal(getScenarios('wb1').length, 2);
  assert.equal(getScenarios('wb1').find((s) => s.name === 'Best')?.cells[0].value, 99);
  // Delete.
  deleteScenario('wb1', 'Worst');
  assert.deepEqual(
    getScenarios('wb1').map((s) => s.name),
    ['Best'],
  );
});
