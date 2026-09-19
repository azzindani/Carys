import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Volume } from '@carys/volume-core';
import { createLabelmapFromVolume, replaceLabelValue, toLabelMap } from '../segments.js';

function vol(dims: [number, number, number]): Volume {
  return { dims, spacing: [1, 1, 1], origin: [0, 0, 0], dtype: 'uint8', data: new Uint8Array(dims[0] * dims[1] * dims[2]) };
}

describe('segments', () => {
  it('createLabelmapFromVolume sizes to the volume, zeroed', () => {
    const lm = createLabelmapFromVolume(vol([3, 4, 5]));
    assert.equal(lm.length, 60);
    assert.ok(lm.every((v) => v === 0));
    assert.ok(lm instanceof Uint8Array);
  });
  it('toLabelMap binarizes any nonzero to 1, keeps length', () => {
    assert.deepEqual([...toLabelMap(new Uint8Array([0, 5, 255, 1, 0]))], [0, 1, 1, 1, 0]);
  });
  it('replaceLabelValue rewrites in place, ignores absent values', () => {
    const lm = new Uint8Array([0, 2, 2, 3]);
    replaceLabelValue(lm, 2, 7);
    assert.deepEqual([...lm], [0, 7, 7, 3]);
    replaceLabelValue(lm, 9, 1);
    assert.deepEqual([...lm], [0, 7, 7, 3]);
  });
});
