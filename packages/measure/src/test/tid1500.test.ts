import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMeasurement } from '../tracking.js';
import { groupForTid1500, measurementsToTid1500 } from '../tid1500.js';

const M = (label: string, kind: 'length' | 'angle' = 'length', series = 's1') =>
  createMeasurement(kind, 'axial', 7, [[0, 0], [3, 4]], 5, 'mm', series);

describe('tid1500', () => {
  it('groups by series+label, template shape exact', () => {
    const rows = [
      { ...M('Nodule 1'), label: 'Nodule 1' },
      { ...M('Nodule 1'), label: 'Nodule 1' },
      { ...M('Node 2', 'angle'), label: 'Node 2' },
    ];
    const groups = groupForTid1500(rows);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]!.measurements.length, 2);
    assert.equal(groups[1]!.measurements.length, 1);
    assert.match(groups[0]!.trackingUID, /^carys\.\d+$/);
    const sr = measurementsToTid1500(rows, '1.2.3') as {
      SOPClassUID: string; SeriesUID: string; ContentSequence: { ContentSequence: unknown[] }[];
    };
    assert.equal(sr.SOPClassUID, '1.2.840.10008.5.1.4.1.1.88.11');
    assert.equal(sr.SeriesUID, '1.2.3');
    assert.equal(sr.ContentSequence[0]!.ContentSequence.length, 2);
  });
  it('empty export is a valid empty report, values rounded', () => {
    const sr = measurementsToTid1500([]) as { ContentSequence: { ContentSequence: unknown[] }[] };
    assert.equal(sr.ContentSequence[0]!.ContentSequence.length, 0);
    const one = measurementsToTid1500([
      createMeasurement('length', 'axial', 1, [[0, 0], [1, 1]], 5.555, 'mm', 's'),
    ]);
    assert.ok(JSON.stringify(one).includes('5.56'));
  });
});
