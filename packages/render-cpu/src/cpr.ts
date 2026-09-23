// Curved planar reformat (CPR, F16): a straightened view along a centreline
// clicked on the panes.
//
// The clicked points (voxels) become a centripetal Catmull-Rom spline in
// millimetres, through every point and without the kinks a polyline puts
// in the image at each click, resampled every `step` mm. At each station
// the view samples a line across the curve: perpendicular to it and to the
// vector of interest (the normal of the pane the curve was drawn on, so at
// angle 0 the view is that pane straightened out), turned about the curve
// by `angle` (a quarter turn shows the curved surface the curve sweeps
// along the pane's normal). Columns follow the curve and rows go across,
// both `step` mm apart: the image is millimetre-true, whatever the voxel
// size. Pure, no DOM.
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

export interface CprOpts {
  /** mm between columns and between rows */
  step: number;
  /** how far the view reaches either side of the curve, mm */
  halfWidth: number;
  /** vector of interest, voxel axes: the normal of the pane drawn on */
  up: V3;
  /** turn of the across direction about the curve, radians */
  angle?: number;
}

export interface Cpr {
  /** grayscale, `width` columns along the curve × `height` rows across */
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** mm between pixels, both ways */
  step: number;
  /** length of the curve, mm */
  length: number;
  /** each column's point on the curve (voxels) */
  stations: V3[];
  /** each column's across direction, voxels per mm (row 0 is its + end) */
  across: V3[];
  /** the column each clicked point lands on */
  knots: number[];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

/** Centripetal Catmull-Rom between p1 and p2 at u in [0, 1] (Barry-Goldman). */
function catmull(p0: V3, p1: V3, p2: V3, p3: V3, u: number): V3 {
  const knot = (a: V3, b: V3): number => Math.sqrt(norm(sub(b, a))) || 1e-6;
  const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a: V3, b: V3, ta: number, tb: number): V3 => {
    const w = (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
  };
  const a1 = lerp(p0, p1, 0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
  return lerp(lerp(a1, a2, 0, t2), lerp(a2, a3, t1, t3), t1, t2);
}

/**
 * The spline through `pts` (voxels) in mm, densely sampled: points, their
 * arc length, and where each clicked point falls on it.
 */
function spline(pts: V3[], sp: V3, step: number): { p: V3[]; s: number[]; knots: number[] } {
  const mm = pts.map((q): V3 => [q[0] * sp[0], q[1] * sp[1], q[2] * sp[2]]);
  // a repeated click adds nothing
  const P = mm.filter((q, i) => i === 0 || norm(sub(q, mm[i - 1]!)) > 1e-9);
  if (P.length < 2) throw new RangeError(`cpr-centerline: ${P.length} distinct points (want ≥2)`);
  const n = P.length;
  // ghost points past the ends, on the parabola through the last three
  // clicks (a mirrored point would straighten the end segments), or the
  // mirror of the one neighbour when there are only two
  const ghost = (a: V3, b: V3, c: V3 | undefined): V3 =>
    c ? [3 * a[0] - 3 * b[0] + c[0], 3 * a[1] - 3 * b[1] + c[1], 3 * a[2] - 3 * b[2] + c[2]] : sub(a, sub(b, a));
  const g0 = ghost(P[0]!, P[1]!, P[2]), g1 = ghost(P[n - 1]!, P[n - 2]!, P[n - 3]);
  const at = (i: number): V3 => (i < 0 ? g0 : i >= n ? g1 : P[i]!);
  const p: V3[] = [P[0]!], knots = [0];
  for (let i = 0; i + 1 < n; i++) {
    const m = Math.max(8, Math.ceil((norm(sub(P[i + 1]!, P[i]!)) / step) * 4));
    for (let k = 1; k <= m; k++) p.push(catmull(at(i - 1), P[i]!, P[i + 1]!, at(i + 2), k / m));
    knots.push(p.length - 1);
  }
  const s = [0];
  for (let i = 1; i < p.length; i++) s.push(s[i - 1]! + norm(sub(p[i]!, p[i - 1]!)));
  return { p, s, knots: knots.map((k) => s[k]!) };
}

/** Point at arc length `t` on a densely sampled curve (linear between samples). */
function pointAt(p: V3[], s: number[], t: number, hint: { i: number }): V3 {
  let i = hint.i;
  while (i < s.length - 2 && s[i + 1]! < t) i++;
  hint.i = i;
  const f = s[i + 1]! > s[i]! ? Math.min(1, Math.max(0, (t - s[i]!) / (s[i + 1]! - s[i]!))) : 0;
  const a = p[i]!, b = p[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** The curve through `pts` (voxels), a point every `step` mm (voxels):
 *  what the panes draw, the line the straightened view follows. */
export function cprPath(pts: V3[], spacing: V3, step: number): V3[] {
  if (!(step > 0)) throw new RangeError(`cpr-step: ${step}`);
  const { p, s } = spline(pts, spacing, step);
  // the view's own stations (c × step), then the curve's end
  const length = s[s.length - 1]!, width = Math.floor(length / step) + 1, hint = { i: 0 }, out: V3[] = [];
  for (let c = 0; c < width; c++) {
    const q = pointAt(p, s, c * step, hint);
    out.push([q[0] / spacing[0], q[1] / spacing[1], q[2] / spacing[2]]);
  }
  const e = p[p.length - 1]!;
  if ((width - 1) * step < length) out.push([e[0] / spacing[0], e[1] / spacing[1], e[2] / spacing[2]]);
  return out;
}

/**
 * The straightened view of `vol` along the curve through `pts` (voxels,
 * at least two distinct), windowed to grayscale. Throws `cpr-*` on bad
 * geometry.
 */
export function straightenedCpr(vol: Volume, pts: V3[], wl: WindowLevel, o: CprOpts): Cpr {
  const sp = vol.spacing;
  if (!sp.every((v) => Number.isFinite(v) && v > 0)) throw new RangeError(`cpr-spacing: [${sp}]`);
  if (!(o.step > 0)) throw new RangeError(`cpr-step: ${o.step}`);
  if (!(o.halfWidth >= o.step)) throw new RangeError(`cpr-width: ${o.halfWidth} mm at ${o.step} mm steps`);
  if (!(norm(o.up) > 0)) throw new RangeError(`cpr-up: [${o.up}]`);
  const up = unit(o.up);
  const { p, s, knots } = spline(pts, sp, o.step);
  const length = s[s.length - 1]!;
  const width = Math.floor(length / o.step) + 1, half = Math.round(o.halfWidth / o.step), height = 2 * half + 1;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const stations: V3[] = [], across: V3[] = [];
  const ca = Math.cos(o.angle ?? 0), sa = Math.sin(o.angle ?? 0);
  const hint = { i: 0 }, hint2 = { i: 0 }, hint3 = { i: 0 };
  let prev: V3 | null = null;
  for (let c = 0; c < width; c++) {
    const t = c * o.step;
    const q = pointAt(p, s, t, hint);
    const tan = unit(sub(pointAt(p, s, Math.min(length, t + o.step / 2), hint3), pointAt(p, s, Math.max(0, t - o.step / 2), hint2)));
    // across: in the drawn pane, perpendicular to the curve; where the curve
    // runs along the pane's normal, the last across carried on
    let a0 = cross(up, tan);
    if (norm(a0) < 0.1) {
      const b = prev ?? (Math.abs(tan[0]) < 0.9 ? [1, 0, 0] as V3 : [0, 1, 0] as V3);
      const d = dot(b, tan);
      a0 = [b[0] - d * tan[0], b[1] - d * tan[1], b[2] - d * tan[2]];
    }
    a0 = unit(a0);
    prev = a0;
    const b0 = cross(tan, a0);
    const a: V3 = [ca * a0[0] + sa * b0[0], ca * a0[1] + sa * b0[1], ca * a0[2] + sa * b0[2]];
    stations.push([q[0] / sp[0], q[1] / sp[1], q[2] / sp[2]]);
    across.push([a[0] / sp[0], a[1] / sp[1], a[2] / sp[2]]);
    for (let r = 0; r < height; r++) {
      const off = (half - r) * o.step;
      const v = sampleTrilinear(vol.data, vol.dims, [(q[0] + a[0] * off) / sp[0], (q[1] + a[1] * off) / sp[1], (q[2] + a[2] * off) / sp[2]]);
      const g = v == null ? 0 : applyWindowLevel(v, wl);
      const k = (r * width + c) * 4;
      rgba[k] = g; rgba[k + 1] = g; rgba[k + 2] = g; rgba[k + 3] = 255;
    }
  }
  return {
    rgba, width, height, step: o.step, length, stations, across,
    knots: knots.map((k) => Math.min(width - 1, Math.round(k / o.step))),
  };
}

/** The voxel under pixel (col, row) of a straightened view. */
export function cprVoxel(c: Cpr, col: number, row: number): V3 {
  const i = Math.min(c.width - 1, Math.max(0, Math.round(col)));
  const off = ((c.height - 1) / 2 - row) * c.step;
  const q = c.stations[i]!, a = c.across[i]!;
  return [q[0] + a[0] * off, q[1] + a[1] * off, q[2] + a[2] * off];
}
