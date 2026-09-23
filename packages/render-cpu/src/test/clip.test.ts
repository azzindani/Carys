import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { clipRay, inClip, outcode, scaleClip, type Clip } from '../clip.js';
import { renderMesh } from '../raster.js';
import { addPass, renderVolume, type VrOpts } from '../vr.js';
import { pickSurface, pickVolume } from '../pick.js';
import { smoothSurface } from '../thick-slices.js';
import type { TF } from '../tf.js';
import { sampleIntensity, sphere, type V3 } from './phantoms.js';

// F13 (docs/PHASES.md): a crop box and a clip plane for both 3D modes.

const hash = (a: Uint8ClampedArray): string => createHash('sha256').update(a).digest('hex').slice(0, 16);

describe('the clip region (F13)', () => {
  const c: Clip = { box: { min: [0, 0, 0], max: [10, 10, 10] }, plane: { normal: [0, 0, 1], offset: 4 } };

  it('keeps the box on the plane\'s inner side', () => {
    assert.equal(inClip(c, 5, 5, 3), true);
    assert.equal(inClip(c, 5, 5, 5), false, 'past the plane');
    assert.equal(inClip(c, 11, 5, 3), false, 'outside the box');
  });

  it('gives each ray one interval', () => {
    assert.deepEqual(clipRay(c, [5, 5, 20], [0, 0, -1], -100, 100), [16, 20]);
    assert.deepEqual(clipRay(c, [-5, 5, 2], [1, 0, 0], -100, 100), [5, 15]);
    assert.equal(clipRay(c, [5, 5, 8], [1, 0, 0], -100, 100), null, 'parallel, past the plane');
    assert.equal(clipRay(c, [20, 20, 2], [0, 0, 1], -100, 100), null, 'misses the box');
  });

  it('codes each side a point is outside', () => {
    assert.equal(outcode(c, 5, 5, 3), 0);
    assert.equal(outcode(c, -1, 5, 3), 1);
    assert.equal(outcode(c, 11, 11, 3), 2 | 8);
    assert.equal(outcode(c, 5, 5, 11), 32 | 64, 'above the box and past the plane');
    // outcode 0 exactly where inClip keeps
    for (let k = 0; k < 500; k++) {
      const p = [Math.sin(k) * 14 + 5, Math.cos(k * 1.3) * 14 + 5, Math.sin(k * 0.7) * 14 + 5] as const;
      assert.equal(outcode(c, ...p) === 0, inClip(c, ...p));
    }
  });

  it('scales to other units', () => {
    const s = scaleClip(c, [2, 2, 5]);
    assert.deepEqual(s.box, { min: [0, 0, 0], max: [20, 20, 50] });
    // the voxel point (5, 5, 3) is the mm point (10, 10, 15): kept both ways
    assert.equal(inClip(s, 10, 10, 15), true);
    assert.equal(inClip(s, 10, 10, 25), false);
  });
});

describe('clipping the surface (F13)', () => {
  const ball = smoothSurface(sampleIntensity(sphere([16, 16, 16], 8), [32, 32, 32], [1, 1, 1]), 32, 32, 32, [1, 1, 1], 500, false).mesh;
  const dims: V3 = [32, 32, 32];
  const view = { width: 64, height: 64, angleY: 0, tiltX: 0, color: [200, 200, 200] as [number, number, number], supersample: 1 as const };
  const px = (img: Uint8ClampedArray, x: number, y: number): number => img[(y * 64 + x) * 4]!;

  it('a box around everything draws the same surface', () => {
    const plain = renderMesh(ball, dims, view);
    const all = renderMesh(ball, dims, { ...view, clip: { box: { min: [0, 0, 0], max: [32, 32, 32] } } });
    let differ = 0;
    for (let i = 0; i < plain.length; i += 4) if (plain[i] !== all[i]) differ++;
    // only where a back face ties a front one on the silhouette
    assert.ok(differ <= 3, `${differ} pixels differ`);
  });

  it('cutting the near half shows the inside, darker', () => {
    const plain = renderMesh(ball, dims, view);
    const cut = renderMesh(ball, dims, { ...view, clip: { plane: { normal: [0, 0, 1], offset: 16 } } });
    assert.ok(px(cut, 32, 32) < 0.75 * px(plain, 32, 32), `centre ${px(cut, 32, 32)} vs ${px(plain, 32, 32)}`);
    assert.notEqual(px(cut, 32, 32), 17, 'the inside is drawn, not background');
    // the pick goes through the cut to the far wall
    const hit = pickSurface(ball, dims, { ...view, clip: { plane: { normal: [0, 0, 1], offset: 16 } } }, 32, 32)!;
    assert.ok(Math.abs(hit.point[2] - 8) < 0.2, `hit z ${hit.point[2].toFixed(2)}`);
  });

  it('a box away from the surface leaves nothing', () => {
    const none = renderMesh(ball, dims, { ...view, clip: { box: { min: [0, 0, 0], max: [4, 4, 4] } } });
    for (let i = 0; i < none.length; i += 4) assert.equal(none[i], 17);
  });
});

