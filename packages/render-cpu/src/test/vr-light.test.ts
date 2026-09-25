import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { addPass, renderVolume, type VrOpts, type VrVolume } from '../vr.js';
import { extinctionGrid, passLight, transmittance, type ExtinctionGrid } from '../vr-light.js';
import { sortTF, type TF } from '../tf.js';

// Cinematic lighting, soft shadows and ambient light
// accumulated over refinement passes.

function field(dims: [number, number, number], f: (x: number, y: number, z: number) => number): VrVolume {
  const [nx, ny, nz] = dims;
  const data = new Float64Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) data[(z * ny + y) * nx + x] = f(x + 0.5, y + 0.5, z + 0.5);
  return { dims, data };
}

function mean(vol: VrVolume, opts: VrOpts, of: number): Uint8ClampedArray {
  const sum = new Float32Array(opts.width * opts.height * 4);
  let frame: Uint8ClampedArray = new Uint8ClampedArray(0);
  for (let k = 0; k < of; k++) frame = addPass(sum, renderVolume(vol, { ...opts, jitter: { pass: k, of } }).rgba, k + 1);
  return frame;
}

/** Mean red over a (2r+1)² patch. */
const patch = (img: Uint8ClampedArray, W: number, cx: number, cy: number, r = 2): number => {
  let s = 0, n = 0;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { s += img[(y * W + x) * 4]!; n++; }
  return s / n;
};

/** A grid of 1 mm cells with extinction `s` per mm where `inside` holds. */
function grid(dims: [number, number, number], s: number, inside: (i: number, j: number, k: number) => boolean): ExtinctionGrid {
  const sigma = new Float32Array(dims[0] * dims[1] * dims[2]);
  for (let k = 0; k < dims[2]; k++) for (let j = 0; j < dims[1]; j++) for (let i = 0; i < dims[0]; i++) if (inside(i, j, k)) sigma[(k * dims[1] + j) * dims[0] + i] = s;
  return { dims, f: [1, 1, 1], cell: [1, 1, 1], sigma };
}

describe('light propagation (F10)', () => {
  it('empty space passes all the light', () => {
    const T = transmittance(grid([8, 8, 8], 0.3, () => false), [0.3, 0.5, 0.81]);
    assert.ok(T.every((t) => t === 1));
  });

  it('a slab attenuates by exp(−σ × path), straight and oblique', () => {
    // 6 mm thick, σ = 0.1 / mm, across the whole grid in x and y
    const g = grid([24, 24, 24], 0.1, (_i, _j, k) => k >= 10 && k < 16);
    const at = (T: Float32Array, i: number, j: number, k: number): number => T[(k * 24 + j) * 24 + i]!;
    const down = transmittance(g, [0, 0, 1]);
    assert.ok(Math.abs(at(down, 12, 12, 5) - Math.exp(-0.6)) < 1e-6, `below: ${at(down, 12, 12, 5)}`);
    assert.equal(at(down, 12, 12, 20), 1, 'above');
    // 40° off vertical: the path through the slab is 6 / cos 40°
    const c = Math.cos(0.7), sn = Math.sin(0.7);
    const tilt = transmittance(g, [sn, 0, c]);
    const want = Math.exp((-0.1 * 6) / c);
    assert.ok(Math.abs(at(tilt, 4, 12, 5) - want) < 0.01 * want, `oblique: ${at(tilt, 4, 12, 5)}, want ${want}`);
  });

  it('turns TF opacity into extinction over the reference length', () => {
    // opacity 0.5 over a 2 mm reference: σ = ln 2 / 2 per mm
    const vol = field([8, 8, 8], () => 100);
    const tf: TF = [{ value: 0, color: [255, 255, 255], opacity: 0.5 }];
    const g = extinctionGrid(vol.data, vol.dims, [1, 1, 1], sortTF(tf), 1, 2);
    assert.ok(g.sigma.every((s) => Math.abs(s - Math.LN2 / 2) < 1e-6));
    assert.throws(() => extinctionGrid(vol.data, vol.dims, [1, 1, 1], tf, 1, 0), /light-ref/);
  });

  it('keeps cells near-cubic in mm and under a million', () => {
    // 5 mm slices: cells gather voxels in-plane, not across slices
    const g = extinctionGrid(new Float64Array(256 * 256 * 40), [256, 256, 40], [0.9, 0.9, 5], [], 1, 1);
    assert.ok(g.f[0] > 1 && g.f[2] === 1, `voxels per cell ${g.f.join('×')}`);
    assert.ok(g.dims[0] * g.dims[1] * g.dims[2] <= 1 << 20);
  });

  it('spreads the sky over all the passes', () => {
    const g = grid([4, 4, 4], 0, () => false);
    const dirs = [0, 1, 2, 3].flatMap((p) => passLight(g, [0, 0, 1], p, 4).sky);
    // 8 distinct unit directions, their mean near the origin
    const m = dirs.reduce((a, d) => [a[0]! + d[0] / 8, a[1]! + d[1] / 8, a[2]! + d[2] / 8], [0, 0, 0]);
    assert.equal(new Set(dirs.map((d) => d.map((v) => v.toFixed(6)).join())).size, 8);
    assert.ok(Math.hypot(m[0]!, m[1]!, m[2]!) < 0.15, `mean ${m.map((v) => v.toFixed(3)).join()}`);
  });
});

