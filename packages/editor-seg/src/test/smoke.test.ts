import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { threshold } from '../ops.js';
import type { Volume } from '@carys/volume-core';

describe('threshold', () => {
  it('keeps voxels in [lo,hi]', () => {
    const vol = {
      dims: [2, 2, 1], spacing: [1, 1, 1], origin: [0, 0, 0],
      dtype: 'uint8', data: Uint8Array.from([0, 50, 150, 255]),
    } as unknown as Volume;
    assert.deepEqual([...threshold(vol, 100, 200)], [0, 0, 1, 0]);
  });
});
