// Cinematic lighting for the volume raycaster (F10, docs/PHASES.md): soft
// shadows and ambient light, refined pass by pass.
//
// The transfer function makes the volume a field of extinction σ (per mm,
// from each voxel's opacity over the reference step). It is averaged into
// a coarse grid of about a million cells, cached per field and TF. Light
// from one direction is then propagated through that grid slice by slice
// along the direction's dominant axis: a cell's transmittance is its
// neighbour's toward the light, attenuated by that neighbour's extinction
// over the step between them (the cell's own extinction is left out, so a
// lit surface does not shadow itself). That is one linear sweep per
// direction, the light-propagation idea of Ropinski et al. 2008 on a
// regular grid.
//
// A pass lights with one direction jittered inside a cone around the
// headlight (averaged over passes: an area light, soft shadows) and two
// sky directions from a spherical Fibonacci set spread over all the
// passes (averaged: ambient occlusion). Opacity does not depend on the
// light, so the mean of the passes' images is the image under the mean
// light.
import type { Vec3 } from './oblique.js';
import { sampleSortedTF, type TF } from './tf.js';

/** Extinction on a coarse grid; cell i spans voxels [i·f, (i+1)·f). */
export interface ExtinctionGrid {
  dims: [number, number, number];
  /** voxels per cell along each axis */
  f: [number, number, number];
  /** cell size, mm */
  cell: Vec3;
  /** per mm */
  sigma: Float32Array;
}

/** Cells in the lighting grid at most (the cell grows to fit). */
const MAX_CELLS = 1 << 20;
/** Opacity treated as 1 − this at most, so σ stays finite. */
const OPAQUE = 0.999;
/** Half-angle of the area light around the headlight, radians. */
export const LIGHT_CONE = 0.14;
/** Sky directions each pass adds to the ambient estimate. */
export const SKY_PER_PASS = 2;

/**
 * The volume as extinction per mm on a coarse grid. `refMm` is the ray
 * length a TF opacity stands for. Throws `light-ref` for a non-positive
 * length.
 */
export function extinctionGrid(
  field: ArrayLike<number>, dims: [number, number, number], spacing: Vec3,
  stops: TF, density: number, refMm: number,
): ExtinctionGrid {
  if (!(refMm > 0)) throw new RangeError(`light-ref: ${refMm}`);
  const [nx, ny, nz] = dims;
  const ext = [nx * spacing[0], ny * spacing[1], nz * spacing[2]];
  // near-cubic cells in mm, a million of them at most
  const target = Math.max(Math.min(spacing[0], spacing[1], spacing[2]), Math.cbrt((ext[0]! * ext[1]! * ext[2]!) / MAX_CELLS));
  const f: [number, number, number] = [0, 1, 2].map((a) => Math.max(1, Math.round(target / spacing[a]!))) as [number, number, number];
  let g: [number, number, number] = [Math.ceil(nx / f[0]), Math.ceil(ny / f[1]), Math.ceil(nz / f[2])];
  while (g[0] * g[1] * g[2] > MAX_CELLS) {
    const a = g.indexOf(Math.max(...g));
    f[a]!++;
    g = [Math.ceil(nx / f[0]), Math.ceil(ny / f[1]), Math.ceil(nz / f[2])];
  }
  const sum = new Float64Array(g[0] * g[1] * g[2]), count = new Uint32Array(g[0] * g[1] * g[2]);
  for (let z = 0; z < nz; z++) {
    const cz = Math.floor(z / f[2]);
    for (let y = 0; y < ny; y++) {
      const cy = Math.floor(y / f[1]), row = (z * ny + y) * nx, crow = (cz * g[1] + cy) * g[0];
      for (let x = 0; x < nx; x++) {
        const v = field[row + x]!;
        const a = v === v ? Math.min(OPAQUE, Math.min(1, sampleSortedTF(stops, v).a * density)) : 0;
        const c = crow + Math.floor(x / f[0]);
        if (a > 0) sum[c] += -Math.log(1 - a) / refMm;
        count[c]!++;
      }
    }
  }
  const sigma = new Float32Array(sum.length);
  for (let i = 0; i < sum.length; i++) sigma[i] = sum[i]! / count[i]!;
  return { dims: g, f, cell: [f[0] * spacing[0], f[1] * spacing[1], f[2] * spacing[2]], sigma };
}

/**
 * Transmittance of light arriving from unit direction `toLight` (world mm
 * axes) at every cell. Light enters from outside the grid unattenuated.
 */
