import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reslice } from '../mpr.js';
import type { Volume } from '@carys/volume-core';

describe('reslice', () => {
  it('axial slice has right size and opaque alpha', () => {
    const vol = {
      dims: [2, 3, 4], spacing: [1, 1, 1], origin: [0, 0, 0],
      dtype: 'uint8', data: new Uint8Array(2 * 3 * 4).fill(128),
    } as unknown as Volume;
    const out = reslice(vol, 'axial', 0, { center: 128, width: 256 });
    assert.equal(out.length, 2 * 3 * 4);
    assert.equal(out[3], 255);
  });
});
