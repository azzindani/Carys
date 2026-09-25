import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fillBetweenSlices, type Axis } from '../slice-fill.js';

// Paint every few slices, fill between with the F5
// distance-field interpolation.

type V3 = [number, number, number];
const N = 48;
const DIMS: V3 = [N, N, N];

/** A labelled volume: `label(x, y, z)` at voxel centres, mm = voxels × sp. */
function volume(dims: V3, sp: V3, label: (x: number, y: number, z: number) => number): Uint8Array {
  const [nx, ny, nz] = dims, m = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    m[(z * ny + y) * nx + x] = label((x + 0.5) * sp[0], (y + 0.5) * sp[1], (z + 0.5) * sp[2]);
  }
  return m;
}

/** Slice index of voxel i across an axis. */
const sliceOf = (i: number, dims: V3, a: Axis): number =>
  a === 0 ? i % dims[0] : a === 1 ? Math.floor(i / dims[0]) % dims[1] : Math.floor(i / (dims[0] * dims[1]));

/** Keep every k-th slice across an axis, from the first labelled one; the painted range. */
function paintEvery(truth: Uint8Array, dims: V3, a: Axis, k: number): { m: Uint8Array; first: number; last: number } {
  let first = Infinity;
  for (let i = 0; i < truth.length; i++) if (truth[i]) first = Math.min(first, sliceOf(i, dims, a));
  const m = truth.slice();
  let last = first;
  for (let i = 0; i < m.length; i++) {
    const s = sliceOf(i, dims, a);
    if (s < first || (s - first) % k !== 0) m[i] = 0;
    else if (m[i]) last = Math.max(last, s);
  }
  return { m, first, last };
}

/** Dice of `label` (0: any) between two masks over slices first…last across an axis. */
function dice(a: Uint8Array, b: Uint8Array, dims: V3, ax: Axis, first: number, last: number, label = 0): number {
  let inter = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const s = sliceOf(i, dims, ax);
    if (s < first || s > last) continue;
    const x = label ? a[i] === label : a[i]! > 0, y = label ? b[i] === label : b[i]! > 0;
    if (x) na++; if (y) nb++; if (x && y) inter++;
  }
  return (2 * inter) / (na + nb);
}

const sphere = volume(DIMS, [1, 1, 1], (x, y, z) => (Math.hypot(x - 24, y - 24, z - 24) < 15 ? 1 : 0));
// 16 × 8 × 12 mm semi-axes, turned 35° about y: its outline slides across the slices
const tilted = volume(DIMS, [1, 1, 1], (x, y, z) => {
  const X = x - 24, Y = y - 24, Z = z - 24, c = Math.cos(0.61), s = Math.sin(0.61);
  return ((c * X + s * Z) / 16) ** 2 + (Y / 8) ** 2 + ((-s * X + c * Z) / 12) ** 2 < 1 ? 1 : 0;
});

