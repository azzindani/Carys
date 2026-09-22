import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyWindowLevel } from '@carys/volume-core';
import { reslice } from '../mpr.js';
import { obliqueBasis, resliceOblique, sampleTrilinear } from '../oblique.js';
import { slabMask, slabProject, slabRange } from '../slab.js';
import type { Volume } from '@carys/volume-core';

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

describe('slab', () => {
  it('ranges clamp to the volume', () => {
    assert.deepEqual(slabRange(10, 5, 3), { k0: 4, k1: 6 });
    assert.deepEqual(slabRange(10, 0, 5), { k0: 0, k1: 4 });
    assert.deepEqual(slabRange(10, 9, 5), { k0: 5, k1: 9 });
    assert.deepEqual(slabRange(4, 2, 99), { k0: 0, k1: 3 });
  });
  it('thickness 1 reproduces the orthogonal slice', () => {
    const v = ramp([6, 5, 7]);
    for (const mode of ['mip', 'minip', 'mean'] as const) {
      assert.deepEqual(slabProject(v, 'axial', 3, 1, mode, WL), reslice(v, 'axial', 3, WL));
      assert.deepEqual(slabProject(v, 'coronal', 2, 1, mode, WL), reslice(v, 'coronal', 2, WL));
      assert.deepEqual(slabProject(v, 'sagittal', 4, 1, mode, WL), reslice(v, 'sagittal', 4, WL));
    }
  });
  it('mip/minip/mean project exact ramp values', () => {
    const v = ramp([4, 3, 5]); // v = x + 10y + 100z
    const mip = slabProject(v, 'axial', 2, 3, 'mip', WL); // z=1..3
    const g = (i: number, j: number): number => mip[(j * 4 + i) * 4]!;
    // max at z=3: v = x+10y+300
    assert.equal(g(1, 2), applyWindowLevel(1 + 20 + 300, WL));
    const mn = slabProject(v, 'axial', 2, 3, 'minip', WL);
    assert.equal(mn[((2 * 4 + 1) * 4)]!, applyWindowLevel(1 + 20 + 100, WL));
    const me = slabProject(v, 'axial', 2, 3, 'mean', WL);
    assert.equal(me[((2 * 4 + 1) * 4)]!, applyWindowLevel(1 + 20 + 200, WL));
  });
  it('slabMask reports any-label-wins', () => {
    const mask = new Uint8Array(4 * 3 * 5);
    mask[2 * 4 * 3 + 1 * 4 + 0] = 1; // z=2, y=1, x=0
    const m = slabMask(mask, [4, 3, 5], 'axial', 2, 3);
    assert.equal(m[1 * 4 + 0], 1);
    assert.equal(m[0], 0);
    const empty = slabMask(new Uint8Array(4 * 3 * 5), [4, 3, 5], 'axial', 0, 1);
    assert.ok(empty.every((v) => v === 0));
  });
});

describe('oblique', () => {
  it('trilinear hits voxels and rejects outside', () => {
    const v = ramp([4, 4, 4]);
    assert.equal(sampleTrilinear(v.data, v.dims, [1, 1, 1]), 111);
    assert.equal(sampleTrilinear(v.data, v.dims, [1.5, 0, 0]), 1.5);
    assert.equal(sampleTrilinear(v.data, v.dims, [-0.1, 0, 0]), null);
    assert.equal(sampleTrilinear(v.data, v.dims, [0, 0, 4]), null);
  });
  it('zero rotation reproduces the orthogonal slice', () => {
    const v = ramp([9, 7, 8]);
    const { row, col } = obliqueBasis('axial', 0, 0);
    const [nx, ny] = v.dims;
    const wb = Math.ceil(nx) + 1, hb = Math.ceil(ny) + 1;
    // center the plane on voxel (4,3,5) with unit basis
    const out = resliceOblique(v, [4, 3, 5], row, col, wb, hb, WL);
    const ref = reslice(v, 'axial', 5, WL);
    // compare the overlapping interior (oblique canvas is centered, may differ by half-px framing)
    let same = 0, total = 0;
    for (let j = 1; j < hb - 1; j++) {
      for (let i = 1; i < wb - 1; i++) {
        const a = out[(j * wb + i) * 4]!;
        // map oblique canvas coords back to volume coords
        const vx = Math.round(4 + (i - wb / 2) * row[0] + (j - hb / 2) * col[0]);
        const vy = Math.round(3 + (i - wb / 2) * row[1] + (j - hb / 2) * col[1]);
        if (vx < 0 || vy < 0 || vx >= nx || vy >= ny) continue;
        const b = ref[(vy * nx + vx) * 4]!;
        total++;
        if (Math.abs(a - b) <= 1) same++;
      }
    }
    assert.ok(total > 20, `overlap too small: ${total}`);
    assert.ok(same / total > 0.95, `mismatch ${same}/${total}`);
  });
  it('basis stays orthonormal under rotation', () => {
    for (const plane of ['axial', 'coronal', 'sagittal'] as const) {
      const { row, col, normal } = obliqueBasis(plane, 0.4, -0.3);
      const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
      const len = (a: number[]): number => Math.hypot(a[0]!, a[1]!, a[2]!);
      assert.ok(Math.abs(len(row) - 1) < 1e-9);
      assert.ok(Math.abs(len(col) - 1) < 1e-9);
      assert.ok(Math.abs(len(normal) - 1) < 1e-9);
      assert.ok(Math.abs(dot(row, col)) < 1e-9);
      assert.ok(Math.abs(dot(row, normal)) < 1e-9);
    }
  });
  it('fully outside planes render black', () => {
    const v = ramp([6, 6, 6]);
    const out = resliceOblique(v, [100, 100, 100], [1, 0, 0], [0, 1, 0], 8, 8, WL);
    assert.ok(out.every((x, i) => (i % 4 === 3 ? x === 255 : x === 0)));
  });
});
