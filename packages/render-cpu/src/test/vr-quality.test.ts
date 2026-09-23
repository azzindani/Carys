import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { addPass, renderVolume, type VrOpts, type VrVolume } from '../vr.js';
import type { TF } from '../tf.js';

// F8 (docs/PHASES.md): opacity corrected for the step, progressive jittered
// refinement, and plain calls unchanged.

/** A field on an nx×ny×nz grid from a function of the voxel centre. */
function field(dims: [number, number, number], f: (x: number, y: number, z: number) => number): VrVolume {
  const [nx, ny, nz] = dims;
  const data = new Float64Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) data[(z * ny + y) * nx + x] = f(x + 0.5, y + 0.5, z + 0.5);
  return { dims, data };
}

/** Mean of `of` refinement passes. */
function refined(vol: VrVolume, opts: VrOpts, of: number): Uint8ClampedArray {
  const sum = new Float32Array(opts.width * opts.height * 4);
  let frame: Uint8ClampedArray = new Uint8ClampedArray(0);
  for (let k = 0; k < of; k++) frame = addPass(sum, renderVolume(vol, { ...opts, jitter: { pass: k, of } }).rgba, k + 1);
  return frame;
}

const hash = (a: Uint8ClampedArray): string => createHash('sha256').update(a).digest('hex').slice(0, 16);
const rms = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(s / (a.length / 4));
};

describe('plain calls are unchanged (F8)', () => {
  it('renders bit-identical to the raycaster before F8', () => {
    // a soft ball, three configurations: shaded, dense, anisotropic + bounded;
    // hashes taken from the pre-F8 renderer
    const vol = field([24, 20, 16], (x, y, z) => 1000 / (1 + Math.exp((Math.hypot(x - 12, y - 10, z - 8) - 6) * 1.5)));
    const tf: TF = [
      { value: 0, color: [0, 0, 0], opacity: 0 },
      { value: 300, color: [230, 180, 120], opacity: 0.05 },
      { value: 800, color: [255, 240, 220], opacity: 0.6 },
    ];
    const got = [
      { width: 32, height: 28, angleY: 0.4, tiltX: 0.2, tf, step: 2, shade: true },
      { width: 32, height: 28, angleY: -0.9, tiltX: 0.5, tf, step: 0.75, shade: false, density: 1.7 },
      {
        width: 30, height: 30, angleY: 0.4, tiltX: 0.2, tf, step: 1.5, shade: true,
        spacing: [0.8, 0.8, 2.5] as [number, number, number], bounds: { min: [3, 2, 1] as [number, number, number], max: [21, 18, 15] as [number, number, number] },
      },
    ].map((o) => hash(renderVolume(vol, o).rgba));
    assert.deepEqual(got, ['c7fe2656795bd493', '4ed122ad1418cac5', '2ad2600a18813d18']);
  });
});

describe('opacity corrected for the step (F8)', () => {
  // a slab 6 voxels thick across the view, opacity 0.1 per voxel, white on
  // black, looked at face on: the pixel is 255 × (1 − 0.9⁶) whatever the step
  const slab = field([16, 16, 20], (_x, _y, z) => (z > 7 && z < 13 ? 1000 : 0));
  const tf: TF = [
    { value: 0, color: [255, 255, 255], opacity: 0 },
    { value: 499, color: [255, 255, 255], opacity: 0 },
    { value: 500, color: [255, 255, 255], opacity: 0.1 },
    { value: 1000, color: [255, 255, 255], opacity: 0.1 },
  ];
  const view = { width: 16, height: 16, angleY: 0, tiltX: 0, tf, shade: false, bg: [0, 0, 0] as [number, number, number] };
  const alphaAt = (o: Partial<VrOpts>): number => renderVolume(slab, { ...view, ...o }).rgba[(8 * 16 + 8) * 4]! / 255;
  const STEPS = [0.5, 1, 1.5, 2, 3];

  it('a slab rendered at five step sizes has the same opacity', () => {
    const want = 1 - 0.9 ** 6;
    for (const step of STEPS) {
      const a = alphaAt({ step, alphaStep: 1 });
      assert.ok(Math.abs(a - want) < 0.005, `step ${step}: ${a.toFixed(4)}, want ${want.toFixed(4)}`);
    }
  });

  it('uncorrected, the same slab spans most of the range', () => {
    const a = STEPS.map((step) => alphaAt({ step }));
    assert.ok(Math.max(...a) - Math.min(...a) > 0.4, `uncorrected opacities ${a.map((v) => v.toFixed(3)).join(', ')}`);
  });

  it('rejects a step that is not positive', () => {
    assert.throws(() => renderVolume(slab, { ...view, alphaStep: 0 }), /vr-alpha-step/);
  });
});

