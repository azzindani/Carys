import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderMesh } from '../raster.js';
import { ambientOcclusion, silhouettes, type GBuffer } from '../screen-space.js';
import { surfaceNets } from '../surface-nets.js';
import type { TriMesh } from '../surface.js';
import { uvSphere } from './phantoms.js';

// F7 (docs/PHASES.md): ambient occlusion and outlines as a post-pass.

/** A depth buffer with every normal facing the viewer. */
function gbuf(W: number, H: number, z: (x: number, y: number) => number): GBuffer {
  const depth = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) depth[y * W + x] = z(x, y);
  return { width: W, height: H, depth, nx: new Float32Array(W * H), ny: new Float32Array(W * H), nz: new Float32Array(W * H).fill(1) };
}

const AO = { radiusPx: 8, unitPerPx: 1, strength: 3 };

describe('ambient occlusion (F7)', () => {
  it('leaves a flat surface and the background at full light', () => {
    const g = gbuf(40, 40, (x) => (x < 30 ? 5 : -Infinity));
    const a = ambientOcclusion(g, AO);
    assert.ok(a.every((v) => v === 1), `min ${Math.min(...a)}`);
  });

  it('darkens the floor of a groove and nothing far from it', () => {
    // a 6-pixel groove 3 units deep in a plane, normals up; its centre
    // sees both walls (measured 0.78, 0.84 at a wall)
    const g = gbuf(40, 40, (x) => (x >= 17 && x < 23 ? 0 : 3));
    const a = ambientOcclusion(g, AO);
    const at = (x: number): number => a[20 * 40 + x]!;
    for (const x of [17, 20, 22]) assert.ok(at(x) < 0.9, `floor at ${x}: ${at(x)}`);
    assert.equal(at(5), 1, 'plane far from the groove');
  });

  it('ignores a surface in front farther away than the radius (no halo)', () => {
    const g = gbuf(40, 40, (x) => (x < 20 ? 0 : 50));
    const a = ambientOcclusion(g, AO);
    assert.equal(a[20 * 40 + 18], 1);
  });

  it('rejects a disc that samples nothing', () => {
    assert.throws(() => ambientOcclusion(gbuf(4, 4, () => 0), { ...AO, radiusPx: 0.5 }), /ao-radius/);
    assert.throws(() => ambientOcclusion(gbuf(4, 4, () => 0), { ...AO, unitPerPx: 0 }), /ao-radius/);
  });
});

describe('silhouettes (F7)', () => {
  it('marks the near side of a step deeper than the gap, one reach wide', () => {
    const W = 20, H = 20;
    const d = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = x < 5 ? -Infinity : x < 12 ? 10 : 0;
    const e = silhouettes(d, W, H, 2, 4);
    const row = Array.from(e.subarray(10 * W, 11 * W)).join('');
    // background edge at 5–6, the 10 → 0 step at 10–11; the far side unmarked
    assert.equal(row, '00000110001100000000');
  });

  it('ignores steps within the gap', () => {
    const d = Float32Array.from({ length: 100 }, (_, i) => (i % 10 < 5 ? 3 : 0));
    assert.ok(silhouettes(d, 10, 10, 1, 4).every((v) => v === 0));
  });
});

/** A slab with a slot 4 voxels wide and 3 deep along y, voxel-centre
 *  convention, in a 40³ box: the slot is inside the occlusion radius at
 *  this view (0.1 × 160 px ≈ 4.3 voxels). */
function crevice(): TriMesh {
  const N = 40, f = new Float32Array(N * N * N);
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
        const slab = cx > 4 && cx < 36 && cy > 4 && cy < 36 && cz > 4 && cz < 24;
        const slot = Math.abs(cx - 20) < 2 && cz > 21;
        f[(z * N + y) * N + x] = slab && !slot ? 1 : 0;
      }
    }
  }
  return surfaceNets(f, N, N, N, 0.5);
}

const VIEW = { width: 160, height: 160, angleY: 0, tiltX: 0, color: [200, 200, 200] as [number, number, number] };
const DIMS: [number, number, number] = [40, 40, 40];
/** mean red over columns x0..x1, rows 60..100 (well inside the slab) */
const band = (out: Uint8ClampedArray, x0: number, x1: number): number => {
  let s = 0, n = 0;
  for (let y = 60; y <= 100; y++) for (let x = x0; x <= x1; x++) { s += out[(y * 160 + x) * 4]!; n++; }
  return s / n;
};
// screen columns: x = 80 + (voxel x − 20) × 3.68
const FLOOR: [number, number] = [79, 81], RIM: [number, number] = [41, 45];

