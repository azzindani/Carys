// Windowed-sinc mesh smoothing (Taubin, Zhang & Golub 1996, "Optimal surface
// smoothing as filter design") — the non-shrinking filter behind VTK's
// vtkWindowedSincPolyDataFilter, which 3D Slicer runs on segmentations.
//
// Plain Laplacian averaging is a low-pass filter whose gain falls below 1 at
// every frequency, the lowest included, so a surface shrinks as it smooths.
// Here the filter is a Chebyshev polynomial in the umbrella operator,
// designed as a Hamming-windowed sinc: frequencies below the pass band keep
// gain 1 (shape and volume stay), the ones above — voxel terraces — go.
//
// A mesh low-pass cannot tell a terrace from a thin vessel: a tube two
// voxels across has ~8 vertices around it, so its cross-section is high
// frequency too and shrinks (−15% volume at strength 0.35 on the F1 tube).
// So each closed piece of surface then moves along its normals until it has
// the volume it had before (Newton on δ = ΔV / area): the filter decides
// the shape, the data keeps the volume — per lesion, per vessel.
//
// Pure: positions and triangles in, the same triangles with new positions
// and normals out. The umbrella operator (mean of neighbours) commutes with
// scaling each axis, so smoothing in voxel units equals smoothing in mm.
import type { TriMesh } from './surface.js';

export interface SmoothOpts {
  /** 0 = none … 1 = strongest. Pass band 10^(−4·strength), 3D Slicer's
   *  mapping, so a value means what it means there. */
  strength: number;
  /** Chebyshev terms (VTK and Slicer default: 20) */
  iterations?: number;
  /** restore each closed component's volume after filtering (default on) */
  preserveVolume?: boolean;
}

/** Newton steps for the volume restore: 4 leave < 0.05% on the phantoms. */
const VOLUME_STEPS = 4;
/** A component enclosing less than this (voxel³) is a sliver, not a shape:
 *  smoothing collapses its area toward 0 and ΔV/area would explode. */
const MIN_VOLUME = 1e-3;
/** Largest offset per Newton step (voxels): smoothing never moves a surface
 *  further, so a bigger step means degenerate geometry, not lost volume. */
const MAX_STEP = 1;

/** Area-weighted unit vertex normals. */
export function vertexNormals(P: ArrayLike<number>, I: ArrayLike<number>): Float64Array {
  const n = new Float64Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, d = I[t + 2]! * 3;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const vx = P[d]! - P[a]!, vy = P[d + 1]! - P[a + 1]!, vz = P[d + 2]! - P[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, d]) { n[v]! += nx; n[v + 1]! += ny; n[v + 2]! += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1;
    n[i]! /= l; n[i + 1]! /= l; n[i + 2]! /= l;
  }
  return n;
}

/**
 * Connected components (union-find over triangles) and which are closed —
 * every edge shared by an even number of triangles. Four happens where two
 * parts of a mask touch along an edge (surface nets makes these at
 * checkerboard voxels: 213 edges on the BraTS tumour) and still encloses a
 * volume. An open piece (cut by the volume's border) has no volume to keep,
 * so it is left as filtered.
 */
function closedComponents(I: ArrayLike<number>, nv: number): { comp: Int32Array; closed: Uint8Array } {
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; }
    return x;
  };
  for (let t = 0; t < I.length; t += 3) {
    const a = find(I[t]!);
    parent[find(I[t + 1]!)] = a;
    parent[find(I[t + 2]!)] = a;
  }
  const comp = new Int32Array(nv);
  for (let i = 0; i < nv; i++) comp[i] = find(i);
  // edge keys lo·nv + hi, sorted: a run of length ≠ 2 is an open edge
  const keys = new Float64Array(I.length);
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[t + e]!, b = I[t + ((e + 1) % 3)]!;
      keys[t + e] = a < b ? a * nv + b : b * nv + a;
    }
  }
  keys.sort();
  const closed = new Uint8Array(nv).fill(1);
  for (let i = 0; i < keys.length;) {
    let j = i + 1;
    while (j < keys.length && keys[j] === keys[i]) j++;
    if ((j - i) % 2 !== 0) closed[comp[Math.floor(keys[i]! / nv)]!] = 0;
    i = j;
  }
  return { comp, closed };
}

/** Signed volume and area per component root. */
function volumes(P: ArrayLike<number>, I: ArrayLike<number>, comp: Int32Array, nv: number): { vol: Float64Array; area: Float64Array } {
  const vol = new Float64Array(nv), area = new Float64Array(nv);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, d = I[t + 2]! * 3;
    const k = comp[I[t]!]!;
    vol[k]! += (P[a]! * (P[b + 1]! * P[d + 2]! - P[b + 2]! * P[d + 1]!)
      + P[a + 1]! * (P[b + 2]! * P[d]! - P[b]! * P[d + 2]!)
      + P[a + 2]! * (P[b]! * P[d + 1]! - P[b + 1]! * P[d]!)) / 6;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const vx = P[d]! - P[a]!, vy = P[d + 1]! - P[a + 1]!, vz = P[d + 2]! - P[a + 2]!;
    area[k]! += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return { vol, area };
}

/**
 * Vertex neighbours as CSR (start/adj) from the triangle edges. Each
 * interior edge borders two triangles, so every neighbour is listed twice:
 * equal weights, and no dedupe pass.
 */
