import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { presetTF, sampleTF, TF_PRESETS } from '../tf.js';
import { renderVolume } from '../vr.js';
import { mulberry32, randInt } from './rng.js';

function solid(dims: [number, number, number], v: number) {
  const [nx, ny, nz] = dims;
  return { dims, data: new Float64Array(nx * ny * nz).fill(v) };
}

const TRANSPARENT_TF = [
  { value: 0, color: [0, 0, 0] as [number, number, number], opacity: 0 },
  { value: 10, color: [255, 255, 255] as [number, number, number], opacity: 0 },
];

describe('vr angle table', () => {
  it('empty volume renders pure background from 12 angles', () => {
    for (const a of [0, 0.7, 1.5, 3.14]) {
      for (const t of [-0.5, 0, 0.5]) {
        const { rgba } = renderVolume(solid([10, 10, 10], 0), {
          width: 20, height: 20, angleY: a, tiltX: t, tf: TRANSPARENT_TF, step: 2, shade: true,
        });
        for (let i = 0; i < rgba.length; i += 4) {
          assert.equal(rgba[i], 17, `a=${a} t=${t}`);
          assert.equal(rgba[i + 3], 255, `a=${a} t=${t}`);
          assert.ok(Number.isFinite(rgba[i + 1]!) && Number.isFinite(rgba[i + 2]!), `a=${a} t=${t}`);
        }
      }
    }
  });
});

describe('vr density monotonicity', () => {
  it('higher density never renders darker (50 fields)', () => {
    const rng = mulberry32(555);
    for (let t = 0; t < 50; t++) {
      const n = 8;
      const data = new Float64Array(n * n * n);
      for (let i = 0; i < data.length; i++) data[i] = rng() * 10;
      const tf = presetTF('xray', 0, 10);
      const base = {
        dims: [n, n, n] as [number, number, number], data,
      };
      const lo = renderVolume(base, {
        width: 16, height: 16, angleY: 0.5, tiltX: 0.2, tf, step: 2, shade: false, density: 0.3,
      }).rgba;
      const hi = renderVolume(base, {
        width: 16, height: 16, angleY: 0.5, tiltX: 0.2, tf, step: 2, shade: false, density: 2.5,
      }).rgba;
      let loSum = 0, hiSum = 0;
      for (let i = 0; i < lo.length; i += 4) { loSum += lo[i]!; hiSum += hi[i]!; }
      assert.ok(hiSum >= loSum, `case ${t}: ${hiSum} < ${loSum}`);
    }
  });
});

describe('vr tf ranges', () => {
  it('every preset x 20 ranges renders finite', () => {
    const rng = mulberry32(909);
    for (const name of TF_PRESETS) {
      for (let t = 0; t < 20; t++) {
        const lo = randInt(rng, -1000, 500);
        const tf = presetTF(name, lo, lo + randInt(rng, 1, 2000));
        const { rgba } = renderVolume(solid([6, 6, 6], lo + 1), {
          width: 12, height: 12, angleY: 0.3, tiltX: -0.2, tf, step: 2, shade: true,
        });
        for (const v of rgba) assert.ok(Number.isFinite(v), `${name} case ${t}`);
        const s = sampleTF(tf, lo);
        assert.ok(s.a >= 0 && s.a <= 1, `${name} case ${t}`);
      }
    }
  });
});