describe('cinematic rendering (F10)', () => {
  const opaque: TF = [{ value: 0, color: [0, 0, 0], opacity: 0 }, { value: 499, color: [0, 0, 0], opacity: 0 }, { value: 500, color: [220, 220, 220], opacity: 0.9 }];

  it('a ball casts a soft shadow on a plate where the headlight says', () => {
    // plate z 4..8 over x, y 4..44; ball r 6 at (30, 32, 26). The headlight
    // (0.35, 0.7, 0.62) puts the shadow's centre at (19.8, 11.7) on the
    // plate: screen (40, 71) at 1.84 px per voxel. Open plate: screen (74, 55).
    const scene = field([48, 48, 48], (x, y, z) =>
      (z > 4 && z < 8 && x > 4 && x < 44 && y > 4 && y < 44) || Math.hypot(x - 30, y - 32, z - 26) < 6 ? 1000 : 0);
    const o: VrOpts = { width: 96, height: 96, angleY: 0, tiltX: 0, tf: opaque, step: 1, alphaStep: 1, shade: true };
    const plain = mean(scene, o, 4), cin = mean(scene, { ...o, cinematic: true }, 16);
    const shadowP = patch(plain, 96, 40, 71), openP = patch(plain, 96, 74, 55);
    const shadowC = patch(cin, 96, 40, 71), openC = patch(cin, 96, 74, 55);
    assert.ok(Math.abs(shadowP - openP) < 3, `plain plate: ${shadowP.toFixed(1)} vs ${openP.toFixed(1)}`);
    assert.ok(shadowC < 0.7 * openC, `cinematic plate: shadow ${shadowC.toFixed(1)}, open ${openC.toFixed(1)}`);
  });

  it('ambient light leaves a slot floor darker than its rim', () => {
    // slab z 4..24 with a slot 4 wide, 4 deep along y (as F7's crevice)
    const slab = field([40, 40, 40], (x, y, z) => (x > 4 && x < 36 && y > 4 && y < 36 && z > 4 && z < 24 && !(Math.abs(x - 20) < 2 && z > 20) ? 1000 : 0));
    const o: VrOpts = { width: 80, height: 80, angleY: 0, tiltX: 0, tf: opaque, step: 1, alphaStep: 1, shade: true };
    const plain = mean(slab, o, 4), cin = mean(slab, { ...o, cinematic: true }, 16);
    // columns: 40 + (x − 20) × 1.84; floor x = 20, rim x = 10
    const floorP = patch(plain, 80, 40, 40, 1), rimP = patch(plain, 80, 22, 40, 1);
    const floorC = patch(cin, 80, 40, 40, 1), rimC = patch(cin, 80, 22, 40, 1);
    assert.ok(Math.abs(floorP - rimP) < 3, `plain: floor ${floorP.toFixed(1)}, rim ${rimP.toFixed(1)}`);
    assert.ok(floorC < 0.85 * rimC, `cinematic: floor ${floorC.toFixed(1)}, rim ${rimC.toFixed(1)}`);
  });

  it('passes converge: 16 are closer to 64 than 4 are', () => {
    const blob = field([32, 32, 32], (x, y, z) => 1000 / (1 + Math.exp((Math.hypot(x - 16, y - 16, z - 14) - 8) * 1.5)) + (z > 26 ? 1000 : 0));
    const soft: TF = [{ value: 0, color: [0, 0, 0], opacity: 0 }, { value: 300, color: [230, 210, 190], opacity: 0.1 }, { value: 800, color: [250, 240, 230], opacity: 0.6 }];
    const o: VrOpts = { width: 40, height: 40, angleY: 0.5, tiltX: 0.3, tf: soft, step: 1, alphaStep: 1, shade: true, cinematic: true };
    const ref = mean(blob, o, 64);
    const rms = (of: number): number => {
      const a = mean(blob, o, of);
      let s = 0;
      for (let i = 0; i < a.length; i += 4) s += (a[i]! - ref[i]!) ** 2;
      return Math.sqrt(s / (a.length / 4));
    };
    const e4 = rms(4), e16 = rms(16);
    assert.ok(e16 < 0.7 * e4, `rms vs 64 passes: 4 → ${e4.toFixed(2)}, 16 → ${e16.toFixed(2)}`);
  });

  it('is deterministic per pass', () => {
    const vol = field([16, 16, 16], (x, y, z) => (Math.hypot(x - 8, y - 8, z - 8) < 5 ? 1000 : 0));
    const o: VrOpts = { width: 16, height: 16, angleY: 0.3, tiltX: 0.2, tf: opaque, step: 1, shade: true, cinematic: true, jitter: { pass: 2, of: 4 } };
    const h = (): string => createHash('sha256').update(renderVolume(vol, o).rgba).digest('hex');
    assert.equal(h(), h());
  });
});
