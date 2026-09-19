import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { histogram } from '../histogram.js';
import { mulberry32, randInt } from './rng.js';

describe('histogram invariants', () => {
  it('bins sum to n over 90 shapes', () => {
    const rng = mulberry32(4242);
    for (let t = 0; t < 90; t++) {
      const n = randInt(rng, 1, 500);
      const lo = randInt(rng, -500, 500);
      const span = randInt(rng, 0, 1000);
      const bins = [8, 16, 64, 256][t % 4]!;
      const data = Array.from({ length: n }, () => lo + rng() * span);
      const { hist, min, max } = histogram(data, bins);
      assert.equal(hist.length, bins, `case ${t}`);
      let sum = 0;
      for (const c of hist) sum += c;
      assert.equal(sum, n, `case ${t}`);
      assert.ok(min <= max, `case ${t}`);
    }
  });
  it('min/max exact on 30 distinct arrays', () => {
    for (let t = 0; t < 30; t++) {
      const r = mulberry32(1000 + t);
      const data = Array.from({ length: 20 + t }, () => Math.round((r() - 0.5) * 200));
      const { min, max } = histogram(data, 16);
      assert.equal(min, Math.min(...data), `case ${t}`);
      assert.equal(max, Math.max(...data), `case ${t}`);
    }
  });
  it('constant input lands fully in its bin (20 values)', () => {
    for (let t = 0; t < 20; t++) {
      const v = 7 + t * 3;
      const { hist, min, max } = histogram(new Array(37).fill(v), 32);
      assert.equal(min, v, `case ${t}`);
      assert.equal(max, v, `case ${t}`);
      let filled = 0, total = 0;
      for (const c of hist) {
        if (c > 0) filled++;
        total += c;
      }
      assert.equal(filled, 1, `case ${t}`);
      assert.equal(total, 37, `case ${t}`);
    }
  });
  it('default 256 bins', () => {
    assert.equal(histogram([1, 2, 3]).hist.length, 256);
  });
});
