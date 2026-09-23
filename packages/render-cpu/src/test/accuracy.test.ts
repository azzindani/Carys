import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractBoundary } from '../surface.js';
import { smoothMesh } from '../mesh-smooth.js';
import { maskNets, surfaceNets } from '../surface-nets.js';
import { smoothSurface } from '../thick-slices.js';
import {
  box, capsule, ellipsoid, erf, sampleIntensity, sampleMask, scoreMesh, sphere, torus,
  type Phantom, type SurfaceScore, type V3,
} from './phantoms.js';

// F1 (docs/PHASES.md): surface accuracy measured against analytic shapes,
// in mm, on the grids a scanner produces. The table records where each
// extraction path stands; every 3D-fidelity item beats it with its own
// acceptance test, and a change that moves these numbers has to say why.

interface Case { id: string; ph: Phantom; dims: V3; sp: V3 }

const CASES: Case[] = [
  { id: 'sphere-iso', ph: sphere([16, 16, 16], 10), dims: [32, 32, 32], sp: [1, 1, 1] },
  // 5 mm slices, the covid chest CT's geometry
  { id: 'sphere-thick', ph: sphere([16, 16, 17.5], 10), dims: [32, 32, 7], sp: [1, 1, 5] },
  { id: 'ellipsoid-aniso', ph: ellipsoid([16, 16, 17.5], [12, 9, 7]), dims: [40, 40, 14], sp: [0.8, 0.8, 2.5] },
  // saddle regions: concave and convex curvature in one shape
  { id: 'torus-iso', ph: torus([20, 20, 10], 11, 4), dims: [40, 40, 20], sp: [1, 1, 1] },
];

/** The four paths the app runs: blocky cuts at T; smooth goes through
 *  smoothSurface (thick slices interpolated, F5; else the image at T + 0.5
 *  on its own field, a mask relaxed in its cells). */
const THRESHOLD = 500;
function paths(c: Case): Record<string, { positions: Float32Array; indices: Uint32Array }> {
  const [nx, ny, nz] = c.dims;
  const f = sampleIntensity(c.ph, c.dims, c.sp);
  const m = sampleMask(c.ph, c.dims, c.sp);
  return {
    'blocky-image': extractBoundary(f, nx, ny, nz, THRESHOLD),
    'smooth-image': smoothSurface(f, nx, ny, nz, c.sp, THRESHOLD, false).mesh,
    'blocky-mask': extractBoundary(m, nx, ny, nz, 0),
    'smooth-mask': smoothSurface(m, nx, ny, nz, c.sp, 0, true).mesh,
  };
}

type Row = [meanErr: number, maxErr: number, volErrPct: number, normalDevDeg: number];

/** mm, mm, %, degrees. Blocky rows: the F1 baseline (2026-09-23). Smooth
 *  image rows: after F2 (the 1 mm sphere was 0.430 mm / −1.87% / 5.4°, half
 *  a voxel off the voxel-centre convention). Smooth mask rows: after F3
 *  (plain nets on the mask measured 0.145 mm / −0.04% / 16.1° there).
 *  Thick grids (sphere-thick, ellipsoid-aniso): after F5 — the 5 mm sphere
 *  was 0.452 mm / 14.9° (image) and 0.586 mm / 17.4° (mask). */
