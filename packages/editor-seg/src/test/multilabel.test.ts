import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  labelmapToMasks, masksToLabelmap, segmentsTable, segmentsTableToCSV,
} from '../multilabel.js';

describe('multi-label roundtrip', () => {
  it('split then merge is identity, background stays 0', () => {
    const lm = new Uint8Array([0, 1, 1, 2, 0, 3, 2, 1]);
    const masks = labelmapToMasks(lm);
    assert.deepEqual([...masks.keys()].sort(), [1, 2, 3]);
    assert.equal(masks.get(1)!.reduce((a, b) => a + b, 0), 3);
    assert.deepEqual(masksToLabelmap(masks, lm.length), lm);
  });
  it('bad values and lengths throw named errors', () => {
    assert.throws(() => masksToLabelmap(new Map([[0, new Uint8Array(4)]]), 4), /multilabel-bad-value/);
    assert.throws(() => masksToLabelmap(new Map([[300, new Uint8Array(4)]]), 4), /multilabel-bad-value/);
    assert.throws(() => masksToLabelmap(new Map([[1, new Uint8Array(3)]]), 4), /multilabel-length/);
  });
  it('segments table counts + volumes, unknown labels defaulted, CSV exact', () => {
    const lm = new Uint8Array([0, 1, 1, 2, 2, 2]);
    const rows = segmentsTable(lm, [0.5, 0.5, 2], [{ value: 1, label: 'Tumor' }]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.label, 'Tumor');
    assert.equal(rows[0]!.voxels, 2);
    assert.equal(rows[0]!.volumeMm3, 2 * 0.5);
    assert.equal(rows[1]!.label, 'Segment 2');
    assert.equal(rows[1]!.volumeMm3, 3 * 0.5);
    const csv = segmentsTableToCSV(rows);
    assert.ok(csv.startsWith('value,label,voxels,volume_mm3\n1,Tumor,2,1\n'));
    assert.deepEqual(segmentsTable(new Uint8Array(4), [1, 1, 1]), []);
  });
});
