// Measure on the oblique axial pane: canvas taps live on the tilted frame
// the paint used, so values must come from that frame, not the orthogonal
// slice. The frame is plain data (center/row/col) built by the caller from
// obliqueBasis — this file owns the tap inverse, the physical pixel area,
// oblique ROI stats, and the spacing-aware Cobb angle. Pure, no DOM.
import type { Volume } from '@carys/volume-core';
import type { RoiStats } from './roi.js';

/** The tilted sampling frame: paint center + orthonormal row/col dirs. */
export interface ObliqueFrame {
  center: [number, number, number];
  row: [number, number, number];
  col: [number, number, number];
}

type V3 = [number, number, number];

/**
 * Canvas pixel (i, j) on a W×H oblique frame → voxel coords (float). Exact
 * inverse of the resliceOblique forward map (center + (i−W/2)·row +
 * (j−H/2)·col), so the caller must pass the same center/W/H the paint used.
 */
export function obliqueTapVoxel(
  frame: ObliqueFrame, W: number, H: number, i: number, j: number,
): V3 {
  const du = i - W / 2, dv = j - H / 2;
  return [
    frame.center[0] + du * frame.row[0] + dv * frame.col[0],
    frame.center[1] + du * frame.row[1] + dv * frame.col[1],
    frame.center[2] + du * frame.row[2] + dv * frame.col[2],
  ];
}

/**
 * Physical area (mm²) of one frame pixel: |row_mm × col_mm|. Orthonormal
 * frames reproduce su·sv exactly (axial row=+x col=+y gives sx·sy).
 */
export function obliquePixelArea(frame: ObliqueFrame, spacing: V3): number {
  const r: V3 = [frame.row[0] * spacing[0], frame.row[1] * spacing[1], frame.row[2] * spacing[2]];
  const c: V3 = [frame.col[0] * spacing[0], frame.col[1] * spacing[1], frame.col[2] * spacing[2]];
  const cross: V3 = [
    r[1] * c[2] - r[2] * c[1],
    r[2] * c[0] - r[0] * c[2],
    r[0] * c[1] - r[1] * c[0],
  ];
  return Math.hypot(cross[0], cross[1], cross[2]);
}

const emptyStats = (): RoiStats => ({ count: 0, mean: NaN, std: NaN, min: NaN, max: NaN });

function statsOfIndices(vol: Volume, ids: number[]): RoiStats {
  if (ids.length === 0) return emptyStats();
  let sum = 0, sum2 = 0, min = Infinity, max = -Infinity;
  for (const idx of ids) {
    const val = vol.data[idx] as number;
    sum += val;
    sum2 += val * val;
    if (val < min) min = val;
    if (val > max) max = val;
  }
  const mean = sum / ids.length;
  return {
    count: ids.length, mean,
    std: Math.sqrt(Math.max(0, sum2 / ids.length - mean * mean)), min, max,
  };
}

/**
 * Distinct voxels hit by integer frame pixels in [ua..ub]×[va..vb] through
 * the oblique frame (rounded, out-of-bounds skipped like resliceOblique's
 * black-outside). Zero tilt reproduces roiStats on that slice.
 */
export function obliqueRectStats(
  vol: Volume, frame: ObliqueFrame, W: number, H: number,
  u0: number, v0: number, u1: number, v1: number,
): RoiStats {
  const [nx, ny, nz] = vol.dims;
  const ua = Math.max(0, Math.floor(Math.min(u0, u1)));
  const ub = Math.min(W - 1, Math.ceil(Math.max(u0, u1)));
  const va = Math.max(0, Math.floor(Math.min(v0, v1)));
  const vb = Math.min(H - 1, Math.ceil(Math.max(v0, v1)));
  const seen = new Set<number>();
  const ids: number[] = [];
  for (let v = va; v <= vb; v++) {
    for (let u = ua; u <= ub; u++) {
      const [x, y, z] = obliqueTapVoxel(frame, W, H, u, v);
      const xi = Math.round(x), yi = Math.round(y), zi = Math.round(z);
      if (xi < 0 || yi < 0 || zi < 0 || xi >= nx || yi >= ny || zi >= nz) continue;
      const idx = zi * nx * ny + yi * nx + xi;
      if (seen.has(idx)) continue;
      seen.add(idx);
      ids.push(idx);
    }
  }
  return statsOfIndices(vol, ids);
}

/**
 * Distinct voxels inside the frame-space ellipse (center + semi-axes in
 * frame pixels). Degenerate radii return the empty (NaN) stats, matching
 * ellipseStats. Zero tilt reproduces ellipseStats on that slice.
 */
export function obliqueEllipseStats(
  vol: Volume, frame: ObliqueFrame, W: number, H: number,
  cu: number, cv: number, ru: number, rv: number,
): RoiStats {
  if (!(ru > 0) || !(rv > 0)) return emptyStats();
  const [nx, ny, nz] = vol.dims;
  const u0 = Math.max(0, Math.floor(cu - ru)), u1 = Math.min(W - 1, Math.ceil(cu + ru));
  const v0 = Math.max(0, Math.floor(cv - rv)), v1 = Math.min(H - 1, Math.ceil(cv + rv));
  const seen = new Set<number>();
  const ids: number[] = [];
  for (let v = v0; v <= v1; v++) {
    for (let u = u0; u <= u1; u++) {
      const du = (u - cu) / ru, dv = (v - cv) / rv;
      if (du * du + dv * dv > 1) continue;
      const [x, y, z] = obliqueTapVoxel(frame, W, H, u, v);
      const xi = Math.round(x), yi = Math.round(y), zi = Math.round(z);
      if (xi < 0 || yi < 0 || zi < 0 || xi >= nx || yi >= ny || zi >= nz) continue;
      const idx = zi * nx * ny + yi * nx + xi;
      if (seen.has(idx)) continue;
      seen.add(idx);
      ids.push(idx);
    }
  }
  return statsOfIndices(vol, ids);
}

/**
 * Cobb angle between two 3D segments (degrees, 0..90), spacing-aware: the
 * taps are coplanar on the oblique frame, so the physical angle between the
 * segments is well defined. Degenerate zero-length segments mirror the 2D
 * sibling (|| 1 guard → 90°).
 */
export function cobbAngle3(
  a1: V3, a2: V3, b1: V3, b2: V3, spacing: V3,
): number {
  const d1: V3 = [(a2[0] - a1[0]) * spacing[0], (a2[1] - a1[1]) * spacing[1], (a2[2] - a1[2]) * spacing[2]];
  const d2: V3 = [(b2[0] - b1[0]) * spacing[0], (b2[1] - b1[1]) * spacing[1], (b2[2] - b1[2]) * spacing[2]];
  const n1 = Math.hypot(d1[0], d1[1], d1[2]) || 1;
  const n2 = Math.hypot(d2[0], d2[1], d2[2]) || 1;
  const c = Math.min(1, Math.max(-1, (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) / (n1 * n2)));
  const deg = (Math.acos(c) * 180) / Math.PI;
  return deg > 90 ? 180 - deg : deg;
}
