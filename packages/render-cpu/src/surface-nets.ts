// Surface nets — a smooth isosurface without lookup tables.
//
// One vertex per cell (the cube between 8 samples) that the surface crosses;
// one quad per sign-changing grid edge, joining the vertices of the 4 cells
// around it, wound so the normal points away from the foreground.
//
// Measured against analytic shapes (test/accuracy.test.ts, F2):
// - Positions follow the viewer's voxel convention: sample i is the centre
//   of voxel i, at i + 0.5, as the panes and cuberille draw it. Placing it
//   at i put the whole surface half a voxel off (0.43 mm on a 1 mm sphere).
// - A vertex starts at the mean of its cell's edge crossings, which sits
//   inside convex shapes, then moves along the gradient onto the surface of
//   the cell's trilinear interpolant (a few Newton steps, kept in the cell).
// - Vertex normals are area-weighted face normals, in voxel space: they
//   transform by the inverse spacing (app/lib/physical3d.ts) like any normal.
//
// Memory is two cell slices of vertex ids, not a map over the grid: a
// 512×512×58 mask no longer allocates per cell.
//
// Binary masks (F3) have no in-between values to place a vertex from, so
// their surface terraces. maskNets relaxes it instead — constrained elastic
// surface nets (Gibson 1998): each vertex moves toward its neighbours but
// never leaves its cell — the cube between the inside and outside voxel
// centres it separates — so thin parts keep their thickness instead of
// melting away as they do under a blur. Taubin's λ/μ pair keeps convex
// shapes from shrinking against the inner faces of their cells.
import type { TriMesh } from './surface.js';

/** Newton steps onto the trilinear surface: 3 converge to < 1e-4 voxel. */
const PROJECT_STEPS = 3;

// The 12 cell edges as corner pairs; corner c has x = c&1, y = (c>>1)&1, z = c>>2.
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** Vertices (voxel-centre coordinates), each vertex's cell, and the quads
 *  as a, b, c, d, outward axis (±1..±3). */
interface Nets { positions: number[]; cells: number[]; quads: number[] }

function buildNets(field: ArrayLike<number>, nx: number, ny: number, nz: number, iso: number): Nets {
  const cx = nx - 1, cy = ny - 1;
  const sxy = nx * ny;
  const positions: number[] = [];
  const cells: number[] = [];
  const quads: number[] = []; // a, b, c, d, then the outward axis (±1..±3)
  // vertex id per cell, for the current and previous z slice of cells
  const slice = cx * cy;
  let prev = new Int32Array(Math.max(0, slice)).fill(-1);
  let cur = new Int32Array(Math.max(0, slice)).fill(-1);
  const g = new Float64Array(8);

  for (let z = 0; z < nz - 1; z++) {
    cur.fill(-1);
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        const o = z * sxy + y * nx + x;
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = field[o + (c & 1) + ((c >> 1) & 1) * nx + (c >> 2) * sxy]! - iso;
          g[c] = v;
          if (v > 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 0xff) continue;
        // start: mean of the linearly interpolated crossings
        let u = 0, v = 0, w = 0, n = 0;
        for (const [a, b] of EDGES) {
          const ga = g[a]!, gb = g[b]!;
          if ((ga > 0) === (gb > 0)) continue;
          const t = ga / (ga - gb);
          u += (a & 1) + t * ((b & 1) - (a & 1));
          v += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          w += (a >> 2) + t * ((b >> 2) - (a >> 2));
          n++;
        }
        u /= n; v /= n; w /= n;
        // onto the trilinear surface: p -= f ∇f / |∇f|², clamped to the cell
        for (let k = 0; k < PROJECT_STEPS; k++) {
          const u0 = 1 - u, v0 = 1 - v, w0 = 1 - w;
          const f = g[0]! * u0 * v0 * w0 + g[1]! * u * v0 * w0 + g[2]! * u0 * v * w0 + g[3]! * u * v * w0
            + g[4]! * u0 * v0 * w + g[5]! * u * v0 * w + g[6]! * u0 * v * w + g[7]! * u * v * w;
          const fu = (g[1]! - g[0]!) * v0 * w0 + (g[3]! - g[2]!) * v * w0 + (g[5]! - g[4]!) * v0 * w + (g[7]! - g[6]!) * v * w;
          const fv = (g[2]! - g[0]!) * u0 * w0 + (g[3]! - g[1]!) * u * w0 + (g[6]! - g[4]!) * u0 * w + (g[7]! - g[5]!) * u * w;
          const fw = (g[4]! - g[0]!) * u0 * v0 + (g[5]! - g[1]!) * u * v0 + (g[6]! - g[2]!) * u0 * v + (g[7]! - g[3]!) * u * v;
          const gg = fu * fu + fv * fv + fw * fw;
          if (gg < 1e-24) break;
          const s = f / gg;
          u = Math.min(1, Math.max(0, u - s * fu));
          v = Math.min(1, Math.max(0, v - s * fv));
          w = Math.min(1, Math.max(0, w - s * fw));
        }
        const id = positions.length / 3;
        cur[y * cx + x] = id;
        positions.push(x + u + 0.5, y + v + 0.5, z + w + 0.5);
        cells.push(x, y, z);

        // Quads for the three grid edges leaving this cell's low corner:
        // their other three cells have lower y or z, so they are placed.
        const inside0 = (mask & 1) !== 0;
        // x edge: cells (y-1,z-1) (y,z-1) (y,z) (y-1,z)
        if (y > 0 && z > 0 && inside0 !== ((mask & 2) !== 0)) {
          const a = prev[(y - 1) * cx + x]!, b = prev[y * cx + x]!, d = cur[(y - 1) * cx + x]!;
          if (a >= 0 && b >= 0 && d >= 0) quads.push(a, b, id, d, inside0 ? 1 : -1);
        }
        // y edge: cells (x-1,z-1) (x-1,z) (x,z) (x,z-1)
        if (x > 0 && z > 0 && inside0 !== ((mask & 4) !== 0)) {
          const a = prev[y * cx + x - 1]!, b = cur[y * cx + x - 1]!, d = prev[y * cx + x]!;
          if (a >= 0 && b >= 0 && d >= 0) quads.push(a, b, id, d, inside0 ? 2 : -2);
        }
        // z edge: cells (x-1,y-1) (x,y-1) (x,y) (x-1,y)
        if (x > 0 && y > 0 && inside0 !== ((mask & 16) !== 0)) {
          const a = cur[(y - 1) * cx + x - 1]!, b = cur[(y - 1) * cx + x]!, d = cur[y * cx + x - 1]!;
          if (a >= 0 && b >= 0 && d >= 0) quads.push(a, b, id, d, inside0 ? 3 : -3);
        }
      }
    }
    const t = prev; prev = cur; cur = t;
  }
  return { positions, cells, quads };
}

