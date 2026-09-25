import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderMesh } from '../raster.js';
import type { TriMesh } from '../surface.js';
import { uvSphere as sphereAt } from './phantoms.js';

// Per-pixel shading and supersampled edges.

const BG = 17;

/** Radius 15 in the middle of the 40³ box. */
const uvSphere = (lat: number, lon: number): TriMesh => sphereAt([20, 20, 20], 15, lat, lon);

/** The same triangles with every vertex carrying its face's normal: what
 *  a per-face shader draws. */
function faceted(m: TriMesh): TriMesh {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const P = m.positions, I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    const p = [0, 1, 2].map((k) => [P[I[t + k]! * 3]!, P[I[t + k]! * 3 + 1]!, P[I[t + k]! * 3 + 2]!]);
    const u = [0, 1, 2].map((c) => p[1]![c]! - p[0]![c]!), w = [0, 1, 2].map((c) => p[2]![c]! - p[0]![c]!);
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const l = Math.hypot(...n) || 1;
    for (const q of p) { idx.push(pos.length / 3); pos.push(...q); nrm.push(n[0]! / l, n[1]! / l, n[2]! / l); }
  }
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), indices: Uint32Array.from(idx) };
}

/** Largest brightness step between horizontal neighbours inside the shape
 *  (both pixels and their outer neighbours lit, so silhouettes don't count). */
function maxStep(out: Uint8ClampedArray, W: number, H: number): number {
  const lit = (x: number, y: number): boolean => out[(y * W + x) * 4] !== BG;
  let max = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 1; x < W - 2; x++) {
      if (!lit(x - 1, y) || !lit(x, y) || !lit(x + 1, y) || !lit(x + 2, y)) continue;
      max = Math.max(max, Math.abs(out[(y * W + x) * 4]! - out[(y * W + x + 1) * 4]!));
    }
  }
  return max;
}

const VIEW = { width: 160, height: 160, angleY: 0, tiltX: 0, color: [150, 150, 150] as [number, number, number] };
const DIMS: [number, number, number] = [40, 40, 40];

describe('per-pixel shading (F6)', () => {
  it('interpolated normals hide the triangles a per-face shader shows', () => {
    const smooth = renderMesh(uvSphere(10, 20), DIMS, { ...VIEW, supersample: 1 });
    const flat = renderMesh(faceted(uvSphere(10, 20)), DIMS, { ...VIEW, supersample: 1 });
    const a = maxStep(smooth, 160, 160), b = maxStep(flat, 160, 160);
    assert.ok(a * 3 < b, `neighbour step: smooth ${a}, faceted ${b}`);
  });

  it('adds a soft highlight where the surface faces between light and eye', () => {
    const out = renderMesh(uvSphere(24, 48), DIMS, { ...VIEW, supersample: 1 });
    let max = 0, mx = 0, my = 0;
    for (let i = 0; i < out.length; i += 4) if (out[i]! > max) { max = out[i]!; mx = (i / 4) % 160; my = Math.floor(i / 4 / 160); }
    // diffuse alone tops out at the base colour, 150
    assert.ok(max > 175, `brightest ${max}`);
    // the half vector points up and right of centre (light at x+, y+)
    assert.ok(mx > 80 && my < 80, `highlight at (${mx}, ${my})`);
  });

  it('2× supersampling blends edge pixels; 1× leaves them hard', () => {
    // a camera-facing square whose left edge lands at x = 11.3 px (0.92 px
    // per voxel at this size): the 1× sample at 11.5 is inside, the 2×
    // samples at 11.25 and 11.75 straddle it
    const sq: TriMesh = {
      positions: Float32Array.from([10.55, 10, 20, 30, 10, 20, 30, 30, 20, 10.55, 30, 20]),
      normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    };
    const levels = (out: Uint8ClampedArray): Set<number> => {
      const s = new Set<number>();
      for (let i = 0; i < out.length; i += 4) s.add(out[i]!);
      return s;
    };
    const hard = levels(renderMesh(sq, DIMS, { ...VIEW, width: 40, height: 40, supersample: 1 }));
    const soft = levels(renderMesh(sq, DIMS, { ...VIEW, width: 40, height: 40, supersample: 2 }));
    assert.equal(hard.size, 2, `1×: background and fill only, got ${[...hard].join(',')}`);
    assert.ok(soft.size > 2, `2×: edge pixels between them, got ${[...soft].join(',')}`);
  });

  it('draws a facing triangle whose vertex normals mostly lean away', () => {
    // on a wrinkled mask surface this is a silhouette triangle; culling it
    // on the mean normal left a background pinhole
    const tri: TriMesh = {
      positions: Float32Array.from([20, 30, 20, 10, 10, 20, 30, 10, 20]),
      normals: Float32Array.from([0, 0, 1, -0.8, 0, -0.6, 0.8, 0, -0.6]),
      indices: Uint32Array.from([0, 1, 2]),
    };
    const out = renderMesh(tri, DIMS, { ...VIEW, supersample: 1 });
    const c = (80 * 160 + 80) * 4;
    assert.notEqual(out[c], BG, 'centre pixel is background');
  });

  it('rejects a supersampling factor it does not implement', () => {
    assert.throws(() => renderMesh(uvSphere(4, 8), DIMS, { ...VIEW, supersample: 3 as 2 }), /raster-supersample/);
  });
});
