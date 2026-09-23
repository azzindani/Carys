import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { islandSizes, keepLargest, removeSmall } from '../islands.js';
import { close, countVoxels, dilate, erode, marginMm, open, outline, smoothMask } from '../morph.js';
import type { Dims3 } from '../morph.js';

function cube(d: Dims3, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Uint8Array {
  const m = new Uint8Array(d.nx * d.ny * d.nz);
  for (let z = z0; z <= z1; z++) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) m[z * d.nx * d.ny + y * d.nx + x] = 1;
    }
  }
  return m;
}

const D: Dims3 = { nx: 9, ny: 9, nz: 9 };

describe('morphology', () => {
  it('erodes one layer; dilate rounds the corners (cross SE)', () => {
    const c = cube(D, 2, 6, 2, 6, 2, 6); // 5^3
    assert.equal(countVoxels(c), 125);
    const e = erode(c, D, 1);
    assert.equal(countVoxels(e), 27); // 3^3
    // dilate(erode) != identity: cross-SE dilation cannot rebuild the 8
    // corners + 12 edges (44 voxels) — this corner-rounding is what makes
    // open() a speck remover. 125 - 44 = 81.
    const d = dilate(e, D, 1);
    assert.equal(countVoxels(d), 81);
    // ...while dilating the ORIGINAL cube grows every face
    assert.ok(countVoxels(dilate(c, D, 1)) > 125);
  });
  it('open removes isolated specks but keeps blocks', () => {
    const m = cube(D, 1, 3, 3, 5, 3, 5);
    const m2 = cube(D, 5, 7, 3, 5, 3, 5);
    for (let i = 0; i < m.length; i++) m[i] = (m[i] || m2[i]) as number;
    m[0] = 1; // isolated corner speck
    m[8 * 81 + 8 * 9 + 8] = 1; // isolated far speck
    const opened = open(m, D, 1);
    assert.equal(opened[0], 0);
    assert.equal(opened[8 * 81 + 8 * 9 + 8], 0);
    // each 3^3 block erodes to its center voxel and regrows to a 7-voxel
    // cross: 2 x 7 = 14 (flat index of (x,y,z) is z*81+y*9+x)
    assert.equal(countVoxels(opened), 14);
    assert.equal(opened[4 * 81 + 4 * 9 + 2], 1); // block centers survive
    assert.equal(opened[4 * 81 + 4 * 9 + 6], 1);
  });
  it('close fills a 1-voxel notch', () => {
    const m = cube(D, 2, 6, 2, 6, 2, 6);
    m[4 * 81 + 4 * 9 + 4] = 0; // punch a hole voxel
    const c = close(m, D, 1);
    assert.equal(c[4 * 81 + 4 * 9 + 4], 1);
  });
  it('outline is the boundary shell', () => {
    const c = cube(D, 2, 6, 2, 6, 2, 6);
    assert.equal(countVoxels(outline(c, D)), 125 - 27);
  });
  it('smooth keeps solid cubes, marginMm grows by spacing', () => {
    const c = cube(D, 2, 6, 2, 6, 2, 6);
    assert.equal(countVoxels(smoothMask(c, D, 1)), 125);
    const grown = marginMm(c, D, [1, 1, 2], 2);
    assert.ok(countVoxels(grown) > 125);
    const shrunk = marginMm(c, D, [1, 1, 1], -1);
    assert.equal(countVoxels(shrunk), 27);
  });
});

describe('islands', () => {
  it('ranks, keeps largest, removes specks', () => {
    const m = new Uint8Array(9 * 9 * 9);
    const big = cube(D, 0, 3, 0, 3, 0, 3); // 64
    const small = cube(D, 7, 8, 7, 8, 7, 8); // 8
    for (let i = 0; i < m.length; i++) m[i] = (big[i] || small[i]) as number;
    m[4 * 81 + 4 * 9 + 4] = 1; // lone speck
    const sizes = islandSizes(m, D);
    assert.deepEqual(sizes.map((s) => s.size), [64, 8, 1]);
    assert.equal(countVoxels(keepLargest(m, D)), 64);
    assert.equal(countVoxels(removeSmall(m, D, 8)), 72);
    assert.equal(countVoxels(removeSmall(m, D, 1)), 73);
  });
});
