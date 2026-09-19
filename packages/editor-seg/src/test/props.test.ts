import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRLE, drawPenLine, drawPt, encodeRLE, floodFill } from '../drawing.js';
import { fillHoles } from '../fillholes.js';
import { interpolateSlices } from '../interp.js';
import { islandSizes } from '../islands.js';
import { close, countVoxels, dilate, erode, open } from '../morph.js';
import { regionGrow } from '../ops.js';
import type { Dims3 } from '../morph.js';
import { mulberry32, randInt } from './rng.js';

function randMask(rng: () => number, d: Dims3, p: number): Uint8Array {
  const m = new Uint8Array(d.nx * d.ny * d.nz);
  for (let i = 0; i < m.length; i++) m[i] = rng() < p ? 1 : 0;
  return m;
}

function subset(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] && !b[i]) return false;
  }
  return true;
}

describe('morphology laws', () => {
  it('erode ⊆ x ⊆ dilate over 40 random masks', () => {
    const rng = mulberry32(20240);
    for (let t = 0; t < 40; t++) {
      const d: Dims3 = { nx: randInt(rng, 3, 8), ny: randInt(rng, 3, 8), nz: randInt(rng, 3, 8) };
      const m = randMask(rng, d, 0.15 + rng() * 0.5);
      assert.ok(subset(erode(m, d, 1), m), `case ${t}`);
      assert.ok(subset(m, dilate(m, d, 1)), `case ${t}`);
    }
  });
  it('open anti-extensive, close extensive on the interior (40 masks)', () => {
    const rng = mulberry32(20241);
    for (let t = 0; t < 40; t++) {
      const d: Dims3 = { nx: randInt(rng, 3, 8), ny: randInt(rng, 3, 8), nz: randInt(rng, 3, 8) };
      const m = randMask(rng, d, 0.15 + rng() * 0.5);
      assert.ok(subset(open(m, d, 1), m), `case ${t}: open must be anti-extensive`);
      // close() is extensive only away from the volume border: erosion
      // treats out-of-bounds as empty, so border voxels may not survive.
      const interior = m.slice();
      for (let z = 0; z < d.nz; z++) {
        for (let y = 0; y < d.ny; y++) {
          for (let x = 0; x < d.nx; x++) {
            if (x === 0 || y === 0 || z === 0 || x === d.nx - 1 || y === d.ny - 1 || z === d.nz - 1) {
              interior[z * d.nx * d.ny + y * d.nx + x] = 0;
            }
          }
        }
      }
      assert.ok(subset(interior, close(m, d, 1)), `case ${t}: close must be extensive on the interior`);
    }
  });
  it('open/close idempotent (30 masks)', () => {
    const rng = mulberry32(20242);
    for (let t = 0; t < 30; t++) {
      const d: Dims3 = { nx: 7, ny: 7, nz: 7 };
      const m = randMask(rng, d, 0.4);
      assert.deepEqual(open(open(m, d, 1), d, 1), open(m, d, 1));
      assert.deepEqual(close(close(m, d, 1), d, 1), close(m, d, 1));
    }
  });
  it('iterations monotonic (30 masks)', () => {
    const rng = mulberry32(20243);
    for (let t = 0; t < 30; t++) {
      const d: Dims3 = { nx: 8, ny: 8, nz: 8 };
      const m = randMask(rng, d, 0.6);
      const e1 = countVoxels(erode(m, d, 1));
      const e2 = countVoxels(erode(m, d, 2));
      assert.ok(e2 <= e1, `case ${t}: ${e2} > ${e1}`);
      const d1 = countVoxels(dilate(m, d, 1));
      const d2 = countVoxels(dilate(m, d, 2));
      assert.ok(d2 >= d1, `case ${t}: ${d2} < ${d1}`);
    }
  });
});

describe('islands partition', () => {
  it('sizes sum to count and sort descending (40 masks)', () => {
    const rng = mulberry32(5150);
    for (let t = 0; t < 40; t++) {
      const d: Dims3 = { nx: randInt(rng, 3, 9), ny: randInt(rng, 3, 9), nz: randInt(rng, 2, 6) };
      const m = randMask(rng, d, 0.3);
      const sizes = islandSizes(m, d);
      const sum = sizes.reduce((a, s) => a + s.size, 0);
      assert.equal(sum, countVoxels(m), `case ${t}`);
      for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i - 1]!.size >= sizes[i]!.size, `case ${t}`);
    }
  });
});

describe('interp endpoints', () => {
  it('t=0/1 exact, mid bounded by union/intersection (40 pairs)', () => {
    const rng = mulberry32(6161);
    for (let t = 0; t < 40; t++) {
      const w = randInt(rng, 4, 12), h = randInt(rng, 4, 12);
      const a = new Uint8Array(w * h);
      const b = new Uint8Array(w * h);
      for (let i = 0; i < a.length; i++) {
        a[i] = rng() < 0.4 ? 1 : 0;
        b[i] = rng() < 0.4 ? 1 : 0;
      }
      assert.deepEqual(interpolateSlices(a, b, w, h, 0), a);
      assert.deepEqual(interpolateSlices(a, b, w, h, 1), b);
      const mid = interpolateSlices(a, b, w, h, 0.5);
      assert.equal(mid.length, a.length, `case ${t}`);
      for (let i = 0; i < mid.length; i++) {
        if (a[i] && b[i]) assert.equal(mid[i], 1, `case ${t}: intersection must survive`);
        if (!a[i] && !b[i]) assert.equal(mid[i], 0, `case ${t}: outside union must stay empty`);
      }
    }
  });
});

