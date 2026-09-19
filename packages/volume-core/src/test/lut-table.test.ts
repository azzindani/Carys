import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWindowLevel, lutRow, PRESETS, voiRange, windowLevelFromRange,
} from '../lut.js';
import { mulberry32, randInt } from './rng.js';

// Counting rule: one `it` per behavior; data tables run INSIDE it.
// (Loop-generated `it` blocks inflated the old count without adding behaviors.)
const NAMES = Object.keys(PRESETS);

describe('lut presets', () => {
  it('all presets clamp outside the window', () => {
    for (const name of NAMES) {
      const wl = PRESETS[name]!;
      const { lo, hi } = voiRange(wl);
      assert.equal(applyWindowLevel(lo - 1000, wl), 0, name);
      assert.equal(applyWindowLevel(hi + 1000, wl), 255, name);
    }
  });
  it('all presets hit exact endpoints', () => {
    for (const name of NAMES) {
      const wl = PRESETS[name]!;
      const { lo, hi } = voiRange(wl);
      assert.equal(applyWindowLevel(lo, wl), 0, name);
      assert.equal(applyWindowLevel(hi, wl), 255, name);
    }
  });
  it('all presets map the midpoint to 127/128', () => {
    for (const name of NAMES) {
      const wl = PRESETS[name]!;
      const { lo, hi } = voiRange(wl);
      const g = applyWindowLevel((lo + hi) / 2, wl);
      assert.ok(g === 127 || g === 128, `${name}: ${g}`);
    }
  });
  it('all presets ramp monotonically', () => {
    for (const name of NAMES) {
      const wl = PRESETS[name]!;
      const { lo, hi } = voiRange(wl);
      let prev = -1;
      for (let k = 0; k <= 20; k++) {
        const g = applyWindowLevel(lo + ((hi - lo) * k) / 20, wl);
        assert.ok(g >= prev, `${name} step ${k}`);
        prev = g;
      }
    }
  });
  it('all presets round-trip through range', () => {
    for (const name of NAMES) {
      const wl = PRESETS[name]!;
      const { lo, hi } = voiRange(wl);
      assert.deepEqual(windowLevelFromRange(lo, hi), { center: wl.center, width: wl.width });
    }
  });
});

describe('lut randomized', () => {
  it('160 random windows ramp within bounds', () => {
    const rng = mulberry32(1337);
    for (let t = 0; t < 160; t++) {
      const center = randInt(rng, -1000, 1000);
      const width = randInt(rng, 1, 2000);
      const wl = { center, width };
      const { lo, hi } = voiRange(wl);
      assert.equal(hi - lo, width, `case ${t}`);
      let prev = -1;
      for (let k = 0; k <= 8; k++) {
        const g = applyWindowLevel(lo + (width * k) / 8, wl);
        assert.ok(g >= prev && g <= 255, `case ${t} step ${k}`);
        prev = g;
      }
    }
  });
  it('lutRow matches scalar application (80 cases)', () => {
    const rng = mulberry32(7331);
    for (let t = 0; t < 80; t++) {
      const n = 1 + Math.floor(rng() * 64);
      const data = Array.from({ length: n }, () => randInt(rng, -1200, 1200));
      const wl = { center: randInt(rng, -500, 500), width: randInt(rng, 1, 1500) };
      const out = new Uint8ClampedArray(n);
      lutRow(data, wl, out);
      for (let i = 0; i < n; i++) assert.equal(out[i], applyWindowLevel(data[i]!, wl), `case ${t}[${i}]`);
    }
  });
});