describe('clipping the volume render (F13)', () => {
  const N = 32;
  const data = new Float64Array(N * N * N);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) data[(z * N + y) * N + x] = Math.hypot(x + 0.5 - 16, y + 0.5 - 16, z + 0.5 - 16) < 8 ? 1000 : 0;
  const vol = { dims: [N, N, N] as V3, data };
  const opaque: TF = [{ value: 0, color: [0, 0, 0], opacity: 0 }, { value: 499, color: [0, 0, 0], opacity: 0 }, { value: 500, color: [220, 220, 220], opacity: 0.9 }];
  const base: VrOpts = { width: 40, height: 40, angleY: 0.3, tiltX: 0.2, tf: opaque, step: 0.75, shade: true, spacing: [1, 1, 1.5] };

  it('a box around the whole volume samples the same points', () => {
    const plain = renderVolume(vol, base).rgba;
    const all = renderVolume(vol, { ...base, clip: { box: { min: [0, 0, 0], max: [N, N, N] } } }).rgba;
    assert.equal(hash(all), hash(plain));
    const pass = { ...base, jitter: { pass: 2, of: 4 } };
    assert.equal(hash(renderVolume(vol, { ...pass, clip: { box: { min: [0, 0, 0], max: [N, N, N] } } }).rgba), hash(renderVolume(vol, pass).rgba));
  });

  it('a plane through a solid ball shows its cut face', () => {
    const o: VrOpts = { ...base, angleY: 0, tiltX: 0, spacing: [1, 1, 1], clip: { plane: { normal: [0, 0, 1], offset: 16 } } };
    const hit = pickVolume(vol, o, 20, 20)!;
    // looking down −z at the plane z = 16 (+0.5: picks answer in the
    // meshes' voxel convention)
    assert.ok(Math.abs(hit.point[2] - 16.5) < 0.8, `hit z ${hit.point[2].toFixed(2)}`);
    assert.equal(pickVolume(vol, { ...o, clip: { box: { min: [0, 0, 0], max: [3, 3, 3] } } }, 20, 20), null);
  });

  it('a ball cut away casts no cinematic shadow', () => {
    // the F10 phantom: a plate, and a ball above it that shadows (40, 71)
    const M = 48, scene = new Float64Array(M * M * M);
    for (let z = 0; z < M; z++) for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
      const X = x + 0.5, Y = y + 0.5, Z = z + 0.5;
      scene[(z * M + y) * M + x] = (Z > 4 && Z < 8 && X > 4 && X < 44 && Y > 4 && Y < 44) || Math.hypot(X - 30, Y - 32, Z - 26) < 6 ? 1000 : 0;
    }
    const o: VrOpts = { width: 96, height: 96, angleY: 0, tiltX: 0, tf: opaque, step: 1, alphaStep: 1, shade: true, cinematic: true };
    const mean = (extra: Partial<VrOpts>): Uint8ClampedArray => {
      const sum = new Float32Array(96 * 96 * 4);
      let f: Uint8ClampedArray = new Uint8ClampedArray(0);
      for (let k = 0; k < 16; k++) f = addPass(sum, renderVolume({ dims: [M, M, M], data: scene }, { ...o, ...extra, jitter: { pass: k, of: 16 } }).rgba, k + 1);
      return f;
    };
    const patch = (img: Uint8ClampedArray, cx: number, cy: number): number => {
      let s = 0;
      for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) s += img[(y * 96 + x) * 4]!;
      return s / 25;
    };
    const lit = mean({}), cut = mean({ clip: { box: { min: [0, 0, 0], max: [M, M, 12] } } });
    assert.ok(patch(lit, 40, 71) < 0.7 * patch(lit, 74, 55), 'the ball shadows the plate');
    assert.ok(patch(cut, 40, 71) > 0.9 * patch(cut, 74, 55), `cut away: shadow ${patch(cut, 40, 71).toFixed(1)}, open ${patch(cut, 74, 55).toFixed(1)}`);
  });
});