describe('filling between painted slices (F15)', () => {
  it('rebuilds a sphere painted every 5th and every 8th slice', () => {
    for (const [k, bound] of [[5, 0.98], [8, 0.965]] as const) {
      const { m, first, last } = paintEvery(sphere, DIMS, 2, k);
      const r = fillBetweenSlices(m, DIMS, [1, 1, 1]);
      const d = dice(r.mask, sphere, DIMS, 2, first, last);
      assert.equal(r.axis, 2);
      assert.ok(d >= bound, `every ${k}: Dice ${d.toFixed(4)}`);
      // what was painted is untouched, and nothing beyond the painted range
      for (let i = 0; i < m.length; i++) {
        if (m[i]) assert.equal(r.mask[i], m[i]);
        const s = sliceOf(i, DIMS, 2);
        if (s < first || s > last) assert.equal(r.mask[i], 0);
      }
    }
  });

  it('follows a tilted shape, painted across whichever axis', () => {
    // every 5th slice across x (30 slices deep) and z (26); across y it is
    // 16 slices thin, so every 3rd (6 painted): every 5th leaves 4 and its
    // ends are guesses (Dice 0.94, F5's thin-end limit)
    for (const [ax, k] of [[2, 5], [1, 3], [0, 5]] as [Axis, number][]) {
      const { m, first, last } = paintEvery(tilted, DIMS, ax, k);
      const r = fillBetweenSlices(m, DIMS, [1, 1, 1]);
      const d = dice(r.mask, tilted, DIMS, ax, first, last);
      assert.equal(r.axis, ax, 'the axis the gaps are across');
      assert.ok(d >= 0.97, `axis ${ax}: Dice ${d.toFixed(4)}`);
    }
  });

  it('works in millimetres on anisotropic pixels', () => {
    // the sphere again, on 0.5 × 1 mm pixels (twice the voxels along x)
    const dims: V3 = [96, 48, 48], sp: V3 = [0.5, 1, 1];
    const truth = volume(dims, sp, (x, y, z) => (Math.hypot(x - 24, y - 24, z - 24) < 15 ? 1 : 0));
    const { m, first, last } = paintEvery(truth, dims, 2, 5);
    const d = dice(fillBetweenSlices(m, dims, sp).mask, truth, dims, 2, first, last);
    assert.ok(d >= 0.98, `Dice ${d.toFixed(4)}`);
  });

  it('fills nested labels as one shape, each label kept', () => {
    // a core (1) inside a shell (2), painted together every 5th slice
    const truth = volume(DIMS, [1, 1, 1], (x, y, z) => {
      const r = Math.hypot(x - 24, y - 24, z - 24);
      return r < 7 ? 1 : r < 15 ? 2 : 0;
    });
    const { m, first, last } = paintEvery(truth, DIMS, 2, 5);
    const r = fillBetweenSlices(m, DIMS, [1, 1, 1]);
    assert.deepEqual(r.labels, [1, 2]);
    const all = dice(r.mask, truth, DIMS, 2, first, last), core = dice(r.mask, truth, DIMS, 2, first, last, 1), shell = dice(r.mask, truth, DIMS, 2, first, last, 2);
    assert.ok(all >= 0.98 && core >= 0.9 && shell >= 0.95, `all ${all.toFixed(4)} · core ${core.toFixed(4)} · shell ${shell.toFixed(4)}`);
    for (const v of r.mask) assert.ok(v === 0 || v === 1 || v === 2);
  });

  it('keeps structures painted apart from morphing into each other', () => {
    // label 1 on slices 4…19, label 2 on 28…43, elsewhere in the plane
    const truth = volume(DIMS, [1, 1, 1], (x, y, z) =>
      z > 4 && z < 20 && Math.hypot(x - 14, y - 14) < 6 ? 1 : z > 28 && z < 44 && Math.hypot(x - 34, y - 34) < 6 ? 2 : 0);
    const { m } = paintEvery(truth, DIMS, 2, 4);
    const r = fillBetweenSlices(m, DIMS, [1, 1, 1]);
    for (let i = 0; i < r.mask.length; i++) {
      const z = sliceOf(i, DIMS, 2);
      if (z > 20 && z < 28) assert.equal(r.mask[i], 0, `slice ${z} gained a voxel between the two`);
    }
    // painted 5, 9, 13, 17 and 29, 33, 37, 41: each filled within its own
    const d1 = dice(r.mask, truth, DIMS, 2, 5, 17, 1), d2 = dice(r.mask, truth, DIMS, 2, 29, 41, 2);
    assert.ok(d1 > 0.95 && d2 > 0.95, `label 1 ${d1.toFixed(4)} · label 2 ${d2.toFixed(4)}`);
  });

  it('fills across the painted axis, the sparse one, not the most gapped', () => {
    // bars on axial slices 10 and 16 (overlapping in the plane), and a
    // speck on 16 further on: 9 empty rows along y against 5 empty slices
    // along z, but z is 5 of 7 empty, y 9 of 27
    const m = new Uint8Array(N * N * N);
    for (let x = 10; x < 38; x++) {
      for (let y = 20; y < 30; y++) m[(10 * N + y) * N + x] = 1;
      for (let y = 26; y < 36; y++) m[(16 * N + y) * N + x] = 1;
    }
    m[(16 * N + 45) * N + 20] = 1; m[(16 * N + 46) * N + 20] = 1;
    const r = fillBetweenSlices(m, DIMS, [1, 1, 1]);
    assert.equal(r.axis, 2);
    assert.equal(r.slices, 5);
  });

  it('never overwrites a voxel another label holds', () => {
    const { m } = paintEvery(sphere, DIMS, 2, 5);
    const i = (22 * N + 24) * N + 24; // inside the sphere, on an unpainted slice
    m[i] = 3;
    assert.equal(fillBetweenSlices(m, DIMS, [1, 1, 1]).mask[i], 3);
  });

  it('keeps what both neighbouring painted slices hold (30 random masks)', () => {
    // noise painted every k-th slice: whatever the cubic does, a pixel in
    // on both sides of a gap is in across it, and painted slices stay
    let seed = 6161;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let c = 0; c < 30; c++) {
      const dims: V3 = [6 + Math.floor(rnd() * 8), 6 + Math.floor(rnd() * 8), 8 + Math.floor(rnd() * 8)];
      const [nx, ny, nz] = dims, k = 2 + Math.floor(rnd() * 3), plane = nx * ny;
      const m = new Uint8Array(nx * ny * nz);
      for (let z = 0; z < nz; z += k) for (let i = 0; i < plane; i++) m[z * plane + i] = rnd() < 0.4 ? 1 : 0;
      const r = fillBetweenSlices(m, dims, [1, 1, 1], { axis: 2 });
      for (let z = 0; z < nz; z++) {
        const z0 = z - (z % k), z1 = z0 + k;
        for (let i = 0; i < plane; i++) {
          if (z === z0) assert.equal(r.mask[z * plane + i], m[z * plane + i], `case ${c}: a painted slice changed`);
          else if (z1 < nz && m[z0 * plane + i] && m[z1 * plane + i]) assert.equal(r.mask[z * plane + i], 1, `case ${c}: a hole between two painted pixels`);
        }
      }
    }
  });

  it('with nothing to fill, says so', () => {
    const r = fillBetweenSlices(sphere, DIMS, [1, 1, 1]);
    assert.equal(r.slices, 0);
    assert.equal(r.voxels, 0);
    assert.deepEqual(r.mask, sphere);
    assert.throws(() => fillBetweenSlices(new Uint8Array(10), DIMS, [1, 1, 1]), /slice-fill-dims/);
  });
});
