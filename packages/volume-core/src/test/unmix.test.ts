import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  borderBackground, channelGainOffset, clampIntensity, flatfieldCorrect,
  rescaleIntensity, zNormalize,
} from '../unmix.js';

describe('unmix', () => {
  it('gain/offset exact, out-param reuse, bad params loud', () => {
    assert.deepEqual([...channelGainOffset([1, 2, 3], 2, -1)], [1, 3, 5]);
    const out = new Float64Array(2);
    assert.equal(channelGainOffset([4, 5], 1, 0, out), out);
    assert.throws(() => channelGainOffset([1], NaN, 0), /unmix-gain-offset/);
  });
  it('border median ignores a bright center', () => {
    // 6x6: border of 5s, center 4x4 of 200s → median 5
    const f = new Array(36).fill(200);
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        if (x < 2 || y < 2 || x >= 4 || y >= 4) f[y * 6 + x] = 5;
      }
    }
    assert.equal(borderBackground(f, 6, 6), 5);
    assert.throws(() => borderBackground(f, 5, 5), /unmix-border-dims/);
    // 1x1 with border 1: the only pixel IS the border — median of [v]
    assert.equal(borderBackground([7], 1, 1), 7);
  });
  it('TorchIO-studied rescale: percentile clip + min-max exact', () => {
    // 0..10 step 2 → identity into [0,1]: 4 maps to 0.4
    assert.deepEqual([...rescaleIntensity([0, 2, 4, 6, 8, 10])], [0, 0.2, 0.4, 0.6, 0.8, 1]);
    // nnU-Net-style window: pct 50..100 = median(20)..max(40); clip
    // [0,10]→lo, map 20→-1, 30→0, 40→1 (linear interpolation rank)
    assert.deepEqual(
      [...rescaleIntensity([0, 10, 20, 30, 40], { pctLo: 50, pctHi: 100, outMin: -1, outMax: 1 })],
      [-1, -1, -1, 0, 1],
    );
    // custom window: constant image throws (TorchIO warns; we fail loud)
    assert.throws(() => rescaleIntensity([5, 5, 5]), /unmix-rescale-constant/);
    assert.throws(() => rescaleIntensity([1, 2], { pctLo: 90, pctHi: 10 }), /unmix-rescale-pct/);
    assert.throws(() => rescaleIntensity([], {}), /unmix-rescale-empty/);
  });
  it('TorchIO-studied znorm: mean/std exact, masked, std==0 loud', () => {
    const z = zNormalize([1, 2, 3, 4, 5]);
    assert.ok(Math.abs(z[0]! + Math.SQRT2) < 1e-9 && Math.abs(z[4]! - Math.SQRT2) < 1e-9);
    // masked: stats over mask only, applied to all (mask needs spread)
    const m = zNormalize([0, 10, 20, 30], [0, 1, 1, 1]);
    assert.ok(m.every((v) => Number.isFinite(v)) && m[0]! < m[1]!);
    // constant mask → std 0 → loud (TorchIO's RuntimeError equivalent)
    assert.throws(() => zNormalize([0, 10, 10, 10], [0, 1, 1, 1]), /unmix-znorm-std/);
    assert.throws(() => zNormalize([7, 7, 7]), /unmix-znorm-std/);
    assert.throws(() => zNormalize([1, 2], [0, 0]), /unmix-znorm-mask-empty/);
    assert.throws(() => zNormalize([1], [1, 2]), /unmix-znorm-mask/);
  });
  it('TorchIO-studied clamp: bounds exact, null ends = image min/max', () => {
    assert.deepEqual([...clampIntensity([-1500, 0, 500, 2000], { outMin: -1000, outMax: 1000 })], [-1000, 0, 500, 1000]);
    assert.deepEqual([...clampIntensity([2, 4, 8], { outMax: 5 })], [2, 4, 5]);
    assert.deepEqual([...clampIntensity([2, 4, 8], { outMin: 3 })], [3, 4, 8]);
    assert.throws(() => clampIntensity([1], { outMin: 5, outMax: 1 }), /unmix-clamp-range/);
  });
  it('flatfield: dark, gain, bg compose with clamp', () => {
    assert.deepEqual([...flatfieldCorrect([10, 4, 0], { dark: 2, gain: 2, bg: 1 })], [15, 3, 0]);
    const dark = [1, 1, 1];
    assert.deepEqual([...flatfieldCorrect([5, 5, 5], { dark, bg: 2 })], [2, 2, 2]);
    assert.throws(() => flatfieldCorrect([1], { dark: [1, 2] }), /unmix-dark-dims/);
    assert.throws(() => flatfieldCorrect([1], { gain: NaN }), /unmix-flatfield/);
  });
});
