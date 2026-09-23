import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decimate, lodChain } from '../decimate.js';
import { maskNets } from '../surface-nets.js';
import { smoothSurface } from '../thick-slices.js';
import type { TriMesh } from '../surface.js';
import { box, capsule, ellipsoid, sampleIntensity, sampleMask, sphere, surfaceDistance, torus, type Phantom, type V3 } from './phantoms.js';

// F11 (docs/PHASES.md): quadric-error decimation and the orbit level chain.

/** The app's bound (lib/extractor.ts LOD_MAX_ERROR), mm. */
const APP_MAX_ERROR = 0.5;

const toMm = (m: TriMesh, sp: V3): TriMesh => ({ ...m, positions: Float32Array.from(m.positions, (v, i) => v * sp[i % 3]!) });

/** Edges by how many faces use them. */
function edgeUse(I: ArrayLike<number>, nv: number): Map<number, number> {
  const m = new Map<number, number>();
  for (let t = 0; t < I.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = I[t + k]!, b = I[t + ((k + 1) % 3)]!;
      const key = Math.min(a, b) * nv + Math.max(a, b);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
  }
  return m;
}

describe('decimation within 0.2 mm on the phantoms (F11)', () => {
  const CASES: { id: string; ph: Phantom; dims: V3; sp: V3 }[] = [
    { id: 'sphere', ph: sphere([16, 16, 16], 10), dims: [32, 32, 32], sp: [1, 1, 1] },
    { id: 'ellipsoid 0.8×0.8×2.5 mm', ph: ellipsoid([16, 16, 17.5], [12, 9, 7]), dims: [40, 40, 14], sp: [0.8, 0.8, 2.5] },
    { id: 'torus', ph: torus([20, 20, 10], 11, 4), dims: [40, 40, 20], sp: [1, 1, 1] },
    { id: 'box', ph: box([16, 16, 16], [8, 6, 5]), dims: [32, 32, 32], sp: [1, 1, 1] },
    { id: 'capsule', ph: capsule([8, 16, 16], [24, 16, 16], 5), dims: [32, 32, 32], sp: [1, 1, 1] },
  ];
  for (const c of CASES) {
    it(`${c.id}: image and mask surfaces, 16× asked, the app's bound`, () => {
      const [nx, ny, nz] = c.dims;
      const surfaces = {
        image: smoothSurface(sampleIntensity(c.ph, c.dims, c.sp), nx, ny, nz, c.sp, 500, false).mesh,
        mask: smoothSurface(sampleMask(c.ph, c.dims, c.sp), nx, ny, nz, c.sp, 0, true).mesh,
      };
      for (const [path, mesh] of Object.entries(surfaces)) {
        const full = toMm(mesh, c.sp);
        const tris = full.indices.length / 3;
        const dec = decimate(full, { targetTris: Math.ceil(tris / 16), maxError: APP_MAX_ERROR });
        const kept = dec.indices.length / 3;
        // both ways: moved vertices, and full-mesh points under big new faces
        const there = surfaceDistance(dec, full, [1, 1, 1], 1), back = surfaceDistance(full, dec, [1, 1, 1], 1);
        const worst = Math.max(there.max, back.max);
        assert.ok(worst <= 0.2, `${path}: ${tris} → ${kept} tris, ${worst.toFixed(3)} mm`);
        assert.ok(kept * 4 <= tris, `${path}: only ${tris} → ${kept} tris`);
      }
    });
  }
});

