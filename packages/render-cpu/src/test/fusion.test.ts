import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Volume } from '@carys/volume-core';
import { fuseSlices } from '../fusion.js';

function vol(n: number, fill: (i: number) => number): Volume {
  const data = new Float64Array(n * n * n);
  for (let i = 0; i < data.length; i++) data[i] = fill(i);
  return {
    dims: [n, n, n], spacing: [1, 1, 1], origin: [0, 0, 0], dtype: 'float64', data,
  };
}

const WL = { width: 100, center: 50 };

describe('fusion', () => {
  it('checker alternates tiles between base and overlay', () => {
    const base = vol(32, () => 0); // black
    const over = vol(32, () => 100); // white
    const out = fuseSlices(base, over, 'axial', 0, WL, WL, 'checker', 0.5, 16);
    const at = (i: number, j: number): number => out[(j * 32 + i) * 4]!;
    assert.equal(at(0, 0), 0); // tile (0,0) = base
    assert.equal(at(16, 0), 255); // tile (1,0) = overlay
    assert.equal(at(0, 16), 255); // tile (0,1) = overlay
    assert.equal(at(16, 16), 0); // tile (1,1) = base
  });
  it('alpha endpoints reproduce each side, midpoint blends', () => {
    const base = vol(8, () => 0);
    const over = vol(8, () => 100);
    const a0 = fuseSlices(base, over, 'axial', 0, WL, WL, 'alpha', 0);
    const a1 = fuseSlices(base, over, 'axial', 0, WL, WL, 'alpha', 1);
    const ah = fuseSlices(base, over, 'axial', 0, WL, WL, 'alpha', 0.5);
    assert.equal(a0[0], 0);
    assert.equal(a1[0], 255);
    assert.ok(Math.abs(ah[0]! - 127.5) <= 1, `mid ${ah[0]}`);
  });
  it('subtract: no-change is mid-gray, growth bright, shrinkage dark', () => {
    const base = vol(8, () => 50);
    const same = vol(8, () => 50);
    const grown = vol(8, () => 100);
    const shrunk = vol(8, () => 0);
    const s = fuseSlices(base, same, 'axial', 0, WL, WL, 'subtract');
    const g = fuseSlices(base, grown, 'axial', 0, WL, WL, 'subtract');
    const d = fuseSlices(base, shrunk, 'axial', 0, WL, WL, 'subtract');
    assert.ok(Math.abs(s[0]! - 127.5) <= 1, `flat ${s[0]}`);
    assert.ok(g[0]! > 200, `growth ${g[0]}`);
    assert.ok(d[0]! < 55, `shrinkage ${d[0]}`);
  });
  it('bad params throw named errors, mismatched dims nearest-map', () => {
    const base = vol(8, () => 10);
    const over = vol(8, () => 90);
    assert.throws(() => fuseSlices(base, over, 'axial', 0, WL, WL, 'alpha', 2), /fusion-bad-alpha/);
    assert.throws(() => fuseSlices(base, over, 'axial', 0, WL, WL, 'checker', 0.5, 1), /fusion-bad-checker/);
    const small = vol(4, () => 90);
    const out = fuseSlices(base, small, 'coronal', 3, WL, WL, 'alpha', 1);
    assert.equal(out.length, 8 * 8 * 4); // base geometry wins
    assert.ok(out[0]! > 200); // overlay white shows through
  });
});
