// ROI statistics, ellipse geometry, Cobb angle, voxel probe — the rest of
// the Cornerstone measurement toolkit. Pure voxel math, no DOM.
import type { Volume } from '@carys/volume-core';

export interface RoiStats {
  count: number;
  mean: number;
  std: number;
  min: number;
  max: number;
}

/**
 * Stats over an inclusive voxel rect on one MPR slice (OHIF's rectangle
 * ROI: area comes from the corner taps × spacing, HU stats from here).
 * Coords are plane pixels — axial (x, y, z), coronal (x, z, y=slice),
 * sagittal (y, z, x=slice) — matching ellipseStats. Defaults to axial so
 * existing callers are unaffected.
 */
export function roiStats(
  vol: Volume,
  x0: number, y0: number, x1: number, y1: number, z: number,
  plane: MprPlane = 'axial',
): RoiStats {
  const [nx, ny, nz] = vol.dims;
  const nu = plane === 'sagittal' ? ny : nx;
  const nv = plane === 'axial' ? ny : nz;
  const ua = Math.max(0, Math.min(x0, x1));
  const ub = Math.min(nu - 1, Math.max(x0, x1));
  const va = Math.max(0, Math.min(y0, y1));
  const vb = Math.min(nv - 1, Math.max(y0, y1));
  const wMax = plane === 'axial' ? nz - 1 : plane === 'coronal' ? ny - 1 : nx - 1;
  const w = Math.max(0, Math.min(wMax, Math.round(z)));
  let count = 0, sum = 0, sum2 = 0, min = Infinity, max = -Infinity;
  for (let v = Math.ceil(va); v <= Math.floor(vb); v++) {
    for (let u = Math.ceil(ua); u <= Math.floor(ub); u++) {
      const idx = plane === 'axial' ? w * nx * ny + v * nx + u
        : plane === 'coronal' ? w * nx * ny + v * nx + u
        : v * nx * ny + u * nx + w;
      const val = vol.data[idx] as number;
      count++;
      sum += val;
      sum2 += val * val;
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }
  if (count === 0) return { count: 0, mean: NaN, std: NaN, min: NaN, max: NaN };
  const mean = sum / count;
  return { count, mean, std: Math.sqrt(Math.max(0, sum2 / count - mean * mean)), min, max };
}

/** Ellipse area from semi-axes in voxels + in-plane spacing (mm^2). */
export function ellipseArea(rx: number, ry: number, sx: number, sy: number): number {
  return Math.PI * Math.abs(rx) * sx * Math.abs(ry) * sy;
}

export type MprPlane = 'axial' | 'coronal' | 'sagittal';

/**
 * Stats over an axis-aligned ellipse interior on one MPR slice (OHIF's
 * ellipse ROI: area comes from ellipseArea, HU stats from here). Center +
 * semi-axes are in plane pixels: axial (x, y), coronal (x, z), sagittal
 * (y, z); `slice` fixes the remaining axis. Out-of-bounds pixels clamp
 * away; degenerate radii return the empty (NaN) stats.
 */
export function ellipseStats(
  vol: Volume,
  plane: MprPlane,
  slice: number,
  cu: number, cv: number, ru: number, rv: number,
): RoiStats {
  const empty = { count: 0, mean: NaN, std: NaN, min: NaN, max: NaN };
  if (!(ru > 0) || !(rv > 0)) return { ...empty };
  const [nx, ny, nz] = vol.dims;
  const wMax = plane === 'axial' ? nz - 1 : plane === 'coronal' ? ny - 1 : nx - 1;
  const w = Math.max(0, Math.min(wMax, Math.round(slice)));
  const at = (a: number, b: number): number => plane === 'axial'
    ? vol.data[w * nx * ny + b * nx + a] as number
    : plane === 'coronal'
      ? vol.data[w * nx * ny + b * nx + a] as number
      : vol.data[b * nx * ny + a * nx + w] as number;
  // in-plane bounds: axial/coronal u→x (nx), sagittal u→y (ny); v→y/z
  const nu = plane === 'sagittal' ? ny : nx;
  const nv = plane === 'axial' ? ny : nz;
  const u0 = Math.max(0, Math.floor(cu - ru)), u1 = Math.min(nu - 1, Math.ceil(cu + ru));
  const v0 = Math.max(0, Math.floor(cv - rv)), v1 = Math.min(nv - 1, Math.ceil(cv + rv));
  let count = 0, sum = 0, sum2 = 0, min = Infinity, max = -Infinity;
  for (let v = v0; v <= v1; v++) {
    for (let u = u0; u <= u1; u++) {
      const du = (u - cu) / ru, dv = (v - cv) / rv;
      if (du * du + dv * dv > 1) continue;
      const val = at(u, v);
      count++;
      sum += val;
      sum2 += val * val;
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }
  if (count === 0) return { ...empty };
  const mean = sum / count;
  return { count, mean, std: Math.sqrt(Math.max(0, sum2 / count - mean * mean)), min, max };
}

/** Cobb angle between two lines (degrees, 0..90). */
export function cobbAngle(
  a1: [number, number], a2: [number, number],
  b1: [number, number], b2: [number, number],
): number {
  const d1 = [a2[0] - a1[0], a2[1] - a1[1]];
  const d2 = [b2[0] - b1[0], b2[1] - b1[1]];
  const n1 = Math.hypot(d1[0], d1[1]) || 1;
  const n2 = Math.hypot(d2[0], d2[1]) || 1;
  const c = Math.min(1, Math.max(-1, (d1[0] * d2[0] + d1[1] * d2[1]) / (n1 * n2)));
  const deg = (Math.acos(c) * 180) / Math.PI;
  return deg > 90 ? 180 - deg : deg;
}

/** Nearest-voxel probe (HU / intensity readout). */
export function probePoint(vol: Volume, x: number, y: number, z: number): number | null {
  const [nx, ny, nz] = vol.dims;
  const xi = Math.round(x), yi = Math.round(y), zi = Math.round(z);
  if (xi < 0 || yi < 0 || zi < 0 || xi >= nx || yi >= ny || zi >= nz) return null;
  return vol.data[zi * nx * ny + yi * nx + xi] as number;
}
