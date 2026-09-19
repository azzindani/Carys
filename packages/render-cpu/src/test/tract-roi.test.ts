import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterTracts, tractProfile } from '../tract-roi.js';

// two streamlines: s0 along x at y=0, s1 along x at y=10 (z=0 both)
const pts = new Float32Array([0, 0, 0, 5, 0, 0, 10, 0, 0, 0, 10, 0, 5, 10, 0, 10, 10, 0]);
const off = new Uint32Array([0, 3, 6]);

describe('tract roi', () => {
  it('waypoint keeps passers, exclusion vetoes, empty keeps all', () => {
    assert.deepEqual(filterTracts(pts, off, [{ center: [5, 0, 0], radius: 2 }], []), [0]);
    assert.deepEqual(filterTracts(pts, off, [], [{ center: [5, 0, 0], radius: 2 }]), [1]);
    assert.deepEqual(filterTracts(pts, off, [], []), [0, 1]);
    // both waypoints on different tracts = nothing passes both
    assert.deepEqual(filterTracts(pts, off,
      [{ center: [5, 0, 0], radius: 2 }, { center: [5, 10, 0], radius: 2 }], []), []);
  });
  it('bad ROIs throw named errors', () => {
    assert.throws(() => filterTracts(pts, off, [{ center: [0, 0, 0], radius: 0 }], []), /tract-roi-radius/);
    assert.throws(() => filterTracts(pts, off, [], [{ center: [NaN, 0, 0], radius: 1 }]), /tract-roi-center/);
  });
  it('profile averages resampled scalars, bad inputs loud', () => {
    const scalars = new Float32Array([0, 1, 2, 10, 11, 12]);
    const p = tractProfile(pts, off, scalars, [0], 3);
    assert.equal(p.length, 3);
    assert.ok(Math.abs(p[0]! - 0) < 1e-9 && Math.abs(p[2]! - 2) < 1e-9);
    assert.ok(Math.abs(p[1]! - 1) < 1e-9);
    const both = tractProfile(pts, off, scalars, [0, 1], 3);
    assert.ok(Math.abs(both[0]! - 5) < 1e-9); // (0+10)/2
    assert.throws(() => tractProfile(pts, off, new Float32Array(3), [0]), /tract-profile-scalars/);
    assert.throws(() => tractProfile(pts, off, scalars, [0], 1), /tract-profile-samples/);
    assert.throws(() => tractProfile(pts, off, scalars, [9]), /tract-profile-streamline/);
  });
});
