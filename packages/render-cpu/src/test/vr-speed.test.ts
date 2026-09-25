import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { brickRanges, mergeRows, renderVolume, type VrOpts, type VrVolume } from '../vr.js';
import { maxOpacity, sampleSortedTF, sampleTF, sortTF, type TF } from '../tf.js';

// Empty-space skipping and split rendering change no
// pixel.

const hash = (a: Uint8ClampedArray): string => createHash('sha256').update(a).digest('hex').slice(0, 16);

function field(dims: [number, number, number], f: (x: number, y: number, z: number) => number): VrVolume {
  const [nx, ny, nz] = dims;
  const data = new Float64Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) data[(z * ny + y) * nx + x] = f(x + 0.5, y + 0.5, z + 0.5);
  return { dims, data };
}

/** Deterministic pseudo-random numbers (xorshift). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

describe('empty-space skipping (F9)', () => {
  // two blobs in mostly empty space, plus a thin plate: bricks of every kind
  const scene = field([40, 36, 30], (x, y, z) => {
    const a = 1000 / (1 + Math.exp((Math.hypot(x - 12, y - 12, z - 10) - 5) * 1.5));
    const b = 600 / (1 + Math.exp((Math.hypot(x - 28, y - 24, z - 20) - 4) * 2));
    const plate = Math.abs(z - 24.5) < 1 && x > 6 && x < 34 ? 300 : 0;
    return a + b + plate;
  });
  const tfs: TF[] = [
    // the app's shape: nothing below a threshold, a ramp above
    [{ value: 0, color: [0, 0, 0], opacity: 0 }, { value: 200, color: [200, 150, 120], opacity: 0 }, { value: 900, color: [255, 240, 220], opacity: 0.8 }],
    // a step exactly on a data value the plate takes
    [{ value: 0, color: [0, 0, 0], opacity: 0 }, { value: 299, color: [90, 90, 255], opacity: 0 }, { value: 300, color: [90, 90, 255], opacity: 0.4 }],
    // a peak in the middle of the range, zero at both ends
    [{ value: 0, color: [0, 0, 0], opacity: 0 }, { value: 450, color: [255, 60, 60], opacity: 0.5 }, { value: 700, color: [0, 0, 0], opacity: 0 }],
    // opaque everywhere: nothing may be skipped
    [{ value: 0, color: [40, 40, 40], opacity: 0.02 }, { value: 1000, color: [255, 255, 255], opacity: 0.9 }],
  ];
  const views: Partial<VrOpts>[] = [
    { angleY: 0.4, tiltX: 0.2, step: 1, shade: true },
    { angleY: -1.1, tiltX: 0.6, step: 2.5, shade: false, density: 2.2 },
    { angleY: 0.9, tiltX: -0.3, step: 1.5, shade: true, alphaStep: 1, jitter: { pass: 3, of: 4 } },
    { angleY: 0.2, tiltX: 0.1, step: 1.5, shade: true, spacing: [0.8, 0.8, 2.5], bounds: { min: [4, 4, 2], max: [36, 32, 28] } },
  ];

  it('renders the same pixels with and without skipping (4 TFs × 4 views)', () => {
    // the skip path is exercised: a third of the bricks (32 of 100) are
    // empty under the first TF
    const br = brickRanges(scene.data, scene.dims), stops = sortTF(tfs[0]!);
    const empty = br.lo.filter((lo, i) => maxOpacity(stops, lo, br.hi[i]!) === 0).length;
    assert.ok(empty > 0.25 * br.lo.length, `${empty} of ${br.lo.length} bricks empty`);
    for (const [i, tf] of tfs.entries()) {
      for (const [j, v] of views.entries()) {
        const o = { width: 36, height: 32, angleY: 0, tiltX: 0, tf, ...v };
        const skip = renderVolume(scene, o).rgba, full = renderVolume(scene, { ...o, skipEmpty: false }).rgba;
        assert.equal(hash(skip), hash(full), `TF ${i}, view ${j}`);
      }
    }
  });

  it('still matches on random fields with NaN holes', () => {
    const r = rng(7);
    for (let n = 0; n < 6; n++) {
      const vol = field([17, 19, 13], () => (r() < 0.02 ? NaN : r() < 0.7 ? 0 : r() * 1000));
      const o = { width: 20, height: 20, angleY: r() * 6, tiltX: r() - 0.5, tf: tfs[n % tfs.length]!, step: 0.5 + r() * 2, shade: n % 2 === 0 };
      assert.equal(hash(renderVolume(vol, o).rgba), hash(renderVolume(vol, { ...o, skipEmpty: false }).rgba), `field ${n}`);
    }
  });

  it('a brick covers the voxels a sample inside it reads', () => {
    // one hot voxel at x = 8: brick 1 holds it, brick 0 reads it through
    // its far apron (a sample at x in [7, 8) interpolates voxels 7 and 8)
    const vol = field([24, 8, 8], (x) => (Math.floor(x) === 8 ? 5 : 0));
    const br = brickRanges(vol.data, vol.dims);
    assert.deepEqual(br.counts, [3, 1, 1]);
    assert.deepEqual([...br.hi], [5, 5, 0]);
    assert.deepEqual([...br.lo], [0, 0, 0]);
    assert.equal(brickRanges(vol.data, vol.dims), br, 'cached per array');
  });

  it('bounds a TF over an interval by its ends and the stops inside', () => {
    const stops = sortTF(tfs[2]!);
    assert.equal(maxOpacity(stops, 0, 100), sampleSortedTF(stops, 100).a);
    assert.equal(maxOpacity(stops, 300, 800), 0.5, 'the peak stop inside');
    assert.equal(maxOpacity(stops, 800, 900), 0);
    assert.equal(maxOpacity(stops, NaN, 5), 1, 'NaN rules nothing out');
  });

  it('samples sorted stops exactly as sampleTF does', () => {
    const r = rng(3);
    for (const tf of tfs) {
      const stops = sortTF(tf);
      for (let i = 0; i < 200; i++) {
        const v = r() * 1200 - 100;
        assert.deepEqual(sampleSortedTF(stops, v), sampleTF(tf, v));
      }
    }
  });
});

describe('split rendering (F9)', () => {
  const ball = field([24, 24, 24], (x, y, z) => 1000 / (1 + Math.exp((Math.hypot(x - 12, y - 12, z - 12) - 7) * 1.5)));
  const tf: TF = [{ value: 0, color: [0, 0, 0], opacity: 0 }, { value: 300, color: [220, 200, 180], opacity: 0.1 }, { value: 900, color: [255, 250, 240], opacity: 0.7 }];
  const o: VrOpts = { width: 29, height: 23, angleY: 0.5, tiltX: 0.3, tf, step: 1, shade: true, alphaStep: 1, jitter: { pass: 1, of: 4 } };

  it('three row shares merge into the whole frame', () => {
    const whole = renderVolume(ball, o).rgba;
    const parts = [0, 1, 2].map((from) => renderVolume(ball, { ...o, rows: { from, every: 3 } }).rgba);
    assert.equal(hash(mergeRows(parts, 29, 23)), hash(whole));
  });

  it('rejects a share it cannot place', () => {
    for (const rows of [{ from: 3, every: 3 }, { from: 0, every: 0 }, { from: -1, every: 2 }, { from: 0.5, every: 2 }]) {
      assert.throws(() => renderVolume(ball, { ...o, width: 4, height: 4, rows }), /vr-rows/, JSON.stringify(rows));
    }
    assert.throws(() => mergeRows([new Uint8ClampedArray(8)], 2, 2), /vr-merge/);
    assert.throws(() => mergeRows([], 2, 2), /vr-merge/);
  });
});
