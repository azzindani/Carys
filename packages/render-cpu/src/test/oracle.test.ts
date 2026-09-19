import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Volume, WindowLevel } from '@carys/volume-core';
import { applyWindowLevel } from '@carys/volume-core';
import { reslice, type Plane } from '../mpr.js';
import { obliqueBasis, resliceOblique, sampleTrilinear } from '../oblique.js';
import { slabMask, slabProject } from '../slab.js';
import { mulberry32, randInt } from './rng.js';

// Independent oracle: deliberately different loop order and indexing from
// mpr.ts so agreement means correctness, not shared bugs.
function oracleSlice(vol: Volume, plane: Plane, index: number, wl: WindowLevel): Uint8ClampedArray {
  const [nx, ny, nz] = vol.dims;
  const order: [number, number, number][] = [];
  if (plane === 'axial') {
    for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) order.push([x, y, index]);
  } else if (plane === 'coronal') {
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) order.push([x, index, z]);
  } else {
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) order.push([index, y, z]);
  }
  const w = plane === 'axial' ? nx : plane === 'coronal' ? nx : ny;
  const h = plane === 'axial' ? ny : nz;
  const out = new Uint8ClampedArray(w * h * 4);
  order.forEach(([x, y, z], k) => {
    const g = applyWindowLevel(vol.data[z * nx * ny + y * nx + x] as number, wl);
    // note: k-th push order == row-major (j*w+i) by construction above
    const i = plane === 'sagittal' ? y : x;
    const j = plane === 'axial' ? y : z;
    const o = (j * w + i) * 4;
    out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
    void k;
  });
  return out;
}

function randVol(rng: () => number): Volume {
  const nx = randInt(rng, 2, 9), ny = randInt(rng, 2, 9), nz = randInt(rng, 2, 9);
  const data = new Float64Array(nx * ny * nz);
  for (let i = 0; i < data.length; i++) data[i] = randInt(rng, -500, 1500);
  return { dims: [nx, ny, nz], spacing: [1, 1, 1], origin: [0, 0, 0], dtype: 'float64', data };
}

const WL: WindowLevel = { center: 200, width: 800 };
const PLANES: Plane[] = ['axial', 'coronal', 'sagittal'];

describe('reslice oracle', () => {
  it('matches the independent oracle on 72 random volumes', () => {
    const rng = mulberry32(9001);
    for (let t = 0; t < 72; t++) {
      const v = randVol(rng);
      const plane = PLANES[t % 3]!;
      const depth = plane === 'axial' ? v.dims[2] : plane === 'coronal' ? v.dims[1] : v.dims[0];
      const idx = randInt(rng, 0, depth - 1);
      assert.deepEqual(reslice(v, plane, idx, WL), oracleSlice(v, plane, idx, WL), `case ${t} ${plane}[${idx}]`);
    }
  });
});

describe('slab sweep', () => {
  it('all modes x thicknesses 1..16 stay in range', () => {
    const rng = mulberry32(777);
    for (const mode of ['mip', 'minip', 'mean'] as const) {
      for (let th = 1; th <= 16; th++) {
        const v = randVol(rng);
        const out = slabProject(v, 'axial', 2, th, mode, WL);
        assert.equal(out.length, v.dims[0] * v.dims[1] * 4, `${mode}/${th}`);
        for (let i = 3; i < out.length; i += 4) assert.equal(out[i], 255, `${mode}/${th} alpha`);
        for (let i = 0; i < out.length; i += 4) {
          assert.ok(out[i]! >= 0 && out[i]! <= 255, `${mode}/${th}`);
        }
      }
    }
  });
  it('thickness-1 equals the slice (24 volumes)', () => {
    const rng = mulberry32(778);
    for (let t = 0; t < 24; t++) {
      const v = randVol(rng);
      const plane = PLANES[t % 3]!;
      const depth = plane === 'axial' ? v.dims[2] : plane === 'coronal' ? v.dims[1] : v.dims[0];
      const idx = randInt(rng, 0, depth - 1);
      for (const mode of ['mip', 'minip', 'mean'] as const) {
        assert.deepEqual(slabProject(v, plane, idx, 1, mode, WL), reslice(v, plane, idx, WL), `case ${t} ${mode}`);
      }
    }
  });
  it('slabMask is binary and pins known voxels', () => {
    const rng = mulberry32(779);
    for (let t = 0; t < 30; t++) {
      const v = randVol(rng);
      const [nx, ny, nz] = v.dims;
      void nz;
      const mask = new Uint8Array(nx * ny * nz);
      for (let i = 0; i < mask.length; i++) mask[i] = rng() < 0.2 ? 1 : 0;
      // plant a voxel guaranteed inside slab [0..2] at axial slice z=1
      mask[1 * nx * ny + 0 * nx + 0] = 1;
      const m = slabMask(mask, v.dims, 'axial', 1, 3);
      assert.equal(m.length, nx * ny, `case ${t}`);
      for (const x of m) assert.ok(x === 0 || x === 1, `case ${t}`);
      assert.equal(m[0], 1, `case ${t} planted voxel`);
    }
  });
});

