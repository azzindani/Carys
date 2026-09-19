import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { regionGrow } from '../ops.js';
import { binarize, connectedComponents, jaccard } from '../masks.js';
import { fillHoles } from '../fillholes.js';
import { maskVolume, profileLine } from '@carys/measure';
import type { Volume } from '@carys/volume-core';

const vol = (data: number[], dims: [number, number, number] = [3, 3, 1]) =>
  ({
    dims, spacing: [1, 1, 1], origin: [0, 0, 0],
    dtype: 'uint8', data: Uint8Array.from(data),
  }) as unknown as Volume;

describe('regionGrow', () => {
  it('grows within range from seed', () => {
    const v = vol([0, 0, 0, 0, 5, 0, 0, 0, 0]);
    const m = regionGrow(v, [1, 1, 0], 1, 10);
    assert.equal(m[4], 1);
    assert.equal(m.reduce((a, b) => a + b, 0), 1);
  });
});

describe('masks', () => {
  it('binarize thresholds truthy', () => {
    assert.deepEqual([...binarize(Uint8Array.from([0, 2, 0]))], [0, 1, 0]);
  });
  it('connectedComponents labels 2 blobs; jaccard identical=1', () => {
    const m = Uint8Array.from([1, 0, 1, 0, 0, 0, 0, 0, 0]);
    const { count } = connectedComponents(m, 3, 3, 1);
    assert.equal(count, 2);
    assert.equal(jaccard(m, m), 1);
    assert.equal(jaccard(m, new Uint8Array(9)), 0);
  });
});

describe('fillHoles', () => {
  it('fills enclosed zero', () => {
    const m = Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    assert.equal(fillHoles(m, 3, 3, 1)[4], 1);
  });
});

describe('measure extras', () => {
  it('maskVolume counts voxels x spacing', () => {
    const v = vol([1, 2, 3, 4]);
    assert.equal(maskVolume(Uint8Array.from([1, 1, 0, 0]), v), 2);
  });
  it('profileLine samples endpoints', () => {
    const v = vol([10, 20]);
    const p = profileLine({ ...v, dims: [2, 1, 1] } as Volume, [0, 0, 0], [1, 0, 0], 2);
    assert.deepEqual(p, [10, 20]);
  });
});