const MEASURED: Record<string, Record<string, Row>> = {
  'sphere-iso': {
    'blocky-image': [0.342, 0.770, 0.84, 45.0], 'smooth-image': [0.026, 0.067, -0.92, 3.3],
    'blocky-mask': [0.342, 0.770, 0.84, 45.0], 'smooth-mask': [0.076, 0.193, 0.65, 5.4],
  },
  'sphere-thick': {
    'blocky-image': [0.927, 2.500, -4.98, 43.3], 'smooth-image': [0.150, 0.562, -4.42, 6.2],
    'blocky-mask': [0.927, 2.500, -4.98, 43.3], 'smooth-mask': [0.205, 0.523, -3.48, 8.5],
  },
  'ellipsoid-aniso': {
    'blocky-image': [0.619, 1.493, 1.05, 44.4], 'smooth-image': [0.178, 1.337, 0.45, 7.7],
    'blocky-mask': [0.619, 1.493, 1.05, 44.4], 'smooth-mask': [0.216, 1.391, 1.14, 9.4],
  },
  'torus-iso': {
    'blocky-image': [0.320, 0.835, 2.24, 41.3], 'smooth-image': [0.025, 0.083, -1.84, 3.8],
    'blocky-mask': [0.320, 0.835, 2.24, 41.3], 'smooth-mask': [0.082, 0.234, 1.65, 5.5],
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

  it('the extraction paths match their recorded measurements', () => {
    for (const c of CASES) {
      const got = paths(c);
      for (const [path, mesh] of Object.entries(got)) {
        const s: SurfaceScore = scoreMesh(mesh, c.sp, c.ph);
        const [mean, max, vol, dev] = MEASURED[c.id]![path]!;
        const what = `${c.id} ${path}`;
        assert.ok(mesh.indices.length > 0, `${what}: empty mesh`);
        near(s.meanErr, mean, 0.005, `${what} mean error`);
        near(s.maxErr, max, 0.005, `${what} max error`);
        near(s.volErrPct, vol, 0.05, `${what} volume`);
        near(s.normalDevDeg, dev, 0.1, `${what} normal deviation`);
      }
    }
  });

  it('F2: the smooth image surface is sub-voxel accurate on the voxel-centre convention', () => {
    // Acceptance: the 1 mm sphere within 0.1 mm mean error and 1% volume.
    const c = CASES[0]!;
    const mesh = paths(c)['smooth-image']!;
    const s = scoreMesh(mesh, c.sp, c.ph);
    assert.ok(s.meanErr < 0.1, `mean error ${s.meanErr.toFixed(3)} mm`);
    assert.ok(Math.abs(s.volErrPct) < 1, `volume ${s.volErrPct.toFixed(2)}%`);
    // On the convention, not near it: half a voxel either way is worse.
    for (const d of [-0.5, 0.5]) {
      const moved = { positions: mesh.positions.map((x) => x + d), indices: mesh.indices };
      assert.ok(scoreMesh(moved, c.sp, c.ph).meanErr > 0.3, `a ${d} voxel shift should be worse`);
    }
  });

  it('F3: a binary mask surface is sub-voxel and terrace-free, and thin parts survive', () => {
    // Acceptance: the 1 mm sphere mask within 0.25 voxel (mean) and under 8°
    // of staircase; plain nets on the same mask measure 0.145 mm and 16.1°.
    const c = CASES[0]!;
    const s = scoreMesh(paths(c)['smooth-mask']!, c.sp, c.ph);
    assert.ok(s.meanErr < 0.25, `mean error ${s.meanErr.toFixed(3)} mm`);
    assert.ok(s.normalDevDeg < 8, `staircase ${s.normalDevDeg.toFixed(1)}°`);
    // A one-voxel plate and a thin tube (a vessel) keep their volume: a
    // blur-and-threshold smoother measured −88% on this plate.
    const thin: [Phantom, V3][] = [
      [box([16, 16, 16.5], [8, 8, 0.5]), [32, 32, 32]],
      [capsule([6, 16.5, 16.5], [26, 16.5, 16.5], 1.2), [32, 32, 32]],
    ];
    for (const [ph, dims] of thin) {
      const m = sampleMask(ph, dims, [1, 1, 1]);
      const relaxed = scoreMesh(maskNets(m, ...dims), [1, 1, 1], ph);
      const plain = scoreMesh(surfaceNets(m, ...dims, 0.5), [1, 1, 1], ph);
      assert.ok(relaxed.meanErr < 0.1, `${ph.name}: mean error ${relaxed.meanErr.toFixed(3)} mm`);
      assert.ok(relaxed.volErrPct > plain.volErrPct - 1, `${ph.name}: volume ${relaxed.volErrPct.toFixed(2)}% vs ${plain.volErrPct.toFixed(2)}% unrelaxed`);
    }
  });

  it('F3: relaxation keeps every vertex inside its cell', () => {
    const c = CASES[3]!;
    const m = sampleMask(c.ph, c.dims, c.sp);
    const plain = surfaceNets(m, ...c.dims, 0.5);
    const relaxed = maskNets(m, ...c.dims);
    assert.equal(relaxed.positions.length, plain.positions.length, 'same vertices');
    assert.deepEqual(relaxed.indices.length, plain.indices.length, 'same triangles');
    for (let i = 0; i < plain.positions.length; i++) {
      // the unrelaxed vertex is in the cell; the relaxed one may not leave it
      const cell = Math.min(Math.floor(plain.positions[i]! - 0.5), c.dims[i % 3]! - 2) + 0.5;
      assert.ok(relaxed.positions[i]! >= cell - 1e-6 && relaxed.positions[i]! <= cell + 1 + 1e-6, `vertex ${Math.floor(i / 3)} left its cell`);
    }
  });

  it('F4: smoothing keeps volume and beats F3 on every curved shape', () => {
    // Acceptance: volume change < 1% on the phantoms, staircase below F3's.
    // Strength 0.5 measured: sphere 5.4° → 2.1°, torus 5.5° → 3.3°,
    // ellipsoid 16.0° → 8.4°, 5 mm-slice sphere 17.4° → 12.3°.
    for (const c of CASES) {
      const f3 = paths(c)['smooth-mask']!;
      const a = scoreMesh(f3, c.sp, c.ph);
      const b = scoreMesh(smoothMesh({ ...f3, normals: new Float32Array(f3.positions.length) }, { strength: 0.5 }), c.sp, c.ph);
      assert.ok(Math.abs(b.volErrPct - a.volErrPct) < 1, `${c.id}: volume ${a.volErrPct.toFixed(2)}% → ${b.volErrPct.toFixed(2)}%`);
      assert.ok(b.normalDevDeg < a.normalDevDeg, `${c.id}: staircase ${a.normalDevDeg.toFixed(1)}° → ${b.normalDevDeg.toFixed(1)}°`);
    }
    // A thin tube keeps its volume and stays sub-voxel; the per-piece volume
    // restore is what does it (the filter alone took 15% at 0.35).
    const tube = capsule([6, 16.5, 16.5], [26, 16.5, 16.5], 1.2);
    const m = maskNets(sampleMask(tube, [32, 32, 32], [1, 1, 1]), 32, 32, 32);
    const a = scoreMesh(m, [1, 1, 1], tube);
    const b = scoreMesh(smoothMesh(m, { strength: 0.5 }), [1, 1, 1], tube);
    assert.ok(Math.abs(b.volErrPct - a.volErrPct) < 1, `tube volume ${a.volErrPct.toFixed(2)}% → ${b.volErrPct.toFixed(2)}%`);
    assert.ok(b.meanErr < 0.25, `tube error ${b.meanErr.toFixed(3)} mm`);
  });
});
