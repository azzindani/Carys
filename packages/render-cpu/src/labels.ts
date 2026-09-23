// Segmentation in the 2D panes (F14): the labels on a pane's slice, a tint
// per label, and each label's outline.
//
// A label slice is W×H label values on the pane's (u, v) grid, the same
// grid the image reslice fills (orthogonal, thick slab or oblique). Its
// outline is the voxel edges between different labels, cut into straight
// runs, each run kept once per label on either side of it with the side
// the label lies on, so a caller can draw it just inside that label: two
// touching labels both show, side by side. Coordinates put voxel i on
// [i, i + 1], the image reslice's own frame.
import type { Plane } from './mpr.js';
import { slabRange } from './slab.js';

type V3 = [number, number, number];

/** The pane grid of a plane: its width and height in voxels. */
export function planeGrid(dims: V3, plane: Plane): [number, number] {
  const [nx, ny, nz] = dims;
  return plane === 'axial' ? [nx, ny] : plane === 'coronal' ? [nx, nz] : [ny, nz];
}

/** Voxel index of pane point (i, j) on slice k of a plane. */
function at(dims: V3, plane: Plane, i: number, j: number, k: number): number {
  const [nx, ny] = dims;
  return plane === 'axial' ? k * nx * ny + j * nx + i : plane === 'coronal' ? j * nx * ny + k * nx + i : j * nx * ny + i * nx + k;
}

/** The labels on slice `idx` of a plane. */
export function labelSlice(mask: ArrayLike<number>, dims: V3, plane: Plane, idx: number): Uint8Array {
  const [W, H] = planeGrid(dims, plane);
  const out = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) out[j * W + i] = mask[at(dims, plane, i, j, idx)]!;
  return out;
}

/**
 * The labels a thick slab shows: at each point the label nearest the slab's
 * centre slice (the one the pane is on wins over one further away).
 */
export function slabLabels(mask: ArrayLike<number>, dims: V3, plane: Plane, center: number, thickness: number): Uint8Array {
  const [W, H] = planeGrid(dims, plane);
  const depth = plane === 'axial' ? dims[2] : plane === 'coronal' ? dims[1] : dims[0];
  const { k0, k1 } = slabRange(depth, center, thickness);
  const c = Math.min(k1, Math.max(k0, Math.round(center)));
  const out = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let v = 0;
      // outward from the centre, one slice either side at a time
      for (let d = 0; !v && (c - d >= k0 || c + d <= k1); d++) {
        if (c - d >= k0) v = mask[at(dims, plane, i, j, c - d)]!;
        if (!v && d > 0 && c + d <= k1) v = mask[at(dims, plane, i, j, c + d)]!;
      }
      out[j * W + i] = v;
    }
  }
  return out;
}

/**
 * The labels on an oblique W×H slice through `center` along unit axes
 * `row` and `col` (voxels), nearest voxel; outside the volume is 0.
 */
export function labelSliceOblique(mask: ArrayLike<number>, dims: V3, center: V3, row: V3, col: V3, W: number, H: number): Uint8Array {
  const [nx, ny, nz] = dims;
  const out = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const px = Math.round(center[0] + (i - W / 2) * row[0] + (j - H / 2) * col[0]);
      const py = Math.round(center[1] + (i - W / 2) * row[1] + (j - H / 2) * col[1]);
      const pz = Math.round(center[2] + (i - W / 2) * row[2] + (j - H / 2) * col[2]);
      if (px < 0 || py < 0 || pz < 0 || px >= nx || py >= ny || pz >= nz) continue;
      out[j * W + i] = mask[pz * nx * ny + py * nx + px]!;
    }
  }
  return out;
}

/**
 * Tint `rgba` where `labels` is non-zero with the label's colour from
 * `lut` (r, g, b per label value): at `alpha` 1 the colour replaces the
 * pixel, below it mixes in.
 */
export function tintLabels(rgba: Uint8ClampedArray, labels: ArrayLike<number>, lut: ArrayLike<number>, alpha: number): void {
  for (let p = 0; p < labels.length; p++) {
    const v = labels[p]!;
    if (v <= 0) continue;
    const o = p * 4, c = v * 3;
    if (alpha >= 1) {
      rgba[o] = lut[c]!; rgba[o + 1] = lut[c + 1]!; rgba[o + 2] = lut[c + 2]!;
    } else {
      rgba[o] = rgba[o]! + (lut[c]! - rgba[o]!) * alpha;
      rgba[o + 1] = rgba[o + 1]! + (lut[c + 1]! - rgba[o + 1]!) * alpha;
      rgba[o + 2] = rgba[o + 2]! + (lut[c + 2]! - rgba[o + 2]!) * alpha;
    }
  }
}

/** Numbers per outline run: x0, y0, x1, y1, then the unit step (nx, ny)
 *  from the run into its label. */
export const RUN = 6;

/**
 * Each label's outline on a W×H label slice: runs of voxel edges with a
 * different label (or the slice's border) on the other side.
 */
export function labelOutlines(labels: ArrayLike<number>, W: number, H: number): Map<number, Float32Array> {
  const runs = new Map<number, number[]>();
  const push = (v: number, x0: number, y0: number, x1: number, y1: number, nx: number, ny: number): void => {
    let r = runs.get(v);
    if (!r) runs.set(v, (r = []));
    r.push(x0, y0, x1, y1, nx, ny);
  };
  // Each side of a line is followed on its own: a label's run goes on while
  // that label stays on its side and something else is across, whatever
  // the something else is.
  // horizontal edges: line y between rows y − 1 (a, above) and y (b, below)
  for (let y = 0; y <= H; y++) {
    let ta = 0, sa = 0, tb = 0, sb = 0;
    for (let x = 0; x <= W; x++) {
      const a = x < W && y > 0 ? labels[(y - 1) * W + x]! : 0;
      const b = x < W && y < H ? labels[y * W + x]! : 0;
      const ea = a !== b ? a : 0, eb = a !== b ? b : 0;
      if (ea !== ta) { if (ta > 0) push(ta, sa, y, x, y, 0, -1); ta = ea; sa = x; }
      if (eb !== tb) { if (tb > 0) push(tb, sb, y, x, y, 0, 1); tb = eb; sb = x; }
    }
  }
  // vertical edges: line x between columns x − 1 (a, left) and x (b, right)
  for (let x = 0; x <= W; x++) {
    let ta = 0, sa = 0, tb = 0, sb = 0;
    for (let y = 0; y <= H; y++) {
      const a = y < H && x > 0 ? labels[y * W + x - 1]! : 0;
      const b = y < H && x < W ? labels[y * W + x]! : 0;
      const ea = a !== b ? a : 0, eb = a !== b ? b : 0;
      if (ea !== ta) { if (ta > 0) push(ta, x, sa, x, y, -1, 0); ta = ea; sa = y; }
      if (eb !== tb) { if (tb > 0) push(tb, x, sb, x, y, 1, 0); tb = eb; sb = y; }
    }
  }
  const out = new Map<number, Float32Array>();
  for (const [v, r] of [...runs].sort((p, q) => p[0] - q[0])) out.set(v, Float32Array.from(r));
  return out;
}