describe('decimation keeps the surface a surface (F11)', () => {
  it('a flat grid folds to a few triangles at zero error, border kept', () => {
    // a 20 × 20 grid of quads in the plane z = 3
    const pos: number[] = [], idx: number[] = [];
    for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) pos.push(i, j, 3);
    for (let j = 0; j < 20; j++) {
      for (let i = 0; i < 20; i++) {
        const a = j * 21 + i;
        idx.push(a, a + 1, a + 22, a, a + 22, a + 21);
      }
    }
    const grid: TriMesh = { positions: Float32Array.from(pos), normals: new Float32Array(pos.length), indices: Uint32Array.from(idx) };
    const d = decimate(grid, { targetTris: 2, maxError: 1e-9 });
    assert.ok(d.indices.length / 3 < 80, `${d.indices.length / 3} triangles left of 800`);
    for (let i = 2; i < d.positions.length; i += 3) assert.ok(Math.abs(d.positions[i]! - 3) < 1e-9, 'left the plane');
    // the four corners survive, and nothing leaves the square
    const has = (x: number, y: number): boolean => {
      for (let i = 0; i < d.positions.length; i += 3) if (Math.abs(d.positions[i]! - x) < 1e-6 && Math.abs(d.positions[i + 1]! - y) < 1e-6) return true;
      return false;
    };
    for (const [x, y] of [[0, 0], [20, 0], [0, 20], [20, 20]]) assert.ok(has(x!, y!), `corner (${x}, ${y})`);
    for (let i = 0; i < d.positions.length; i += 3) assert.ok(d.positions[i]! >= -1e-9 && d.positions[i]! <= 20 + 1e-9 && d.positions[i + 1]! >= -1e-9 && d.positions[i + 1]! <= 20 + 1e-9);
  });

  it('a closed sphere stays closed, genus 0, facing out', () => {
    // the phantom's image surface: closed, every edge between two faces
    const s = smoothSurface(sampleIntensity(sphere([16, 16, 16], 10), [32, 32, 32], [1, 1, 1]), 32, 32, 32, [1, 1, 1], 500, false).mesh;
    const ball = { ...s, positions: Float32Array.from(s.positions, (v) => v - 16) };
    const d = decimate(ball, { targetTris: 300, maxError: 5 });
    const nv = d.positions.length / 3, use = edgeUse(d.indices, nv);
    assert.ok([...use.values()].every((n) => n === 2), 'every edge between two faces');
    assert.equal(nv - use.size + d.indices.length / 3, 2, 'V − E + F');
    for (let i = 0; i < d.positions.length; i += 3) {
      const out = d.positions[i]! * d.normals[i]! + d.positions[i + 1]! * d.normals[i + 1]! + d.positions[i + 2]! * d.normals[i + 2]!;
      assert.ok(out > 0, `vertex ${i / 3} normal faces in`);
    }
  });

  it('small pieces and needle faces are left as they are', () => {
    // a 20 × 20 grid in z = 3 whose column 10 is squeezed to 0.001 wide
    // (extraction noise on thick slices leaves needles like it), and a
    // separate 4-face speck
    const xs = (i: number): number => (i <= 10 ? i : i - 0.999);
    const pos: number[] = [], idx: number[] = [];
    for (let j = 0; j <= 20; j++) for (let i = 0; i <= 21; i++) pos.push(xs(i), j, 3);
    for (let j = 0; j < 20; j++) {
      for (let i = 0; i < 21; i++) {
        const a = j * 22 + i;
        idx.push(a, a + 1, a + 23, a, a + 23, a + 22);
      }
    }
    const o = pos.length / 3;
    pos.push(40, 40, 0, 41, 40, 0, 40, 41, 0, 40, 40, 1);
    idx.push(o, o + 2, o + 1, o, o + 1, o + 3, o + 1, o + 2, o + 3, o, o + 3, o + 2);
    const mesh: TriMesh = { positions: Float32Array.from(pos), normals: new Float32Array(pos.length), indices: Uint32Array.from(idx) };
    const d = decimate(mesh, { targetTris: 2, maxError: 1e-9 });
    const at = (x: number, y: number, z: number): boolean => {
      for (let i = 0; i < d.positions.length; i += 3) if (Math.abs(d.positions[i]! - x) < 1e-5 && Math.abs(d.positions[i + 1]! - y) < 1e-5 && Math.abs(d.positions[i + 2]! - z) < 1e-5) return true;
      return false;
    };
    for (let j = 0; j <= 20; j++) assert.ok(at(10, j, 3) && at(10.001, j, 3), `needle row ${j}`);
    for (const [x, y, z] of [[40, 40, 0], [41, 40, 0], [40, 41, 0], [40, 40, 1]]) assert.ok(at(x!, y!, z!), 'speck');
    assert.ok(d.indices.length / 3 < mesh.indices.length / 3 / 2, 'the rest of the grid still folds');
  });

  it('vertices on an edge four faces share stay where they are', () => {
    // two voxels touching along one edge: surface nets makes a 4-face edge
    const m = new Uint8Array(7 * 7 * 7);
    m[(2 * 7 + 2) * 7 + 2] = 1; m[(2 * 7 + 3) * 7 + 3] = 1;
    const mesh = maskNets(m, 7, 7, 7, { iterations: 0 });
    const nv = mesh.positions.length / 3, use = edgeUse(mesh.indices, nv);
    const pinned = new Set<string>();
    for (const [key, n] of use) {
      if (n <= 2) continue;
      for (const v of [Math.floor(key / nv), key % nv]) pinned.add([0, 1, 2].map((k) => mesh.positions[v * 3 + k]!.toFixed(5)).join());
    }
    // (its two ends coincide, one per voxel's cell, so one position)
    assert.ok(pinned.size >= 1, 'the fixture has a non-manifold edge');
    const d = decimate(mesh, { targetTris: 4, maxError: 10 });
    const after = new Set<string>();
    for (let i = 0; i < d.positions.length; i += 3) after.add([0, 1, 2].map((k) => d.positions[i + k]!.toFixed(5)).join());
    for (const p of pinned) assert.ok(after.has(p), `moved ${p}`);
  });
});

describe('the level-of-detail chain (F11)', () => {
  // a clean closed surface (a lat/long sphere's pole is a fan of needles)
  const s = smoothSurface(sampleIntensity(sphere([24, 24, 24], 20), [48, 48, 48], [1, 1, 1]), 48, 48, 48, [1, 1, 1], 500, false).mesh;
  const ball: TriMesh = { ...s, positions: Float32Array.from(s.positions, (v) => v - 24) };

  it('is empty within budget, and steps down by quarters to it', () => {
    assert.deepEqual(lodChain(ball, { budget: 1e6, maxError: 1 }), []);
    const levels = lodChain(ball, { budget: 1000, maxError: 2 });
    const tris = [ball.indices.length / 3, ...levels.map((l) => l.indices.length / 3)];
    assert.ok(tris.length >= 3, `levels ${tris.join(' → ')}`);
    for (let i = 1; i < tris.length; i++) assert.ok(tris[i]! * 3 <= tris[i - 1]! * 2, `levels ${tris.join(' → ')}`);
    assert.ok(tris[tris.length - 1]! <= 1000, `levels ${tris.join(' → ')}`);
  });

  it('stops where the bound does', () => {
    // a 0.01 mm bound on a radius-20 sphere allows little
    const levels = lodChain(ball, { budget: 100, maxError: 0.01 });
    const last = levels.length ? levels[levels.length - 1]!.indices.length / 3 : ball.indices.length / 3;
    assert.ok(last > 100, `reached ${last} under a 0.01 mm bound`);
    for (const l of levels) assert.ok(surfaceDistance(l, ball, [1, 1, 1], 1).max <= 0.02);
  });

  it('rejects a target or bound that is not positive', () => {
    assert.throws(() => decimate(ball, { targetTris: 0, maxError: 1 }), /decimate-opts/);
    assert.throws(() => lodChain(ball, { budget: 10, maxError: 0 }), /decimate-opts/);
  });
});
