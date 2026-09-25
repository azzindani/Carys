import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { labelOutlines, labelSlice, labelSliceOblique, planeGrid, RUN, slabLabels, tintLabels } from '../labels.js';
import { slabMask } from '../slab.js';
import { obliqueBasis } from '../oblique.js';
import type { Plane } from '../mpr.js';

// Segmentation outlines in the 2D panes, a colour
// per label.

type V3 = [number, number, number];
const PLANES: Plane[] = ['axial', 'coronal', 'sagittal'];

/** A small multi-label volume: blobs of labels 1, 2 and 4, and specks. */
function labelled(dims: V3, seed: number): Uint8Array {
  const [nx, ny, nz] = dims;
  const m = new Uint8Array(nx * ny * nz);
  let s = seed;
  const rnd = (): number => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = (z * ny + y) * nx + x;
    if (Math.hypot(x - nx * 0.4, y - ny * 0.5, z - nz * 0.5) < nx * 0.25) m[i] = 1;
    if (Math.hypot(x - nx * 0.62, y - ny * 0.45, z - nz * 0.5) < nx * 0.2) m[i] = 2;
    if (Math.hypot(x - nx * 0.5, y - ny * 0.6, z - nz * 0.45) < nx * 0.1) m[i] = 4;
    if (rnd() < 0.02) m[i] = 1 + Math.floor(rnd() * 4);
  }
  return m;
}

/** Every unit voxel edge a label's outline must hold, as "x,y,h|v,side". */
function bruteEdges(L: ArrayLike<number>, W: number, H: number): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? 0 : L[y * W + x]!);
  const add = (v: number, key: string): void => { if (v > 0) { if (!out.has(v)) out.set(v, new Set()); out.get(v)!.add(key); } };
  for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) {
    const a = at(x, y - 1), b = at(x, y);
    if (a !== b) { add(a, `${x},${y},h,-1`); add(b, `${x},${y},h,1`); }
  }
  for (let x = 0; x <= W; x++) for (let y = 0; y < H; y++) {
    const a = at(x - 1, y), b = at(x, y);
    if (a !== b) { add(a, `${x},${y},v,-1`); add(b, `${x},${y},v,1`); }
  }
  return out;
}

/** The runs cut back into unit edges, in bruteEdges' keys. */
function unitEdges(runs: Float32Array): string[] {
  const keys: string[] = [];
  for (let r = 0; r < runs.length; r += RUN) {
    const [x0, y0, x1, y1, nx, ny] = [runs[r]!, runs[r + 1]!, runs[r + 2]!, runs[r + 3]!, runs[r + 4]!, runs[r + 5]!];
    if (y0 === y1) for (let x = x0; x < x1; x++) keys.push(`${x},${y0},h,${ny}`);
    else for (let y = y0; y < y1; y++) keys.push(`${x0},${y},v,${nx}`);
  }
  return keys;
}

describe('label slices (F14)', () => {
  const dims: V3 = [9, 7, 5];
  const m = labelled(dims, 3);

  it('read the pane grid the image reslice fills', () => {
    const [nx, ny] = dims;
    for (const plane of PLANES) {
      const [W, H] = planeGrid(dims, plane);
      const idx = 2;
      const s = labelSlice(m, dims, plane, idx);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        // MprPanes' own indexing, before F14 moved it here
        const v = plane === 'axial' ? m[idx * nx * ny + j * nx + i] : plane === 'coronal' ? m[j * nx * ny + idx * nx + i] : m[j * nx * ny + i * nx + idx];
        assert.equal(s[j * W + i], v);
      }
    }
  });

  it('an untilted oblique slice is the plain one', () => {
    const [nx, ny] = dims;
    const { row, col } = obliqueBasis('axial', 0, 0);
    assert.deepEqual(labelSliceOblique(m, dims, [nx / 2, ny / 2, 3], row, col, nx, ny), labelSlice(m, dims, 'axial', 3));
  });

  it('a slab shows the label nearest its centre, where slabMask shows any', () => {
    for (const plane of PLANES) {
      const s = slabLabels(m, dims, plane, 2, 3);
      const any = slabMask(m, dims, plane, 2, 3);
      for (let p = 0; p < s.length; p++) assert.equal(s[p]! > 0 ? 1 : 0, any[p]);
      // where the centre slice is labelled, the slab shows that label
      const mid = labelSlice(m, dims, plane, 2);
      for (let p = 0; p < s.length; p++) if (mid[p]! > 0) assert.equal(s[p], mid[p]);
    }
  });
});