/** Wind, split and shade the quads into a triangle mesh. */
function finishNets(
  positions: ArrayLike<number>, quads: number[],
  field: ArrayLike<number>, nx: number, ny: number, nz: number, iso: number,
): TriMesh {
  const sxy = nx * ny;

  // The field at a mesh position (voxel-centre coordinates), trilinear.
  const sample = (px: number, py: number, pz: number): number => {
    const x = Math.min(nx - 1, Math.max(0, px - 0.5));
    const y = Math.min(ny - 1, Math.max(0, py - 0.5));
    const z = Math.min(nz - 1, Math.max(0, pz - 0.5));
    const x0 = Math.min(nx - 2, Math.floor(x)), y0 = Math.min(ny - 2, Math.floor(y)), z0 = Math.min(nz - 2, Math.floor(z));
    const u = x - x0, v = y - y0, w = z - z0;
    const o = z0 * sxy + y0 * nx + x0;
    const f = (dx: number, dy: number, dz: number): number => field[o + dx + dy * nx + dz * sxy]!;
    return (1 - w) * ((1 - v) * ((1 - u) * f(0, 0, 0) + u * f(1, 0, 0)) + v * ((1 - u) * f(0, 1, 0) + u * f(1, 1, 0)))
      + w * ((1 - v) * ((1 - u) * f(0, 0, 1) + u * f(1, 0, 1)) + v * ((1 - u) * f(0, 1, 1) + u * f(1, 1, 1)));
  };

  // Wind each quad outward (from the inside sample toward the outside one),
  // split it along the diagonal whose midpoint lies nearer the surface (the
  // other one sags under a curve), and accumulate area-weighted normals.
  const P = positions;
  const offIso = (i: number, j: number): number => Math.abs(sample(
    (P[i * 3]! + P[j * 3]!) / 2, (P[i * 3 + 1]! + P[j * 3 + 1]!) / 2, (P[i * 3 + 2]! + P[j * 3 + 2]!) / 2,
  ) - iso);
  const indices = new Uint32Array((quads.length / 5) * 6);
  const normals = new Float64Array(P.length);
  let k = 0;
  for (let q = 0; q < quads.length; q += 5) {
    const a = quads[q]!, b = quads[q + 1]!, c = quads[q + 2]!, d = quads[q + 3]!, axis = quads[q + 4]!;
    const ux = P[b * 3]! - P[a * 3]!, uy = P[b * 3 + 1]! - P[a * 3 + 1]!, uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const vx = P[c * 3]! - P[a * 3]!, vy = P[c * 3 + 1]! - P[a * 3 + 1]!, vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    let nx0 = uy * vz - uz * vy, ny0 = uz * vx - ux * vz, nz0 = ux * vy - uy * vx;
    const out = Math.abs(axis) === 1 ? nx0 : Math.abs(axis) === 2 ? ny0 : nz0;
    const flip = out * Math.sign(axis) < 0;
    const [i0, i1, i2, i3] = flip ? [a, d, c, b] : [a, b, c, d];
    if (offIso(i1, i3) < offIso(i0, i2)) {
      indices[k++] = i1; indices[k++] = i2; indices[k++] = i3;
      indices[k++] = i1; indices[k++] = i3; indices[k++] = i0;
    } else {
      indices[k++] = i0; indices[k++] = i1; indices[k++] = i2;
      indices[k++] = i0; indices[k++] = i2; indices[k++] = i3;
    }
    if (flip) { nx0 = -nx0; ny0 = -ny0; nz0 = -nz0; }
    // |n| is twice the triangle's area: summing n itself area-weights
    for (const vi of [i0, i1, i2, i3]) {
      normals[vi * 3] += nx0; normals[vi * 3 + 1] += ny0; normals[vi * 3 + 2] += nz0;
    }
  }
  const nn = new Float32Array(normals.length);
  for (let i = 0; i < nn.length; i += 3) {
    const l = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
    nn[i] = normals[i]! / l; nn[i + 1] = normals[i + 1]! / l; nn[i + 2] = normals[i + 2]! / l;
  }
  return { positions: Float32Array.from(P), normals: nn, indices };
}