export function transmittance(grid: ExtinctionGrid, toLight: Vec3): Float32Array {
  const [gx, gy, gz] = grid.dims;
  const n = [gx, gy, gz], stride = [1, gx, gx * gy];
  // the direction in cells per mm; its dominant axis steps one cell a time
  const dc = [toLight[0] / grid.cell[0], toLight[1] / grid.cell[1], toLight[2] / grid.cell[2]];
  const a = [0, 1, 2].reduce((m, i) => (Math.abs(dc[i]!) > Math.abs(dc[m]!) ? i : m), 0);
  const b = (a + 1) % 3, c = (a + 2) % 3;
  const h = 1 / Math.abs(dc[a]!); // mm per slice
  const ob = dc[b]! * h, oc = dc[c]! * h; // lateral offset of the upstream point, cells
  const up = dc[a]! > 0 ? 1 : -1;
  const T = new Float32Array(gx * gy * gz);
  // P = what leaves a cell toward the far side: T · exp(−σ h)
  const P = new Float32Array(gx * gy * gz);
  const first = up > 0 ? n[a]! - 1 : 0;
  const at = (s: number, j: number, k: number): number => s * stride[a]! + j * stride[b]! + k * stride[c]!;
  for (let s = first; s >= 0 && s < n[a]!; s -= up) {
    const src = s + up; // the slice toward the light
    for (let k = 0; k < n[c]!; k++) {
      for (let j = 0; j < n[b]!; j++) {
        let t = 1;
        if (src >= 0 && src < n[a]!) {
          // bilinear in the upstream slice; outside it the light is whole
          const u = j + ob, v = k + oc;
          const j0 = Math.floor(u), k0 = Math.floor(v), fu = u - j0, fv = v - k0;
          const tap = (jj: number, kk: number): number =>
            jj < 0 || kk < 0 || jj >= n[b]! || kk >= n[c]! ? 1 : P[at(src, jj, kk)]!;
          t = (tap(j0, k0) * (1 - fu) + tap(j0 + 1, k0) * fu) * (1 - fv) + (tap(j0, k0 + 1) * (1 - fu) + tap(j0 + 1, k0 + 1) * fu) * fv;
        }
        const i = at(s, j, k);
        T[i] = t;
        P[i] = t * Math.exp(-grid.sigma[i]! * h);
      }
    }
  }
  return T;
}

/** An orthonormal pair perpendicular to unit `d`. */
function basis(d: Vec3): [Vec3, Vec3] {
  const a: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u: Vec3 = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u[0] /= ul; u[1] /= ul; u[2] /= ul;
  return [u, [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]];
}

/** Lighting of one pass: the light's direction and transmittance, and the
 *  sky directions with theirs. */
export interface PassLight {
  grid: ExtinctionGrid;
  light: Vec3;
  shadow: Float32Array;
  sky: Vec3[];
  skyT: Float32Array[];
}

/**
 * Pass `pass` of `of`: the headlight `toLight` jittered to this pass's
 * point of the cone (stratified in radius, golden-angle in turn), and this
 * pass's share of `of × SKY_PER_PASS` sky directions.
 */
export function passLight(grid: ExtinctionGrid, toLight: Vec3, pass: number, of: number): PassLight {
  const [u, v] = basis(toLight);
  const r = LIGHT_CONE * Math.sqrt((pass + 0.5) / of), phi = pass * 2.399963229728653;
  const tr = Math.tan(r);
  const lx = toLight[0] + tr * (Math.cos(phi) * u[0] + Math.sin(phi) * v[0]);
  const ly = toLight[1] + tr * (Math.cos(phi) * u[1] + Math.sin(phi) * v[1]);
  const lz = toLight[2] + tr * (Math.cos(phi) * u[2] + Math.sin(phi) * v[2]);
  const ll = Math.hypot(lx, ly, lz);
  const light: Vec3 = [lx / ll, ly / ll, lz / ll];
  const M = of * SKY_PER_PASS, sky: Vec3[] = [];
  for (let k = 0; k < SKY_PER_PASS; k++) {
    const m = pass * SKY_PER_PASS + k;
    const z = 1 - (2 * (m + 0.5)) / M, s = Math.sqrt(Math.max(0, 1 - z * z)), p = m * 2.399963229728653;
    sky.push([s * Math.cos(p), s * Math.sin(p), z]);
  }
  return { grid, light, shadow: transmittance(grid, light), sky, skyT: sky.map((d) => transmittance(grid, d)) };
}

/** Trilinear read of a cell field at a voxel-space point (cells clamped). */
export function cellAt(grid: ExtinctionGrid, T: Float32Array, x: number, y: number, z: number): number {
  const [gx, gy, gz] = grid.dims, [fx, fy, fz] = grid.f;
  // cell i's centre sits at voxel (i + 0.5)·f − 0.5
  const u = Math.min(gx - 1, Math.max(0, (x + 0.5) / fx - 0.5));
  const v = Math.min(gy - 1, Math.max(0, (y + 0.5) / fy - 0.5));
  const w = Math.min(gz - 1, Math.max(0, (z + 0.5) / fz - 0.5));
  const i0 = Math.floor(u), j0 = Math.floor(v), k0 = Math.floor(w);
  const i1 = Math.min(gx - 1, i0 + 1), j1 = Math.min(gy - 1, j0 + 1), k1 = Math.min(gz - 1, k0 + 1);
  const fu = u - i0, fv = v - j0, fw = w - k0;
  const r = (i: number, j: number, k: number): number => T[(k * gy + j) * gx + i]!;
  const c0 = (r(i0, j0, k0) * (1 - fu) + r(i1, j0, k0) * fu) * (1 - fv) + (r(i0, j1, k0) * (1 - fu) + r(i1, j1, k0) * fu) * fv;
  const c1 = (r(i0, j0, k1) * (1 - fu) + r(i1, j0, k1) * fu) * (1 - fv) + (r(i0, j1, k1) * (1 - fu) + r(i1, j1, k1) * fu) * fv;
  return c0 * (1 - fw) + c1 * fw;
}

const gridCache = new WeakMap<object, { key: string; grid: ExtinctionGrid }>();

/** extinctionGrid, cached per field for the last TF, density and step. */
export function cachedExtinction(
  field: ArrayLike<number>, dims: [number, number, number], spacing: Vec3, stops: TF, density: number, refMm: number,
): ExtinctionGrid {
  const key = JSON.stringify([dims, spacing, stops, density, refMm]);
  const hit = gridCache.get(field as object);
  if (hit && hit.key === key) return hit.grid;
  const grid = extinctionGrid(field, dims, spacing, stops, density, refMm);
  gridCache.set(field as object, { key, grid });
  return grid;
}