describe('progressive refinement (F8)', () => {
  // a shaded ball with a sharp opacity edge: the case that shows rings
  const ball = field([32, 32, 32], (x, y, z) => 1000 / (1 + Math.exp((Math.hypot(x - 16, y - 16, z - 16) - 10) * 2)));
  const tf: TF = [
    { value: 0, color: [0, 0, 0], opacity: 0 },
    { value: 450, color: [240, 220, 200], opacity: 0 },
    { value: 550, color: [240, 220, 200], opacity: 0.35 },
  ];
  const view: VrOpts = { width: 48, height: 48, angleY: 0.6, tiltX: 0.35, tf, shade: true, alphaStep: 1 };

  it('refined passes converge on a fine step, below the lattice error', () => {
    // each against its own quarter-voxel reference (the lattice samples
    // pixel corners, passes their cells). Measured rms: lattice 2.12 (the
    // rings); one pass 4.09 (noise), 4 passes 1.39, 16 passes 0.97
    const lattice = rms(renderVolume(ball, { ...view, step: 3 }).rgba, renderVolume(ball, { ...view, step: 0.25 }).rgba);
    const ref = refined(ball, { ...view, step: 0.25 }, 16);
    const four = rms(refined(ball, { ...view, step: 3 }, 4), ref);
    const sixteen = rms(refined(ball, { ...view, step: 3 }, 16), ref);
    assert.ok(four < 0.75 * lattice, `rms: lattice ${lattice.toFixed(2)}, 4 passes ${four.toFixed(2)}`);
    assert.ok(sixteen < four, `16 passes ${sixteen.toFixed(2)} vs 4 passes ${four.toFixed(2)}`);
  });

  it('the sub-pixel grid anti-aliases an opaque edge', () => {
    const cube = field([20, 20, 20], (x, y, z) => (Math.abs(x - 10) < 6 && Math.abs(y - 10) < 6 && Math.abs(z - 10) < 6 ? 1000 : 0));
    const opaque: TF = [{ value: 0, color: [0, 0, 0], opacity: 0 }, { value: 499, color: [0, 0, 0], opacity: 0 }, { value: 500, color: [200, 200, 200], opacity: 1 }];
    const o: VrOpts = { width: 30, height: 30, angleY: 0.3, tiltX: 0, tf: opaque, step: 0.5, shade: false };
    const levels = (a: Uint8ClampedArray): number => new Set(Array.from({ length: a.length / 4 }, (_, i) => a[i * 4])).size;
    const one = levels(renderVolume(cube, o).rgba), four = levels(refined(cube, o, 4));
    assert.ok(four > one + 2, `grey levels: one pass ${one}, four ${four}`);
  });

  it('bounded and unbounded passes sample the same points', () => {
    const o: VrOpts = { ...view, step: 1.5, jitter: { pass: 2, of: 4 } };
    const a = renderVolume(ball, o).rgba;
    const b = renderVolume(ball, { ...o, bounds: { min: [2, 2, 2], max: [30, 30, 30] } }).rgba;
    assert.equal(hash(a), hash(b));
  });

  it('is deterministic per pass', () => {
    const o: VrOpts = { ...view, step: 2, jitter: { pass: 1, of: 4 } };
    assert.equal(hash(renderVolume(ball, o).rgba), hash(renderVolume(ball, o).rgba));
  });

  it('rejects a pass outside a square grid', () => {
    for (const jitter of [{ pass: 0, of: 3 }, { pass: 4, of: 4 }, { pass: -1, of: 4 }, { pass: 0.5, of: 4 }]) {
      assert.throws(() => renderVolume(ball, { ...view, width: 4, height: 4, jitter }), /vr-jitter/, JSON.stringify(jitter));
    }
    assert.throws(() => addPass(new Float32Array(8), new Uint8ClampedArray(4), 1), /vr-pass-size/);
  });
});