export function surfaceNets(
  field: ArrayLike<number>,
  nx: number, ny: number, nz: number,
  iso: number,
): TriMesh {
  const n = buildNets(field, nx, ny, nz, iso);
  return finishNets(n.positions, n.quads, field, nx, ny, nz, iso);
}

export interface MaskNetsOpts {
  /** Taubin rounds (a λ step and a μ step each) */
  iterations?: number;
  lambda?: number;
  mu?: number;
}

/**
 * The surface of a binary mask (values 0 / 1), relaxed inside its cells.
 * Measured (test/accuracy.test.ts, F3): a 1 mm sphere mask from 0.15 mm and
 * 16° of staircase to 0.07 mm and 5°, and a one-voxel plate keeps its
 * thickness where a blur-and-threshold collapsed it.
 */
export function maskNets(
  mask: ArrayLike<number>, nx: number, ny: number, nz: number, opts: MaskNetsOpts = {},
): TriMesh {
  const { iterations = 20, lambda = 0.5, mu = -0.53 } = opts;
  const n = buildNets(mask, nx, ny, nz, 0.5);
  const nv = n.positions.length / 3;
  // Neighbours from the quad edges, as CSR. A closed surface lists every
  // edge twice (once per quad), which weights all neighbours equally.
  const deg = new Uint32Array(nv + 1);
  const Q = n.quads;
  for (let q = 0; q < Q.length; q += 5) for (let e = 0; e < 4; e++) { deg[Q[q + e]!]! += 2; }
  const start = new Uint32Array(nv + 1);
  for (let i = 0; i < nv; i++) start[i + 1] = start[i]! + deg[i]!;
  const adj = new Uint32Array(start[nv]!);
  const fill = start.slice(0, nv);
  for (let q = 0; q < Q.length; q += 5) {
    for (let e = 0; e < 4; e++) {
      const a = Q[q + e]!, b = Q[q + ((e + 1) % 4)]!;
      adj[fill[a]!++] = b;
      adj[fill[b]!++] = a;
    }
  }
  let P = Float64Array.from(n.positions);
  let next = new Float64Array(P.length);
  const C = n.cells;
  // Uniform averaging and axis-aligned clamping both commute with scaling
  // each axis, so relaxing in voxel units is relaxing in millimetres.
  const step = (f: number): void => {
    for (let i = 0; i < nv; i++) {
      const s0 = start[i]!, s1 = start[i + 1]!;
      for (let k = 0; k < 3; k++) {
        const p = P[i * 3 + k]!;
        if (s1 === s0) { next[i * 3 + k] = p; continue; }
        let m = 0;
        for (let j = s0; j < s1; j++) m += P[adj[j]! * 3 + k]!;
        const lo = C[i * 3 + k]! + 0.5;
        next[i * 3 + k] = Math.min(lo + 1, Math.max(lo, p + f * (m / (s1 - s0) - p)));
      }
    }
    const t = P; P = next; next = t;
  };
  for (let it = 0; it < iterations; it++) { step(lambda); step(mu); }
  return finishNets(P, n.quads, mask, nx, ny, nz, 0.5);
}
