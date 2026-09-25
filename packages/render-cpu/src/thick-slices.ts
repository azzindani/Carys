// Surfaces from thick slices.
//
// A 5 mm-slice series samples a shape once every 5 mm along z, so any
// surface built on that grid steps at every slice. Here the gap is filled
// the way shape-based interpolation does it (Raya & Udupa 1990): each slice
// becomes a 2D signed distance map in mm (an exact Euclidean distance
// transform), the maps are interpolated along z with Catmull-Rom onto
// near-isotropic slices, and the zero surface is extracted there. An empty
// slice gets its neighbour's distances one slice-gap further out: it is
// known to be outside, and a shape usually ends between slices, not on one.
//
// The per-slice maps keep the in-plane pixel steps a binary mask has, so
// the result is then relaxed the way maskNets relaxes a mask (Taubin
// rounds), with each vertex held inside its ORIGINAL cell — up to a slice
// gap along z, a pixel in-plane: the surface may move freely between the
// scan's voxel centres but not across one.
//
// An image's crossings seed each map at sub-pixel positions (a 0/1 mask's
// seed is the midpoint), so an image keeps the in-plane accuracy its
// intensities carry. Measured (test/thick-slices.test.ts), a 10 mm sphere
// on 1×1×5 mm: image 0.45 mm / 14.9° of staircase → 0.15 mm / 6.2°, mask
// 0.59 mm / 17.4° → 0.21 mm / 8.5°. Where a shape is cut by only a few
// slices its ends stay a guess (the acceptance test in
// test/thick-slices.test.ts records the bound this holds on 5 mm data).
import { meshNeighbours, vertexNormals } from './mesh-smooth.js';
import { maskNets, surfaceNets } from './surface-nets.js';
import type { TriMesh } from './surface.js';

type V3 = [number, number, number];

export interface ThickOpts {
  /** cap on the interpolated grid (voxels): the factor drops to fit it */
  maxVoxels?: number;
  /** Taubin rounds of the in-cell relaxation */
  iterations?: number;
}

/** 32 M float32 voxels: 128 MB, the most one extraction may hold. */
const MAX_VOXELS = 32_000_000;
const MAX_FACTOR = 8;

/** Slices to make of each one: the slice gap over the in-plane pixel. */
export function sliceFactor(sp: V3): number {
  return Math.min(MAX_FACTOR, Math.max(1, Math.round(sp[2] / Math.min(sp[0], sp[1]))));
}

/** Squared 1D Euclidean distance transform (Felzenszwalb & Huttenlocher). */
function edt1(f: Float64Array, n: number, h: number, out: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (f[q] === Infinity) continue;
    if (f[v[k]!] === Infinity) { v[k] = q; continue; }
    let s = 0;
    for (;;) {
      const p = v[k]!;
      s = (f[q]! + (q * h) ** 2 - (f[p]! + (p * h) ** 2)) / (2 * h * h * (q - p));
      if (s <= z[k]! && k > 0) k--; else break;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  if (f[v[0]!] === Infinity) { out.fill(Infinity, 0, n); return; }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const p = v[k]!;
    out[q] = (q - p) ** 2 * h * h + f[p]!;
  }
}

/** Squared distance (mm²) from every pixel to the nearest `on` pixel. */
export function edt2(on: (i: number) => boolean, nx: number, ny: number, hx: number, hy: number): Float64Array {
  const d = new Float64Array(nx * ny);
  const n = Math.max(nx, ny);
  const f = new Float64Array(n), o = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) f[x] = on(y * nx + x) ? 0 : Infinity;
    edt1(f, nx, hx, o, v, z);
    for (let x = 0; x < nx; x++) d[y * nx + x] = o[x]!;
  }
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) f[y] = d[y * nx + x]!;
    edt1(f, ny, hy, o, v, z);
    for (let y = 0; y < ny; y++) d[y * nx + x] = o[y]!;
  }
  return d;
}

const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/**
 * The smooth surface the viewer draws for a field on a grid of spacing `sp`
 * (mm): an image is cut at `threshold` (inside where > threshold, as the
 * blocky path cuts it), a mask is its own inside. Thick-sliced grids go
 * through thickSliceNets; otherwise an image keeps its sub-voxel crossings
 * (surfaceNets on the field) and a mask is relaxed in its cells (maskNets).
 */