describe('oblique grid', () => {
  it('basis orthonormal over the 75-combo angle grid', () => {
    const angs = [-0.5, -0.25, 0, 0.25, 0.5];
    for (const plane of PLANES) {
      for (const a of angs) {
        for (const b of angs) {
          const { row, col, normal } = obliqueBasis(plane, a, b);
          const dot = (p: number[], q: number[]): number => p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!;
          const id = `${plane} a=${a} b=${b}`;
          for (const v of [row, col, normal]) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9, id);
          assert.ok(Math.abs(dot(row, col)) < 1e-9, id);
          assert.ok(Math.abs(dot(row, normal)) < 1e-9, id);
          assert.ok(Math.abs(dot(col, normal)) < 1e-9, id);
        }
      }
    }
  });
  it('trilinear exact on linear fields (40 probes)', () => {
    const rng = mulberry32(31337);
    for (let t = 0; t < 40; t++) {
      const nx = 6, ny = 7, nz = 5;
      const data = new Float64Array(nx * ny * nz);
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) data[z * nx * ny + y * nx + x] = 2 * x + 3 * y + 5 * z + 1;
        }
      }
      const x = rng() * (nx - 1), y = rng() * (ny - 1), z = rng() * (nz - 1);
      const got = sampleTrilinear(data, [nx, ny, nz], [x, y, z]);
      assert.ok(Math.abs(got! - (2 * x + 3 * y + 5 * z + 1)) < 1e-9, `case ${t}: ${got}`);
    }
  });
  it('oblique zero-angle bit-matches the slice (12 sizes)', () => {
    for (let t = 0; t < 12; t++) {
      // Smooth sinusoidal field: trilinear interpolation is near-exact, so
      // the oblique frame must reproduce the orthogonal slice within a few
      // gray levels (random speckle would punish interpolation itself).
      const nx = 6 + (t % 4), ny = 7, nz = 6;
      const data = new Float64Array(nx * ny * nz);
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            data[z * nx * ny + y * nx + x] =
              500 + 200 * Math.sin(x / 2) * Math.cos(y / 3) + 100 * Math.sin(z / 2);
          }
        }
      }
      const v: Volume = { dims: [nx, ny, nz], spacing: [1, 1, 1], origin: [0, 0, 0], dtype: 'float64', data };
      const { row, col } = obliqueBasis('axial', 0, 0);
      const idx = Math.floor(nz / 2);
      // Center [nx/2, ny/2] on an nx*ny canvas lands every pixel exactly on a
      // voxel (i - nx/2 + nx/2 = i); trilinear at integers is exact, so the
      // oblique frame must equal the orthogonal slice bit-for-bit.
      const out = resliceOblique(v, [nx / 2, ny / 2, idx], row, col, nx, ny, WL);
      assert.deepEqual(out, reslice(v, 'axial', idx, WL), `size set ${t}`);
    }
  });
});
