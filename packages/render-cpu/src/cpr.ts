// Curved planar reformat (CPR): resample the volume along a centerline
// into a straightened vessel view + centerline length. The centerline is
// a caller-supplied polyline in voxel coords (drawn, imported, or traced
// — tracing itself stays out); this file owns resampling + length.
//
// Sampling: N output columns along arc length, M rows across the vessel
// (perpendicular in the axial plane at each station, trilinear). Windowed
// to grayscale RGBA like every other reslice. Pure, no DOM.
import { applyWindowLevel, type WindowLevel } from '@carys/volume-core';
import type { Volume } from '@carys/volume-core';
import { sampleTrilinear } from './oblique.js';

export type V3 = [number, number, number];

/** Arc-length table + total length of a voxel polyline (spacing-aware). */
export function centerlineLength(pts: V3[], spacing: V3): { total: number; cumulative: number[] } {
  if (pts.length < 2) throw new RangeError(`cpr-centerline: ${pts.length} points (want ≥2)`);
  if (!spacing.every((s) => Number.isFinite(s) && s > 0)) {
    throw new RangeError(`cpr-spacing: [${spacing}]`);
  }
  const cumulative = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = (pts[i]![0] - pts[i - 1]![0]) * spacing[0];
    const dy = (pts[i]![1] - pts[i - 1]![1]) * spacing[1];
    const dz = (pts[i]![2] - pts[i - 1]![2]) * spacing[2];
    cumulative.push(cumulative[i - 1]! + Math.hypot(dx, dy, dz));
  }
  return { total: cumulative[cumulative.length - 1]!, cumulative };
}

/** Point + tangent at arc position s (linear interp between stations). */
function stationAt(pts: V3[], cum: number[], s: number): { p: V3; tangent: V3 } {
  const total = cum[cum.length - 1]!;
  const sc = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < sc) i++;
  const s0 = cum[i - 1]!, s1 = cum[i]!;
  const f = s1 > s0 ? (sc - s0) / (s1 - s0) : 0;
  const a = pts[i - 1]!, b = pts[i]!;
  const p: V3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  return { p, tangent: [d[0] / n, d[1] / n, d[2] / n] };
}

/**
 * Straightened CPR view: columns = arc stations, rows = across-vessel
 * samples (±halfWidth voxels, 1px steps). The across direction is the
 * tangent crossed with +z, falling back to +x when the tangent is axial.
 */
export function curvedReformat(
  vol: Volume, centerline: V3[], wl: WindowLevel,
  columns = 128, halfWidth = 16,
): Uint8ClampedArray {
  if (!Number.isInteger(columns) || columns < 8) throw new RangeError(`cpr-columns: ${columns}`);
  if (!Number.isInteger(halfWidth) || halfWidth < 2) throw new RangeError(`cpr-width: ${halfWidth}`);
  const { total, cumulative } = centerlineLength(centerline, vol.spacing);
  const rows = halfWidth * 2 + 1;
  const out = new Uint8ClampedArray(columns * rows * 4);
  for (let c = 0; c < columns; c++) {
    const s = (c / (columns - 1)) * total;
    const { p, tangent } = stationAt(centerline, cumulative, s);
    // across = tangent × z, fallback x when tangent is axial
    let ax = -tangent[1], ay = tangent[0];
    if (Math.hypot(ax, ay) < 1e-6) { ax = 1; ay = 0; }
    const an = Math.hypot(ax, ay);
    ax /= an; ay /= an;
    for (let r = 0; r < rows; r++) {
      const off = r - halfWidth;
      const v = sampleTrilinear(
        vol.data, vol.dims, [p[0] + ax * off, p[1] + ay * off, p[2]],
      );
      const g = v == null ? 0 : applyWindowLevel(v, wl);
      const o = (r * columns + c) * 4;
      out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
    }
  }
  return out;
}