describe('depth cues in the rasterizer (F7)', () => {
  const mesh = crevice();

  it('a crevice renders darker than its rim, and only because of occlusion', () => {
    const plain = renderMesh(mesh, DIMS, VIEW);
    const ao = renderMesh(mesh, DIMS, { ...VIEW, ao: true });
    // same normal, same light: without occlusion floor and rim match
    assert.ok(Math.abs(band(plain, ...FLOOR) - band(plain, ...RIM)) <= 1, `plain ${band(plain, ...FLOOR)} vs ${band(plain, ...RIM)}`);
    assert.ok(band(ao, ...FLOOR) < 0.93 * band(ao, ...RIM), `floor ${band(ao, ...FLOOR)}, rim ${band(ao, ...RIM)}`);
    assert.equal(band(ao, ...RIM), band(plain, ...RIM), 'the open rim keeps its light');
    // orbit frames estimate occlusion on a coarser grid: same verdict
    const fast = renderMesh(mesh, DIMS, { ...VIEW, supersample: 1, ao: true });
    assert.ok(band(fast, ...FLOOR) < 0.93 * band(fast, ...RIM), `1×: floor ${band(fast, ...FLOOR)}, rim ${band(fast, ...RIM)}`);
  });

  it('leaves a convex surface unshaded', () => {
    // every sample of a sphere lies below its tangent plane (measured: 5
    // pixels of 160² move by one grey level, rounding)
    const ball = uvSphere([20, 20, 20], 15, 24, 48);
    const o = { ...VIEW, angleY: 0.3, tiltX: 0.2 };
    const plain = renderMesh(ball, DIMS, o), ao = renderMesh(ball, DIMS, { ...o, ao: true });
    let max = 0;
    for (let i = 0; i < plain.length; i += 4) max = Math.max(max, Math.abs(plain[i]! - ao[i]!));
    assert.ok(max <= 1, `largest change ${max}`);
  });

  it('outlines a near square over a far one, and the far one on the background', () => {
    // camera-facing quads: far z = 10 over voxel x 8..32, near z = 30 over
    // 16..24 — a 20-voxel step, ~74 pixel widths at this size
    const quad = (x0: number, x1: number, z: number): number[] => [x0, 10, z, x1, 10, z, x1, 30, z, x0, 30, z];
    const pair: TriMesh = {
      positions: Float32Array.from([...quad(8, 32, 10), ...quad(16, 24, 30)]),
      normals: new Float32Array(24).map((_, i) => (i % 3 === 2 ? 1 : 0)),
      indices: Uint32Array.from([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
    };
    const plain = renderMesh(pair, DIMS, { ...VIEW, supersample: 1 });
    const lined = renderMesh(pair, DIMS, { ...VIEW, supersample: 1, outline: true });
    const px = (out: Uint8ClampedArray, x: number): number => out[(80 * 160 + x) * 4]!;
    const outlined = [...Array(160).keys()].filter((x) => px(lined, x) !== px(plain, x));
    // column centres x + 0.5 against 80 + (voxel x − 20) × 3.68: the far
    // quad covers 36..123, the near one 65..94. Only the near side of each
    // step is drawn: the far quad's ends on the background, the near
    // quad's ends on the far one.
    assert.deepEqual(outlined, [36, 65, 94, 123]);
    // 0.6 of the unrounded colour
    assert.ok(Math.abs(px(lined, 65) - px(plain, 65) * 0.6) <= 1, `outline ${px(lined, 65)} of ${px(plain, 65)}`);
  });

  it('is deterministic: a golden of the crevice with both cues', () => {
    const a = renderMesh(mesh, DIMS, { ...VIEW, ao: true, outline: true });
    const b = renderMesh(mesh, DIMS, { ...VIEW, ao: true, outline: true });
    assert.deepEqual(a, b);
    const hash = createHash('sha256').update(a).digest('hex').slice(0, 16);
    assert.equal(hash, '2e4626c14d04b8e2');
  });
});