describe('label outlines (F14)', () => {
  it('a voxel has four sides, each facing into it', () => {
    const L = new Uint8Array(9);
    L[4] = 3;
    const o = labelOutlines(L, 3, 3);
    assert.deepEqual([...o.keys()], [3]);
    const runs = o.get(3)!;
    assert.equal(runs.length, 4 * RUN);
    for (let r = 0; r < runs.length; r += RUN) {
      // the run's midpoint stepped a quarter voxel along its normal is inside
      const mx = (runs[r]! + runs[r + 2]!) / 2 + runs[r + 4]! / 4, my = (runs[r + 1]! + runs[r + 3]!) / 2 + runs[r + 5]! / 4;
      assert.equal(L[Math.floor(my) * 3 + Math.floor(mx)], 3);
    }
  });

  it('a rectangle is four runs, touching labels each keep the shared edge', () => {
    // 1 1 1 2
    // 1 1 1 2
    const L = Uint8Array.from([1, 1, 1, 2, 1, 1, 1, 2]);
    const o = labelOutlines(L, 4, 2);
    assert.equal(o.get(1)!.length, 4 * RUN, 'label 1: top, bottom, left, the shared right');
    assert.equal(o.get(2)!.length, 4 * RUN);
    const shared = (v: number): number[] => {
      const r = o.get(v)!;
      for (let k = 0; k < r.length; k += RUN) if (r[k] === 3 && r[k + 2] === 3) return [...r.subarray(k, k + RUN)];
      return [];
    };
    assert.deepEqual(shared(1), [3, 0, 3, 2, -1, 0], 'label 1 lies to its left');
    assert.deepEqual(shared(2), [3, 0, 3, 2, 1, 0], 'label 2 to its right');
  });

  it('hold exactly the voxel edges between labels, in maximal runs', () => {
    for (const plane of PLANES) {
      const dims: V3 = [40, 34, 28];
      const [W, H] = planeGrid(dims, plane);
      const L = labelSlice(labelled(dims, 11), dims, plane, 13);
      const want = bruteEdges(L, W, H), got = labelOutlines(L, W, H);
      assert.deepEqual([...got.keys()], [...want.keys()].sort((a, b) => a - b));
      for (const [v, runs] of got) {
        const keys = unitEdges(runs);
        assert.equal(new Set(keys).size, keys.length, `label ${v}: an edge twice`);
        assert.deepEqual(new Set(keys), want.get(v), `${plane} label ${v}`);
        // maximal: no run ends where another of the same label, line and side begins
        const ends = new Set<string>();
        for (let r = 0; r < runs.length; r += RUN) ends.add(`${runs[r + 2]},${runs[r + 3]},${runs[r + 4]},${runs[r + 5]},${runs[r] === runs[r + 2]}`);
        for (let r = 0; r < runs.length; r += RUN) assert.ok(!ends.has(`${runs[r]},${runs[r + 1]},${runs[r + 4]},${runs[r + 5]},${runs[r] === runs[r + 2]}`), 'a run split in two');
      }
    }
  });
});

describe('label tint (F14)', () => {
  const lut = new Uint8Array(256 * 3);
  lut.set([255, 60, 60], 3); lut.set([70, 200, 90], 6);
  const gray = (): Uint8ClampedArray => { const a = new Uint8ClampedArray(4 * 4); for (let i = 0; i < 16; i++) a[i] = i % 4 === 3 ? 255 : 100; return a; };

  it('at alpha 1 is the old opaque fill, label for label', () => {
    const a = gray();
    tintLabels(a, [0, 1, 2, 0], lut, 1);
    assert.deepEqual([...a], [100, 100, 100, 255, 255, 60, 60, 255, 70, 200, 90, 255, 100, 100, 100, 255]);
  });

  it('below 1 mixes the colour in', () => {
    const a = gray();
    tintLabels(a, [0, 1, 0, 0], lut, 0.25);
    assert.deepEqual([...a.subarray(4, 8)], [139, 90, 90, 255]);
  });
});
