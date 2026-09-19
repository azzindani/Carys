import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importTid1500 } from '../tid1500-import.js';
import { measurementsToTid1500 } from '../tid1500.js';
import type { Measurement } from '../tracking.js';

const ROWS: Measurement[] = [
  {
    id: 'm1', series: 's1', label: 'nodule', kind: 'length', value: 43.3,
    unit: 'mm', plane: 'axial', slice: 7, points: [[1, 2], [30, 40]], createdAt: '2026-01-01',
  },
  {
    id: 'm2', series: 's1', label: 'nodule', kind: 'length', value: 12.5,
    unit: 'mm', plane: 'axial', slice: 8, points: [[0, 0]], createdAt: '2026-01-01',
  },
];

describe('I2 TID1500 import', () => {
  it('round-trips our own export: values + points survive, labels tagged', () => {
    const tree = measurementsToTid1500(ROWS, 's1-uid');
    const back = importTid1500(tree, 's1');
    assert.equal(back.length, 2);
    assert.equal(back[0]!.value, 43.3);
    assert.equal(back[0]!.unit, 'mm');
    assert.deepEqual(back[0]!.points, [[1, 2], [30, 40]]);
    assert.ok(back[0]!.label.endsWith('· SR import'), `provenance tag missing: ${back[0]!.label}`);
    assert.ok(back.every((m) => m.series === 's1'));
  });
  it('re-export of an import carries the provenance tag forward', () => {
    const back = importTid1500(measurementsToTid1500(ROWS), 's1');
    const tree2 = measurementsToTid1500(back) as Record<string, unknown>;
    const text = JSON.stringify(tree2);
    assert.ok(text.includes('SR import'), 'tag lost on re-export');
  });
  it('misshaped trees fail loud with named errors', () => {
    const tree = measurementsToTid1500(ROWS);
    assert.throws(() => importTid1500(null, 's1'), /tid1500-import/);
    assert.throws(() => importTid1500(tree, ''), /series/);
    assert.throws(() => importTid1500({ nope: 1 }, 's1'), /top CONTAINER/);
    assert.throws(() => importTid1500({ ContentSequence: [{ ValueType: 'CONTAINER', ContentSequence: [] }] }, 's1'), /Imaging Measurements/);
    const noNums = JSON.parse(JSON.stringify(tree));
    noNums.ContentSequence[0].ContentSequence[0].ContentSequence =
      noNums.ContentSequence[0].ContentSequence[0].ContentSequence.filter(
        (c: Record<string, unknown>) => c.ValueType !== 'NUM',
      );
    assert.throws(() => importTid1500(noNums, 's1'), /no NUM/);
    const badNum = JSON.parse(JSON.stringify(tree)) as Record<string, unknown>;
    const badContent = (badNum.ContentSequence as Record<string, unknown>[])[0]!;
    const badGroups = (badContent.ContentSequence as Record<string, unknown>[])[0]!;
    const badNums = (badGroups.ContentSequence as Record<string, unknown>[]).filter((c) => c.ValueType === 'NUM');
    ((badNums[0]!.MeasuredValueSequence as Record<string, unknown>[])[0]! as Record<string, unknown>).NumericValue = 'lots';
    assert.throws(() => importTid1500(badNum, 's1'), /tid1500-bad-num/);
  });
});
