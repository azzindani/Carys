import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractBoundary } from '../surface.js';
import { surfaceNets } from '../surface-nets.js';
import {
  ellipsoid, erf, sampleIntensity, sampleMask, scoreMesh, sphere, torus,
  type Phantom, type SurfaceScore, type V3,
} from './phantoms.js';

// F1 (docs/PHASES.md): surface accuracy measured against analytic shapes,
// in mm, on the grids a scanner produces. The baseline table records where
// today's extraction paths stand; every later 3D-fidelity item has to beat
// it with its own acceptance test, and a change that moves these numbers
// has to say why.

interface Case { id: string; ph: Phantom; dims: V3; sp: V3 }

const CASES: Case[] = [
  { id: 'sphere-iso', ph: sphere([16, 16, 16], 10), dims: [32, 32, 32], sp: [1, 1, 1] },
  // 5 mm slices, the covid chest CT's geometry
  { id: 'sphere-thick', ph: sphere([16, 16, 17.5], 10), dims: [32, 32, 7], sp: [1, 1, 5] },
  { id: 'ellipsoid-aniso', ph: ellipsoid([16, 16, 17.5], [12, 9, 7]), dims: [40, 40, 14], sp: [0.8, 0.8, 2.5] },
  // saddle regions: concave and convex curvature in one shape
  { id: 'torus-iso', ph: torus([20, 20, 10], 11, 4), dims: [40, 40, 20], sp: [1, 1, 1] },
];

/** The four paths the app has today (extract worker: threshold T, smooth
 *  iso T + 0.5; masks at 0 / 0.5). */
const THRESHOLD = 500;
function paths(c: Case): Record<string, { positions: Float32Array; indices: Uint32Array }> {
  const [nx, ny, nz] = c.dims;
  const f = sampleIntensity(c.ph, c.dims, c.sp);
  const m = sampleMask(c.ph, c.dims, c.sp);
  return {
    'blocky-image': extractBoundary(f, nx, ny, nz, THRESHOLD),
    'smooth-image': surfaceNets(f, nx, ny, nz, THRESHOLD + 0.5),
    'blocky-mask': extractBoundary(m, nx, ny, nz, 0),
    'smooth-mask': surfaceNets(m, nx, ny, nz, 0.5),
  };
}

type Row = [meanErr: number, maxErr: number, volErrPct: number, normalDevDeg: number];

/** Measured 2026-09-23 (F1). mm, mm, %, degrees. */
const BASELINE: Record<string, Record<string, Row>> = {
  'sphere-iso': {
    'blocky-image': [0.342, 0.770, 0.84, 45.0], 'smooth-image': [0.430, 0.907, -1.87, 5.4],
    'blocky-mask': [0.342, 0.770, 0.84, 45.0], 'smooth-mask': [0.444, 1.051, -0.19, 12.6],
  },
  'sphere-thick': {
    'blocky-image': [0.927, 2.500, -4.98, 43.3], 'smooth-image': [1.436, 3.938, -8.55, 19.0],
    'blocky-mask': [0.927, 2.500, -4.98, 43.3], 'smooth-mask': [1.453, 4.950, -8.56, 25.2],
  },
  'ellipsoid-aniso': {
    'blocky-image': [0.619, 1.493, 1.05, 44.4], 'smooth-image': [0.888, 2.069, -1.82, 13.9],
    'blocky-mask': [0.619, 1.493, 1.05, 44.4], 'smooth-mask': [0.895, 2.953, -1.19, 24.2],
  },
  'torus-iso': {
    'blocky-image': [0.320, 0.835, 2.24, 41.3], 'smooth-image': [0.436, 0.923, -2.26, 7.8],
    'blocky-mask': [0.320, 0.835, 2.24, 41.3], 'smooth-mask': [0.446, 1.140, 0.11, 13.1],
  },
};

const near = (got: number, want: number, tol: number, what: string): void => {
  assert.ok(Math.abs(got - want) <= tol, `${what}: measured ${got.toFixed(3)}, baseline ${want}`);
};

/** A latitude/longitude sphere with every vertex exactly on the surface,
 *  wound outward (∂θ × ∂φ points away from the centre). */