export function smoothSurface(
  field: ArrayLike<number>, nx: number, ny: number, nz: number, sp: V3, threshold: number, isMask: boolean,
): { mesh: TriMesh; factor: number } {
  if (isMask) {
    const bin = new Uint8Array(field.length);
    for (let i = 0; i < bin.length; i++) bin[i] = field[i]! > threshold ? 1 : 0;
    return sliceFactor(sp) >= 2 ? thickSliceNets(bin, nx, ny, nz, sp, 0.5) : { mesh: maskNets(bin, nx, ny, nz), factor: 1 };
  }
  // an image's maps are seeded sub-pixel, so it needs little relaxing: 10
  // rounds cost 2 s less than 30 on the covid CT and 0.005 mm on the phantoms
  return sliceFactor(sp) >= 2
    ? thickSliceNets(field, nx, ny, nz, sp, threshold + 0.5, { iterations: 10 })
    : { mesh: surfaceNets(field, nx, ny, nz, threshold + 0.5), factor: 1 };
}

/**
 * The surface where `field` crosses `iso` (inside above it) on a grid of
 * spacing `sp` (mm) — a mask at 0.5, an image at its threshold. Returns the
 * factor used: 1 means the grid is not thick-sliced (or the interpolated
 * grid would not fit) and the mesh is the one-grid path's.
 */
