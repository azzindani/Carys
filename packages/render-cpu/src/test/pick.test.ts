import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickSurface, pickVolume } from '../pick.js';
import { renderMesh } from '../raster.js';
import { renderVolume, type VrOpts } from '../vr.js';
import { smoothSurface } from '../thick-slices.js';
import type { TF } from '../tf.js';
import { sampleIntensity, sphere, type V3 } from './phantoms.js';

// F12 (docs/PHASES.md): picking lands where the renderers drew.

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('surface picking (F12)', () => {
  // radius 8 around (16, 16, 16) in a 32³ box, voxel convention
  const ball = smoothSurface(sampleIntensity(sphere([16, 16, 16], 8), [32, 32, 32], [1, 1, 1]), 32, 32, 32, [1, 1, 1], 500, false).mesh;
  const dims: V3 = [32, 32, 32];

  it('hits the front of a sphere under the centre, and misses beside it', () => {
    const view = { width: 64, height: 64, angleY: 0, tiltX: 0 };
    const hit = pickSurface(ball, dims, view, 32, 32)!;
    // looking down −z: the front is at z = 16 + 8
    assert.ok(dist(hit.point, [16, 16, 24]) < 0.1, `hit ${hit.point.map((v) => v.toFixed(2))}`);
    assert.deepEqual(hit.dir.map((v) => Math.round(v * 1e9) / 1e9), [0, -0, -1]);
    assert.equal(pickSurface(ball, dims, view, 2, 2), null);
  });

  it('follows orbit, tilt, zoom and the orbit centre', () => {
    const c: V3 = [18, 15, 16];
    const view = { width: 80, height: 60, angleY: 0.7, tiltX: 0.3, zoom: 2, center: c };
    const hit = pickSurface(ball, dims, view, 40, 30)!;
    // the screen centre looks along dir through c: the first surface point
    // on that line, found analytically
    const d = hit.dir, oc: V3 = [c[0] - 16, c[1] - 16, c[2] - 16];
    const b = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2];
    const t = -b - Math.sqrt(b * b - (oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - 64));
    const want: V3 = [c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t];
    assert.ok(dist(hit.point, want) < 0.15, `hit ${hit.point.map((v) => v.toFixed(2))}, want ${want.map((v) => v.toFixed(2))}`);
  });

  it('hits exactly the pixels the rasterizer drew', () => {
    const view = { width: 48, height: 40, angleY: -0.4, tiltX: 0.5, zoom: 1.3 };
    const img = renderMesh(ball, dims, { ...view, color: [200, 200, 200], supersample: 1 });
    let differ = 0;
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 48; x++) {
        const drawn = img[(y * 48 + x) * 4] !== 17;
        if (drawn !== (pickSurface(ball, dims, view, x + 0.5, y + 0.5) !== null)) differ++;
      }
    }
    assert.equal(differ, 0);
  });
});

describe('volume picking (F12)', () => {
  const N = 32;
  const data = new Float64Array(N * N * N);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) data[(z * N + y) * N + x] = Math.hypot(x + 0.5 - 16, y + 0.5 - 16, z + 0.5 - 16) < 8 ? 1000 : 0;
  const vol = { dims: [N, N, N] as V3, data };
  const opaque: TF = [{ value: 0, color: [0, 0, 0], opacity: 0 }, { value: 499, color: [0, 0, 0], opacity: 0 }, { value: 500, color: [220, 220, 220], opacity: 0.9 }];
  const base: VrOpts = { width: 64, height: 64, angleY: 0, tiltX: 0, tf: opaque, step: 0.5 };

  it('lands where the ray turns opaque: the ball\'s surface', () => {
    const hit = pickVolume(vol, base, 32, 32)!;
    assert.ok(Math.abs(dist(hit.point, [16, 16, 16]) - 8) < 0.75, `hit ${hit.point.map((v) => v.toFixed(2))}`);
    assert.ok(hit.point[2] > 16, 'on the near side');
    assert.equal(pickVolume(vol, base, 2, 2), null);
  });

  it('keeps to voxels on an anisotropic grid, and inside its bounds', () => {
    // the same ball on 1 × 1 × 2 mm voxels: half the slices
    const half = new Float64Array(N * N * (N / 2));
    for (let z = 0; z < N / 2; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) half[(z * N + y) * N + x] = Math.hypot(x + 0.5 - 16, y + 0.5 - 16, (z + 0.5) * 2 - 16) < 8 ? 1000 : 0;
    const o: VrOpts = { ...base, spacing: [1, 1, 2], bounds: { min: [4, 4, 2], max: [28, 28, 14] } };
    const hit = pickVolume({ dims: [N, N, N / 2], data: half }, o, 32, 32)!;
    // near surface at 24 mm = slice 12
    assert.ok(Math.abs(hit.point[2] - 12) < 0.6 && Math.abs(hit.point[0] - 16) < 0.6, `hit ${hit.point.map((v) => v.toFixed(2))}`);
  });

  it('a faint cloud gives its most visible sample', () => {
    const faint: TF = [{ value: 0, color: [0, 0, 0], opacity: 0 }, { value: 499, color: [0, 0, 0], opacity: 0 }, { value: 500, color: [220, 220, 220], opacity: 0.01 }];
    const hit = pickVolume(vol, { ...base, tf: faint }, 32, 32)!;
    assert.ok(dist(hit.point, [16, 16, 16]) <= 8.5, `hit ${hit.point.map((v) => v.toFixed(2))}`);
  });

  it('agrees with the render about what is there', () => {
    const img = renderVolume(vol, base).rgba;
    let differ = 0;
    for (let y = 0; y < 64; y += 3) {
      for (let x = 0; x < 64; x += 3) {
        const drawn = img[(y * 64 + x) * 4] !== 17;
        if (drawn !== (pickVolume(vol, base, x, y) !== null)) differ++;
      }
    }
    assert.equal(differ, 0);
  });
});
