import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { indexToWorld, sameSpace, worldToIndex, type Vec3 } from '../imagespace.js';
import { intervalToSet, orderedIntersect, orderedUnion, segmentOf } from '../ordered.js';
import { compositeRow, overlayToWindowLevel, type Overlay } from '../overlay.js';
import { moveCenter, type LinkedView } from '../layer.js';
import type { Volume } from '../types.js';

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function vol(): Volume {
  return { dims: [2, 2, 1], spacing: [1, 1, 1], origin: [0, 0, 0], dtype: 'uint8', data: new Uint8Array(4) };
}

describe('imagespace', () => {
  it('indexToWorld applies origin + direction columns + spacing', () => {
    assert.deepEqual(indexToWorld([1, 2, 3], [10, 20, 30], ID, [2, 2, 2]), [12, 24, 36]);
    // swapped axes: direction column 0 points along +y
    assert.deepEqual(indexToWorld([1, 0, 0], [0, 0, 0], [0, 1, 0, 1, 0, 0, 0, 0, 1], [1, 1, 1]), [0, 1, 0]);
  });
  it('worldToIndex inverts indexToWorld (identity + rotated)', () => {
    for (const dir of [ID, [0, 1, 0, 1, 0, 0, 0, 0, 1], [0, 0, 1, 0, 1, 0, 1, 0, 0]]) {
      const idx: Vec3 = [3, 1, 2];
      const w = indexToWorld(idx, [5, -5, 10], dir, [2, 1, 0.5]);
      const back = worldToIndex(w, [5, -5, 10], dir, [2, 1, 0.5]);
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(back[k]! - idx[k]!) < 1e-9, `dir ${dir} axis ${k}: ${back}`);
    }
  });
  it('sameSpace compares dims + spacing + origin field by field', () => {
    const a = { origin: [0, 0, 0] as Vec3, spacing: [1, 1, 1] as Vec3, dims: [4, 4, 4] as Vec3 };
    assert.equal(sameSpace(a, { ...a }), true);
    assert.equal(sameSpace(a, { ...a, dims: [4, 4, 5] as Vec3 }), false);
    assert.equal(sameSpace(a, { ...a, spacing: [1, 1, 2] as Vec3 }), false);
    assert.equal(sameSpace(a, { ...a, origin: [0, 0, 1] as Vec3 }), false);
  });
});

describe('ordered sets', () => {
  it('union dedups + sorts, intersect keeps order of first', () => {
    assert.deepEqual(orderedUnion([3, 1], [2, 3]), [1, 2, 3]);
    assert.deepEqual(orderedUnion([], []), []);
    assert.deepEqual(orderedIntersect([3, 1, 2], [2, 4]), [2]);
    assert.deepEqual(orderedIntersect([1], []), []);
  });
  it('intervalToSet is inclusive; segmentOf binary-searches fence posts', () => {
    assert.deepEqual(intervalToSet({ start: 3, end: 5 }), [3, 4, 5]);
    assert.deepEqual(intervalToSet({ start: 5, end: 3 }), []);
    const off = [0, 3, 7, 10];
    assert.deepEqual([0, 2, 3, 6, 9].map((i) => segmentOf(off, i)), [0, 0, 1, 1, 2]);
    assert.deepEqual([10, 11, -1].map((i) => segmentOf(off, i)), [-1, -1, -1]);
  });
});

describe('overlay composite', () => {
  it('overlayToWindowLevel maps min/max, never zero width', () => {
    assert.deepEqual(overlayToWindowLevel({ volume: vol(), min: 100, max: 200, opacity: 1 }), { center: 150, width: 100 });
    assert.deepEqual(overlayToWindowLevel({ volume: vol(), min: 50, max: 50, opacity: 1 }).width, 1);
  });
  it('compositeRow renders gray with no overlays, hot-tints where overlay > 0', () => {
    const wl = { center: 127.5, width: 255 };
    const out = new Uint8ClampedArray(8);
    compositeRow([0, 255], wl, [], out);
    assert.deepEqual([...out], [0, 0, 0, 255, 255, 255, 255, 255]);
    const ov: Overlay = { volume: vol(), min: 0, max: 100, opacity: 0.5 };
    const out2 = new Uint8ClampedArray(8);
    compositeRow([255, 255], wl, [{ vals: [0, 100], overlay: ov }], out2);
    assert.deepEqual([...out2.slice(0, 4)], [255, 255, 255, 255]); // overlay maps to 0: untouched
    assert.deepEqual([...out2.slice(4, 8)], [255, 179, 128, 255]); // hot tint, alpha blend
  });
  it('zero-opacity overlay leaves the base row untouched', () => {
    const wl = { center: 127.5, width: 255 };
    const out = new Uint8ClampedArray(4);
    compositeRow([200], wl, [{ vals: [100], overlay: { volume: vol(), min: 0, max: 100, opacity: 0 } }], out);
    assert.deepEqual([...out], [200, 200, 200, 255]);
  });
});

describe('linked view', () => {
  it('moveCenter replaces the center, keeps panes, does not mutate', () => {
    const v: LinkedView = { center: [1, 2, 3], axial: 1, coronal: 2, sagittal: 3 };
    const moved = moveCenter(v, [9, 9, 9]);
    assert.deepEqual(moved.center, [9, 9, 9]);
    assert.deepEqual([moved.axial, moved.coronal, moved.sagittal], [1, 2, 3]);
    assert.deepEqual(v.center, [1, 2, 3]);
  });
});
