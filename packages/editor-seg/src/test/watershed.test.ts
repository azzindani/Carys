import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { manhattanDistance, watershedSplit } from '../watershed.js';
import { connectedComponents } from '../masks.js';
import { countVoxels } from '../morph.js';
import type { Dims3 } from '../morph.js';

// 7x3x1 board, z=0 plane (rows top→bottom):
//   XXX.XXX
//   XXX.XXX
//   XXX.XXX   (two 3x3 squares, gap at x=3)
function squares(nx = 7): { m: Uint8Array; d: Dims3 } {
  const d: Dims3 = { nx, ny: 3, nz: 1 };
  const m = new Uint8Array(nx * 3);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) m[y * nx + x] = 1;
    for (let x = 4; x < 7; x++) m[y * nx + x] = 1;
  }
  return { m, d };
}

describe('watershed', () => {
  it('distance transform peaks at square centers, zero outside', () => {
    const { m, d } = squares();
    const dist = manhattanDistance(m, d);
    const at = (x: number, y: number): number => dist[y * 7 + x]!;
    assert.equal(at(1, 1), 2);
    assert.equal(at(5, 1), 2);
    // Manhattan anisotropy: the corner reaches background only around the
    // square (3 steps), so it outranks the center — ordering still peaks
    // one basin per lobe, which is all the flood needs.
    assert.equal(at(0, 0), 3);
    assert.equal(at(3, 1), 0); // background gap
  });
  it('splits a bridged dumbbell, clears only the neck', () => {
    const { m, d } = squares();
    // single-voxel bridge at (3,1): one connected component
    m[1 * 7 + 3] = 1;
    assert.equal(connectedComponents(m, 7, 3, 1).count, 1);
    const before = countVoxels(m);
    const { mask, basins, removed } = watershedSplit(m, d);
    assert.equal(basins, 2);
    assert.ok(removed >= 1, 'neck must clear');
    assert.equal(countVoxels(mask), before - removed);
    // output really is two separated pieces, subset of the input
    assert.equal(connectedComponents(mask, 7, 3, 1).count, 2);
    for (let i = 0; i < mask.length; i++) assert.ok(mask[i]! <= m[i]!, `added voxel ${i}`);
  });
  it('single blob, empty mask, separate islands pass through', () => {
    const d: Dims3 = { nx: 5, ny: 5, nz: 1 };
    const blob = new Uint8Array(25);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) blob[y * 5 + x] = 1;
    const one = watershedSplit(blob, d);
    assert.equal(one.basins, 1);
    assert.equal(one.removed, 0);
    assert.deepEqual([...one.mask], [...blob]);
    const empty = watershedSplit(new Uint8Array(25), d);
    assert.equal(empty.basins, 0);
    assert.equal(empty.removed, 0);
    // two disjoint squares: two basins, zero removal, identical bytes
    const { m, d: d2 } = squares();
    const two = watershedSplit(m, d2);
    assert.equal(two.basins, 2);
    assert.equal(two.removed, 0);
    assert.deepEqual([...two.mask], [...m]);
  });
});
