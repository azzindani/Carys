import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyWindowLevel } from '@carys/volume-core';
import type { Volume } from '@carys/volume-core';
import { mipRotate } from '../mip-rotate.js';

function ramp(dims: [number, number, number]): Volume {
  const [nx, ny, nz] = dims;
  const data = new Float64Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) data[z * nx * ny + y * nx + x] = x + 10 * y + 100 * z;
    }
  }
  return { dims, spacing: [1, 1, 1], origin: [0, 0, 0], dtype: 'float64', data };
}

const WL = { center: 500, width: 1000 };

describe('mip-rotate', () => {
  it('uniform volume renders flat windowed gray at any angle', () => {
    // 7^3 volume under a 5x5 frame: every ray starts inside, so edge-falloff
    // (out-of-bounds pixels render 0, same convention as resliceOblique) cannot
    // trigger and the whole frame must equal the windowed value.
    const v = ramp([7, 7, 7]);
    v.data.fill(444);
    const want = applyWindowLevel(444, WL);
    for (const [angleY, tiltX] of [[0, 0], [0.7, 0.2], [2.1, -0.5]] as Array<[number, number]>) {
      const out = mipRotate(v, { angleY, tiltX, w: 5, h: 5, wl: WL });
      for (let p = 0; p < 25; p++) assert.equal(out[p * 4], want, `angle ${angleY}/${tiltX} pixel ${p}`);
    }
  });
  it('axial zero-rotation rays report exact column maxima', () => {
    const v = ramp([5, 5, 5]); // v = x + 10y + 100z
    // Even frame width puts rays on integer columns: pixel (2,2) -> column
    // (2,2), max at z=4 -> 422.
    const tight = mipRotate(v, { w: 4, h: 4, wl: WL });
    assert.equal(tight[(2 * 4 + 2) * 4], applyWindowLevel(2 + 20 + 400, WL));
    // 6-wide frame covers every column (0..4); output max is the global max.
    const wide = mipRotate(v, { w: 6, h: 6, wl: WL });
    let mx = 0;
    for (let p = 0; p < 36; p++) mx = Math.max(mx, wide[p * 4]!);
    assert.equal(mx, applyWindowLevel(444, WL));
  });
  it('a full turn reproduces the frame exactly', () => {
    const v = ramp([5, 5, 5]);
    const a = mipRotate(v, { angleY: 0.9, tiltX: -0.3, w: 7, h: 7, wl: WL });
    const b = mipRotate(v, { angleY: 0.9 + 2 * Math.PI, tiltX: -0.3, w: 7, h: 7, wl: WL });
    assert.deepEqual([...a], [...b]);
  });
  it('yaw-45 MIP saturates on interior rays, missing corners render 0', () => {
    const data = new Float64Array(5 * 5 * 5);
    for (let i = 0; i < 25; i++) data[4 * 25 + i] = 1000; // bright top slice
    const v: Volume = { dims: [5, 5, 5], spacing: [1, 1, 1], origin: [0, 0, 0], dtype: 'float64', data };
    // Even frame + step sqrt(2): 45-degree rays step voxel-to-voxel exactly.
    const out = mipRotate(v, { angleY: Math.PI / 4, w: 10, h: 10, wl: WL, step: Math.SQRT2 });
    const g = (i: number, j: number): number => out[(j * 10 + i) * 4]!;
    assert.equal(g(5, 5), 255); // central ray crosses a plate voxel dead-center
    assert.equal(g(0, 0), 0); // corner rays never touch the volume
    assert.equal(g(9, 9), 0);
  });
  it('tilt-45 MIP saturates on interior rays, missing corners render 0', () => {
    const data = new Float64Array(5 * 5 * 5);
    for (let i = 0; i < 25; i++) data[4 * 25 + i] = 1000; // bright top slice
    const v: Volume = { dims: [5, 5, 5], spacing: [1, 1, 1], origin: [0, 0, 0], dtype: 'float64', data };
    // Same voxel-to-voxel lattice argument transposed: tilt steps (0,+1,-1).
    const out = mipRotate(v, { tiltX: Math.PI / 4, w: 10, h: 10, wl: WL, step: Math.SQRT2 });
    const g = (i: number, j: number): number => out[(j * 10 + i) * 4]!;
    assert.equal(g(5, 5), 255);
    assert.equal(g(0, 0), 0);
    assert.equal(g(9, 9), 0);
  });
  it('omitted mode is max (back-compat with the MIP-only era)', () => {
    const v = ramp([5, 5, 5]);
    const a = mipRotate(v, { w: 6, h: 6, wl: WL });
    const b = mipRotate(v, { mode: 'max', w: 6, h: 6, wl: WL });
    assert.deepEqual([...a], [...b]);
  });
  it('mode min reports exact column minima at zero rotation', () => {
    const v = ramp([5, 5, 5]); // v = x + 10y + 100z
    // Even frame width puts rays on integer columns: pixel (2,2) -> column
    // (2,2), min at z=0 -> 22.
    const out = mipRotate(v, { mode: 'min', w: 4, h: 4, wl: WL });
    assert.equal(out[(2 * 4 + 2) * 4], applyWindowLevel(2 + 20 + 0, WL));
    const wide = mipRotate(v, { mode: 'min', w: 6, h: 6, wl: WL });
    let mn = 255;
    for (let p = 0; p < 36; p++) mn = Math.min(mn, wide[p * 4]!);
    assert.equal(mn, applyWindowLevel(0, WL));
  });
  it('mode mean is flat on uniform volumes at any angle', () => {
    const v = ramp([7, 7, 7]);
    v.data.fill(444);
    const want = applyWindowLevel(444, WL);
    for (const [angleY, tiltX] of [[0, 0], [0.7, 0.2], [2.1, -0.5]] as Array<[number, number]>) {
      const out = mipRotate(v, { mode: 'mean', angleY, tiltX, w: 5, h: 5, wl: WL });
      for (let p = 0; p < 25; p++) assert.equal(out[p * 4], want, `angle ${angleY}/${tiltX} pixel ${p}`);
    }
  });
  it('mode mean lies strictly inside [min, max] per pixel on a ramp', () => {
    // Proves the mean path averages along rays instead of copying an extremum.
    const v = ramp([5, 5, 5]);
    const opts = { w: 6, h: 6, wl: WL } as const;
    const lo = mipRotate(v, { ...opts, mode: 'min' });
    const mid = mipRotate(v, { ...opts, mode: 'mean' });
    const hi = mipRotate(v, { ...opts, mode: 'max' });
    let strict = 0;
    for (let p = 0; p < 36; p++) {
      const a = lo[p * 4]!, b = mid[p * 4]!, c = hi[p * 4]!;
      assert.ok(b >= a && b <= c, `pixel ${p}: mean ${b} outside [${a}, ${c}]`);
      if (b > a && b < c) strict++;
    }
    assert.ok(strict > 0, 'mean equals an extremum on every ray — not averaging');
  });
});
