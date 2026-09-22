import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { autoThreshold } from '../threshold.js';

/** A head-shaped CT in Hounsfield units: air, soft tissue, cortical bone. */
function ctHead(n = 4096): Float64Array {
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    d[i] = t < 0.55 ? -1000 : t < 0.9 ? 36 : 1100;
  }
  return d;
}

describe('auto threshold', () => {
  it('Hounsfield data cuts at bone, and the range reaches it', () => {
    const t = autoThreshold(ctHead());
    assert.equal(t.kind, 'hounsfield');
    assert.equal(t.value, 300);
    // the old fixed control was [0, 1000]: it could neither cut below water
    // nor reach the 1100 HU bone this volume actually contains
    assert.equal(t.lo, -1000);
    assert.equal(t.hi, 1100);
    assert.ok(t.value > t.lo && t.value < t.hi, 'default must sit inside the range');
  });

  it('a label map keeps the mask boundary and never reports Hounsfield', () => {
    const d = new Float64Array(1000);
    for (let i = 0; i < d.length; i++) d[i] = i < 700 ? 0 : i < 900 ? 1 : 2;
    const t = autoThreshold(d);
    assert.equal(t.kind, 'mask');
    assert.equal(t.value, 0);
    assert.equal(t.lo, 0);
    assert.equal(t.hi, 2);
  });

  it('non-negative scanner values fall back to Otsu between the two modes', () => {
    // stored CT (intercept not applied): no negatives, so not Hounsfield
    const d = new Float64Array(2000);
    for (let i = 0; i < d.length; i++) d[i] = i < 1200 ? 24 : 2124;
    const t = autoThreshold(d);
    assert.equal(t.kind, 'otsu');
    assert.ok(t.value > 24 && t.value < 2124, `Otsu cut ${t.value} must separate the modes`);
    assert.equal(t.lo, 24);
    assert.equal(t.hi, 2124);
  });

  it('flat and degenerate volumes return a usable range, never NaN', () => {
    for (const d of [new Float64Array(10), new Float64Array([7, 7, 7]), new Float64Array(0)]) {
      const t = autoThreshold(d);
      assert.ok(Number.isFinite(t.value) && Number.isFinite(t.lo) && Number.isFinite(t.hi),
        `non-finite for length ${d.length}`);
      assert.ok(t.hi >= t.lo, 'range must not invert');
    }
  });

  it('float intensities are not mistaken for a label map', () => {
    const d = new Float64Array(1000);
    for (let i = 0; i < d.length; i++) d[i] = i < 500 ? 0.25 : 180.5;
    assert.equal(autoThreshold(d).kind, 'otsu');
  });
});
