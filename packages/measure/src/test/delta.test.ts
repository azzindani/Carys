import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { baseLabel, lesionDeltaTable, lesionDeltaTableToCSV, volumeDelta } from '../delta.js';
import { createMeasurement, type Measurement } from '../tracking.js';

const M = (label: string, value: number, series: string): Measurement => ({
  ...createMeasurement('length', 'axial', 5, [[0, 0], [3, 4]], value, 'mm', series),
  label,
});

describe('lesion delta', () => {
  it('pairs by base label, computes delta + pct, keeps orphans', () => {
    const base = [M('Nodule 1', 20, 'base'), M('Nodule 2', 10, 'base')];
    const fu = [M('Nodule 1 — FU', 25, 'fu'), M('Nodule 3', 5, 'fu')];
    const rows = lesionDeltaTable(base, fu);
    assert.equal(rows.length, 3);
    const n1 = rows.find((r) => r.label === 'Nodule 1')!;
    assert.equal(n1.deltaMm, 5);
    assert.equal(n1.pctChange, 25);
    const n2 = rows.find((r) => r.label === 'Nodule 2')!;
    assert.equal(n2.followup, null);
    assert.equal(n2.deltaMm, null);
    const n3 = rows.find((r) => r.label === 'Nodule 3')!;
    assert.equal(n3.baseline, null);
  });
  it('baseLabel strips follow-up suffixes, volumeDelta exact', () => {
    assert.equal(baseLabel('Nodule 1 — FU'), 'Nodule 1');
    assert.equal(baseLabel('Nodule 1 (FU)'), 'Nodule 1');
    assert.equal(baseLabel('Plain'), 'Plain');
    assert.deepEqual(volumeDelta(10, 15), { deltaCm3: 5, pctChange: 50 });
    assert.equal(volumeDelta(0, 5).pctChange, Infinity);
    assert.throws(() => volumeDelta(NaN, 1), /delta-volumes/);
  });
  it('CSV carries paired + orphan rows', () => {
    const rows = lesionDeltaTable([M('A', 10, 'b')], [M('A — FU', 12, 'f')]);
    const csv = lesionDeltaTableToCSV(rows);
    assert.ok(csv.startsWith('lesion,baseline,followup,unit,delta,pct_change\n'));
    assert.ok(csv.includes('A,10,12,mm,2,20'));
  });
});