describe('rle fuzz', () => {
  it('round-trips 60 streams (zeros/ones/noise/periodic)', () => {
    const rng = mulberry32(7171);
    for (let t = 0; t < 60; t++) {
      const n = randInt(rng, 1, 2000);
      const m = new Uint8Array(n);
      const mode = t % 4;
      for (let i = 0; i < n; i++) {
        m[i] = mode === 0 ? 0 : mode === 1 ? 1 : mode === 2 ? (rng() < 0.5 ? 1 : 0) : i % 3 === 0 ? 1 : 0;
      }
      assert.deepEqual(decodeRLE(encodeRLE(m), n), m, `case ${t}`);
    }
  });
});

describe('region grow containment', () => {
  it('grown voxels all lie in the window (30 fields)', () => {
    const rng = mulberry32(8181);
    for (let t = 0; t < 30; t++) {
      const nx = 8, ny = 8, nz = 8;
      const data = new Float64Array(nx * ny * nz);
      for (let i = 0; i < data.length; i++) data[i] = randInt(rng, 0, 100);
      const vol = { dims: [nx, ny, nz] as [number, number, number], spacing: [1, 1, 1] as [number, number, number], origin: [0, 0, 0] as [number, number, number], dtype: 'float64' as const, data };
      const lo = randInt(rng, 0, 60), hi = lo + randInt(rng, 0, 40);
      const g = regionGrow(vol, [randInt(rng, 0, 7), randInt(rng, 0, 7), randInt(rng, 0, 7)], lo, hi);
      for (let i = 0; i < g.length; i++) {
        if (g[i]) assert.ok(data[i]! >= lo && data[i]! <= hi, `case ${t}: leak ${data[i]} outside [${lo},${hi}]`);
      }
    }
  });
});

describe('fill holes + drawing', () => {
  it('fillHoles never clears labels (30 masks)', () => {
    const rng = mulberry32(9191);
    for (let t = 0; t < 30; t++) {
      const nx = 10, ny = 10, nz = 3;
      const m = new Uint8Array(nx * ny * nz);
      for (let i = 0; i < m.length; i++) m[i] = rng() < 0.5 ? 1 : 0;
      const f = fillHoles(m, nx, ny, nz);
      for (let i = 0; i < m.length; i++) {
        if (m[i]) assert.equal(f[i], m[i], `case ${t}[${i}]`);
      }
    }
  });
  it('pen lines are 8-connected end to end (30 strokes)', () => {
    const rng = mulberry32(9192);
    for (let t = 0; t < 30; t++) {
      const m = new Uint8Array(12 * 12 * 4);
      const a: [number, number, number] = [randInt(rng, 0, 11), randInt(rng, 0, 11), randInt(rng, 0, 3)];
      const b: [number, number, number] = [randInt(rng, 0, 11), randInt(rng, 0, 11), a[2]];
      drawPenLine(m, 12, 12, 4, a, b, 1);
      assert.equal(m[a[2] * 144 + a[1] * 12 + a[0]], 1, `case ${t} start`);
      assert.equal(m[b[2] * 144 + b[1] * 12 + b[0]], 1, `case ${t} end`);
      // continuity: every painted voxel touches another painted voxel
      const pts: [number, number][] = [];
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) if (m[a[2] * 144 + y * 12 + x]) pts.push([x, y]);
      }
      assert.ok(pts.length >= 2, `case ${t}`);
      for (const [x, y] of pts) {
        let touched = pts.length === 1;
        for (const [ox, oy] of pts) {
          if ((ox !== x || oy !== y) && Math.abs(ox - x) <= 1 && Math.abs(oy - y) <= 1) { touched = true; break; }
        }
        assert.ok(touched, `case ${t}: isolated voxel at ${x},${y}`);
      }
      drawPt(m, 12, 12, 4, -5, -5, 0, 1); // out of bounds: no crash, no write
      assert.equal(countVoxels(m) >= 2, true, `case ${t}`);
    }
  });
  it('floodFill fills bounded region', () => {
    const m = new Uint8Array(6 * 6 * 1);
    const intensity = new Float64Array(36).fill(50);
    // border walls
    for (let x = 0; x < 6; x++) { m[x] = 9; m[5 * 6 + x] = 9; }
    for (let y = 0; y < 6; y++) { m[y * 6] = 9; m[y * 6 + 5] = 9; }
    floodFill(m, intensity, 6, 6, 1, [2, 2, 0], 7, 0, 100);
    assert.equal(m[2 * 6 + 2], 7);
    assert.equal(m[0], 9); // wall untouched
  });
});