function uvSphere(c: V3, r: number, lat: number, lon: number): { positions: Float32Array; indices: Uint32Array } {
  const pos: number[] = [];
  for (let i = 0; i <= lat; i++) {
    const th = (Math.PI * i) / lat;
    for (let j = 0; j < lon; j++) {
      const ph = (2 * Math.PI * j) / lon;
      pos.push(c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.sin(th) * Math.sin(ph), c[2] + r * Math.cos(th));
    }
  }
  const idx: number[] = [];
  const v = (i: number, j: number): number => i * lon + (j % lon);
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) idx.push(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i, j + 1));
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

describe('F1 accuracy harness', () => {
  it('erf matches reference values', () => {
    near(erf(0), 0, 1e-7, 'erf(0)');
    near(erf(1), 0.8427007929, 2e-7, 'erf(1)');
    near(erf(-0.5), -0.5204998778, 2e-7, 'erf(-0.5)');
  });

  it('scores an exact mesh as exact, and a known shift as that shift', () => {
    const ph = sphere([16, 16, 16], 10);
    const exact = uvSphere([16, 16, 16], 10, 48, 96);
    const s = scoreMesh(exact, [1, 1, 1], ph);
    assert.ok(s.meanErr < 1e-4 && s.maxErr < 1e-4, `on-surface vertices: ${s.meanErr}, ${s.maxErr}`);
    assert.ok(s.volErrPct < 0 && s.volErrPct > -0.5, `inscribed polyhedron is slightly smaller: ${s.volErrPct}%`);
    assert.ok(s.normalDevDeg < 2, `faceting only: ${s.normalDevDeg}°`);
    const moved = { positions: exact.positions.map((x, i) => (i % 3 === 0 ? x + 0.5 : x)), indices: exact.indices };
    const m = scoreMesh(moved, [1, 1, 1], ph);
    near(m.maxErr, 0.5, 0.01, 'a 0.5 mm shift peaks at 0.5 mm');
    near(m.volErrPct, s.volErrPct, 1e-3, 'a shift keeps the volume');
    // grid spacing is applied: the same mesh on a 2 mm grid is twice as far
    const big = scoreMesh(moved, [2, 2, 2], sphere([32, 32, 32], 20));
    near(big.maxErr, 1, 0.02, 'spacing scales the error');
  });

  it('samples the surface at half height, at voxel centres', () => {
    // a plane at z = 10 mm on a 1 mm grid: the value at the voxel centre
    // 9.5 mm is above half, at 10.5 mm below, symmetric about 500
    const plane: Phantom = { name: 'plane', sdf: (p) => p[2] - 10, normal: () => [0, 0, 1], volume: 1 };
    const f = sampleIntensity(plane, [1, 1, 20], [1, 1, 1]);
    near(f[9]! + f[10]!, 1000, 1e-6, 'symmetric about the surface');
    assert.ok(f[9]! > 500 && f[10]! < 500);
    const m = sampleMask(plane, [1, 1, 20], [1, 1, 1]);
    assert.equal(m[9], 1);
    assert.equal(m[10], 0);
  });

  it("today's extraction paths match the recorded baseline", () => {
    for (const c of CASES) {
      const got = paths(c);
      for (const [path, mesh] of Object.entries(got)) {
        const s: SurfaceScore = scoreMesh(mesh, c.sp, c.ph);
        const [mean, max, vol, dev] = BASELINE[c.id]![path]!;
        const what = `${c.id} ${path}`;
        assert.ok(mesh.indices.length > 0, `${what}: empty mesh`);
        near(s.meanErr, mean, 0.005, `${what} mean error`);
        near(s.maxErr, max, 0.005, `${what} max error`);
        near(s.volErrPct, vol, 0.05, `${what} volume`);
        near(s.normalDevDeg, dev, 0.1, `${what} normal deviation`);
      }
    }
  });

  it('finds the smooth path half a voxel off the voxel-centre convention (F2 fixes it)', () => {
    // Surface nets puts sample i at i; the panes and cuberille put voxel i's
    // centre at i + 0.5. Shifting the mesh by that half voxel takes the
    // sphere from 0.43 mm mean error to 0.02.
    const c = CASES[0]!;
    const mesh = paths(c)['smooth-image']!;
    const moved = { positions: mesh.positions.map((x) => x + 0.5), indices: mesh.indices };
    const before = scoreMesh(mesh, c.sp, c.ph).meanErr;
    const after = scoreMesh(moved, c.sp, c.ph).meanErr;
    assert.ok(before > 0.4 && after < 0.03, `before ${before.toFixed(3)} mm, after ${after.toFixed(3)} mm`);
  });
});