export function thickSliceNets(
  field: ArrayLike<number>, nx: number, ny: number, nz: number, sp: V3, iso: number, opts: ThickOpts = {},
): { mesh: TriMesh; factor: number } {
  const { maxVoxels = MAX_VOXELS, iterations = 30 } = opts;
  const k0 = sliceFactor(sp);
  const mask = { length: field.length } as ArrayLike<number>;
  const isIn = (i: number): boolean => field[i]! > iso;
  const plain = (): { mesh: TriMesh; factor: number } => {
    const bin = new Uint8Array(field.length);
    for (let i = 0; i < bin.length; i++) bin[i] = isIn(i) ? 1 : 0;
    return { mesh: maskNets(bin, nx, ny, nz), factor: 1 };
  };
  if (k0 < 2) return plain();
  // crop to the object, with outside pixels around it and a slice each end
  let x0 = nx, x1 = -1, y0 = ny, y1 = -1, z0 = nz, z1 = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!isIn(i)) continue;
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (x1 < 0) return plain();
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); z0 = Math.max(0, z0 - 1);
  x1 = Math.min(nx - 1, x1 + 2); y1 = Math.min(ny - 1, y1 + 2); z1 = Math.min(nz - 1, z1 + 1);
  const cx = x1 - x0 + 1, cy = y1 - y0 + 1, cz = z1 - z0 + 1, sxy = cx * cy;
  const k = Math.min(k0, Math.floor(maxVoxels / (sxy * cz)));
  if (k < 2) return plain();
  const idx = (x: number, y: number, z: number): number => (z + z0) * nx * ny + (y + y0) * nx + x + x0;
  const inside = (x: number, y: number, z: number): boolean => isIn(idx(x, y, z));
  /** Distance (mm) from pixel (x, y) to where the field crosses iso on its
   *  edges to 4-neighbours of the other side, or NaN: the sub-pixel seed a
   *  binary distance map lacks (for a 0/1 mask it is the midpoint). */
  const seed = (x: number, y: number, z: number): number => {
    const v = field[idx(x, y, z)]! - iso, here = v > 0;
    let tx = Infinity, ty = Infinity;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const qx = x + dx, qy = y + dy;
      if (qx < 0 || qy < 0 || qx >= cx || qy >= cy) continue;
      const w = field[idx(qx, qy, z)]! - iso;
      if ((w > 0) === here) continue;
      const d = (v / (v - w)) * (dx ? sp[0] : sp[1]);
      if (dx) tx = Math.min(tx, d); else ty = Math.min(ty, d);
    }
    if (tx === Infinity && ty === Infinity) return Number.NaN;
    if (tx === Infinity) return ty;
    if (ty === Infinity) return tx;
    return (tx * ty) / Math.hypot(tx, ty);
  };

  // per-slice signed distance (mm, inside negative), surface at the midpoint
  // between pixel centres; NaN marks a slice with no boundary in it
  const S = new Float32Array(sxy * cz);
  const half = Math.min(sp[0], sp[1]) / 2;
  const real = new Uint8Array(cz);
  const full = new Uint8Array(cz);
  for (let z = 0; z < cz; z++) {
    const toIn = edt2((i) => inside(i % cx, Math.floor(i / cx), z), cx, cy, sp[0], sp[1]);
    const toOut = edt2((i) => !inside(i % cx, Math.floor(i / cx), z), cx, cy, sp[0], sp[1]);
    real[z] = Number.isFinite(toIn[0]!) && Number.isFinite(toOut[0]!) ? 1 : 0;
    full[z] = Number.isFinite(toIn[0]!) ? 1 : 0;
    for (let i = 0; i < sxy; i++) {
      const x = i % cx, y = Math.floor(i / cx), inn = inside(x, y, z);
      const d = real[z] ? seed(x, y, z) : Number.NaN;
      const far = inn ? Math.sqrt(toOut[i]!) - half : Math.sqrt(toIn[i]!) - half;
      S[z * sxy + i] = (inn ? -1 : 1) * (Number.isNaN(d) ? far : d);
    }
  }
  // an empty (or full) slice: the nearest real neighbour's distances one
  // slice gap further out (in), never on the wrong side of zero
  for (let z = 0; z < cz; z++) {
    if (real[z]) continue;
    let near = -1;
    for (let d = 1; d < cz && near < 0; d++) {
      if (z - d >= 0 && real[z - d]) near = z - d;
      else if (z + d < cz && real[z + d]) near = z + d;
    }
    const sign = full[z] ? -1 : 1;
    for (let i = 0; i < sxy; i++) {
      const v = near < 0 ? sign * sp[2] : S[near * sxy + i]! + sign * sp[2] * Math.abs(z - near);
      S[z * sxy + i] = sign > 0 ? Math.max(half, v) : Math.min(-half, v);
    }
  }

  // Catmull-Rom along z onto k slices per slice; inside positive for nets
  const fz = cz * k;
  const fine = new Float32Array(sxy * fz);
  const at = (i: number): number => Math.min(cz - 1, Math.max(0, i));
  for (let j = 0; j < fz; j++) {
    const zc = (j + 0.5) / k - 0.5, i1 = Math.floor(zc), t = zc - i1;
    const a = at(i1 - 1) * sxy, b = at(i1) * sxy, c = at(i1 + 1) * sxy, d = at(i1 + 2) * sxy;
    for (let p = 0; p < sxy; p++) fine[j * sxy + p] = -catmullRom(S[a + p]!, S[b + p]!, S[c + p]!, S[d + p]!, t);
  }
  const net = surfaceNets(fine, cx, cy, fz, 0);

  // back to the scan's voxel coordinates, then relax inside the scan's cells
  const nv = net.positions.length / 3;
  let P = new Float64Array(net.positions.length);
  for (let i = 0; i < nv; i++) {
    P[i * 3] = net.positions[i * 3]! + x0;
    P[i * 3 + 1] = net.positions[i * 3 + 1]! + y0;
    P[i * 3 + 2] = net.positions[i * 3 + 2]! / k + z0;
  }
  const lo = new Float64Array(P.length);
  for (let i = 0; i < P.length; i++) lo[i] = Math.floor(P[i]! - 0.5) + 0.5;
  const { start, adj } = meshNeighbours(net.indices, nv);
  let next = new Float64Array(P.length);
  const step = (f: number): void => {
    for (let i = 0; i < nv; i++) {
      const s0 = start[i]!, s1 = start[i + 1]!;
      for (let c = 0; c < 3; c++) {
        const p = P[i * 3 + c]!;
        if (s1 === s0) { next[i * 3 + c] = p; continue; }
        let m = 0;
        for (let j = s0; j < s1; j++) m += P[adj[j]! * 3 + c]!;
        const l = lo[i * 3 + c]!;
        next[i * 3 + c] = Math.min(l + 1, Math.max(l, p + f * (m / (s1 - s0) - p)));
      }
    }
    const t = P; P = next; next = t;
  };
  for (let it = 0; it < iterations; it++) { step(0.5); step(-0.53); }
  return {
    mesh: { positions: Float32Array.from(P), normals: Float32Array.from(vertexNormals(P, net.indices)), indices: net.indices },
    factor: k,
  };
}