export function meshNeighbours(I: ArrayLike<number>, nv: number): { start: Uint32Array; adj: Uint32Array } {
  const deg = new Uint32Array(nv);
  for (let t = 0; t < I.length; t++) deg[I[t]!]! += 2;
  const start = new Uint32Array(nv + 1);
  for (let i = 0; i < nv; i++) start[i + 1] = start[i]! + deg[i]!;
  const adj = new Uint32Array(start[nv]!);
  const fill = start.slice(0, nv);
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[t + e]!, b = I[t + ((e + 1) % 3)]!;
      adj[fill[a]!++] = b;
      adj[fill[b]!++] = a;
    }
  }
  return { start, adj };
}

/**
 * Filter coefficients c₀…c_N: a Hamming-windowed sinc low-pass with its
 * cut-off nudged (Newton on σ) so the gain at the pass band edge is 1.
 */
export function sincCoefficients(iterations: number, passBand: number): Float64Array {
  if (!Number.isInteger(iterations) || iterations < 1) throw new RangeError(`smooth-iterations: ${iterations}`);
  if (!(passBand > 0 && passBand < 2)) throw new RangeError(`smooth-passband: ${passBand}`);
  const N = iterations;
  const thetaPb = Math.acos(1 - 0.5 * passBand);
  const w = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) w[i] = 0.54 + 0.46 * Math.cos((i * Math.PI) / (N + 1));
  const c = new Float64Array(N + 1);
  const cp = new Float64Array(N + 1);
  let sigma = 0;
  for (let it = 0; it < 500; it++) {
    c[0] = (w[0]! * (thetaPb + sigma)) / Math.PI;
    for (let i = 1; i <= N; i++) c[i] = (2 * w[i]! * Math.sin(i * (thetaPb + sigma))) / (i * Math.PI);
    if (N === 1) break;
    // derivative coefficients (Chebyshev derivative recurrence)
    cp.fill(0);
    cp[N - 2] = 2 * (N - 1) * c[N - 1]!;
    for (let i = N - 3; i >= 0; i--) cp[i] = cp[i + 2]! + 2 * (i + 1) * c[i + 1]!;
    let f = 0, fp = 0;
    for (let i = 0; i <= N; i++) {
      const t = Math.cos(i * thetaPb);
      f += c[i]! * t;
      fp += cp[i]! * t;
    }
    if (Math.abs(f - 1) < 1e-3 || fp === 0) break;
    sigma -= (f - 1) / fp;
  }
  return c;
}

/** Smoothed copy of a mesh; strength 0 returns it unchanged. */
export function smoothMesh(mesh: TriMesh, opts: SmoothOpts): TriMesh {
  const { strength, iterations = 20, preserveVolume = true } = opts;
  if (!(strength >= 0 && strength <= 1)) throw new RangeError(`smooth-strength: ${strength}`);
  if (strength === 0 || mesh.indices.length === 0) return mesh;
  const c = sincCoefficients(iterations, 10 ** (-4 * strength));
  const I = mesh.indices;
  const nv = mesh.positions.length / 3;
  const { start, adj } = meshNeighbours(I, nv);
  /** out = x + ½·(mean of neighbours − x) = (I − K/2)·x */
  const halfStep = (x: Float64Array, out: Float64Array): void => {
    for (let i = 0; i < nv; i++) {
      const s0 = start[i]!, s1 = start[i + 1]!;
      for (let k = 0; k < 3; k++) {
        const p = x[i * 3 + k]!;
        if (s1 === s0) { out[i * 3 + k] = p; continue; }
        let m = 0;
        for (let j = s0; j < s1; j++) m += x[adj[j]! * 3 + k]!;
        out[i * 3 + k] = p + 0.5 * (m / (s1 - s0) - p);
      }
    }
  };
  // Chebyshev recurrence: T₀ = x, T₁ = (I − K/2)x, T_j = 2(I − K/2)T_{j−1} − T_{j−2}
  let t0 = Float64Array.from(mesh.positions);
  let t1 = new Float64Array(t0.length);
  let t2 = new Float64Array(t0.length);
  halfStep(t0, t1);
  const acc = new Float64Array(t0.length);
  for (let i = 0; i < acc.length; i++) acc[i] = c[0]! * t0[i]! + c[1]! * t1[i]!;
  for (let j = 2; j < c.length; j++) {
    halfStep(t1, t2);
    for (let i = 0; i < acc.length; i++) {
      const v = 2 * t2[i]! - t0[i]!;
      t2[i] = v;
      acc[i]! += c[j]! * v;
    }
    const r = t0; t0 = t1; t1 = t2; t2 = r;
  }
  if (preserveVolume) {
    const { comp, closed } = closedComponents(I, nv);
    const before = volumes(mesh.positions, I, comp, nv).vol;
    for (let step = 0; step < VOLUME_STEPS; step++) {
      const { vol, area } = volumes(acc, I, comp, nv);
      const n = vertexNormals(acc, I);
      for (let i = 0; i < nv; i++) {
        const k = comp[i]!;
        if (!closed[k] || !(Math.abs(before[k]!) >= MIN_VOLUME) || !(area[k]! > 1e-12)) continue;
        const d = Math.max(-MAX_STEP, Math.min(MAX_STEP, (before[k]! - vol[k]!) / area[k]!));
        acc[i * 3]! += d * n[i * 3]!; acc[i * 3 + 1]! += d * n[i * 3 + 1]!; acc[i * 3 + 2]! += d * n[i * 3 + 2]!;
      }
    }
  }
  const normals = Float32Array.from(vertexNormals(acc, I));
  return { positions: Float32Array.from(acc), normals, indices: mesh.indices };
}
