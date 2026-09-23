// Slice interpolation for editing (F15): paint a structure every few slices,
// fill the slices between. Shape-based, as F5 fills thick slices: each
// painted slice becomes a 2D signed distance map in mm (exact EDT, the edge
// at the midpoint between pixel centres), the maps are interpolated across
// the gaps with a cubic through all the painted slices (Hermite, tangents
// from the neighbouring painted slices, so an outline that grows then
// shrinks bulges between them as the structure does), and a pixel is in
// where the interpolated distance is below zero.
//
// Each label is filled between its own painted slices; labels painted on
// the same slices that overlap are filled as one shape and split by which
// label a voxel is deepest in; where fills meet, the deeper one wins, and
// a voxel already labelled is never written. The axis is the one the painting was done across: the one whose
// slices are sparsest, the largest share of them empty between painted ones
// (strokes offset in the plane leave empty rows too, but fewer by share).
import { edt2 } from './thick-slices.js';

type V3 = [number, number, number];
export type Axis = 0 | 1 | 2;

export interface SliceFill {
  mask: Uint8Array;
  /** across which axis the slices were filled (0 x sagittal, 1 y coronal, 2 z axial) */
  axis: Axis;
  /** slices that gained voxels */
  slices: number;
  /** voxels labelled that were empty */
  voxels: number;
  /** the labels that had gaps to fill */
  labels: number[];
}

/** In-plane axes (u, v) of the slices across each axis. */
const PLANE: Record<Axis, [Axis, Axis]> = { 0: [1, 2], 1: [0, 2], 2: [0, 1] };
/** Pixels kept around a label's in-plane box, so every slice has an outside. */
const MARGIN = 2;

/** Per label: the slices it is on along each axis, and its box. */
interface Extent {
  on: [Uint8Array, Uint8Array, Uint8Array];
  min: V3;
  max: V3;
}

function extents(mask: Uint8Array, dims: V3): Map<number, Extent> {
  const [nx, ny, nz] = dims;
  const out = new Map<number, Extent>();
  for (let z = 0, i = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++, i++) {
        const v = mask[i]!;
        if (!v) continue;
        let e = out.get(v);
        if (!e) {
          e = { on: [new Uint8Array(nx), new Uint8Array(ny), new Uint8Array(nz)], min: [x, y, z], max: [x, y, z] };
          out.set(v, e);
        }
        e.on[0][x] = 1; e.on[1][y] = 1; e.on[2][z] = 1;
        if (x < e.min[0]) e.min[0] = x; if (x > e.max[0]) e.max[0] = x;
        if (y < e.min[1]) e.min[1] = y; if (y > e.max[1]) e.max[1] = y;
        if (z < e.min[2]) e.min[2] = z; if (z > e.max[2]) e.max[2] = z;
      }
    }
  }
  return out;
}

/** Empty slices between a label's first and last along an axis. */
function gaps(e: Extent, a: Axis): number {
  let n = 0;
  for (let s = e.min[a]; s <= e.max[a]; s++) if (!e.on[a][s]) n++;
  return n;
}

/**
 * Fill every label's empty slices between its painted ones, across `axis`
 * (default: the axis whose slices are sparsest). `sp` is the voxel size, mm.
 * A mask with nothing to fill comes back as a copy with `slices` 0.
 */
export function fillBetweenSlices(mask: Uint8Array, dims: V3, sp: V3, opts: { axis?: Axis } = {}): SliceFill {
  const [nx, ny, nz] = dims;
  if (mask.length !== nx * ny * nz) throw new RangeError(`slice-fill-dims: ${mask.length} voxels for ${dims.join('×')}`);
  const ext = extents(mask, dims);
  let axis: Axis = opts.axis ?? 2;
  if (opts.axis === undefined) {
    let most = 0;
    for (const a of [2, 1, 0] as Axis[]) {
      let empty = 0, span = 0;
      for (const e of ext.values()) { empty += gaps(e, a); span += e.max[a] - e.min[a] + 1; }
      if (span > 0 && empty / span > most) { most = empty / span; axis = a; }
    }
  }
  const out = mask.slice();
  const [pu, pv] = PLANE[axis];
  const stride = [1, nx, nx * ny];
  const hu = sp[pu], hv = sp[pv], half = Math.min(hu, hv) / 2;
  // every label's painted slices and in-plane box (with a margin of outside)
  type Part = { label: number; keys: number[]; u0: number; u1: number; v0: number; v1: number };
  const parts: Part[] = [];
  for (const [label, e] of [...ext].sort((p, q) => p[0] - q[0])) {
    const keys: number[] = [];
    for (let s = e.min[axis]; s <= e.max[axis]; s++) if (e.on[axis][s]) keys.push(s);
    parts.push({
      label, keys,
      u0: Math.max(0, e.min[pu] - MARGIN), u1: Math.min(dims[pu] - 1, e.max[pu] + MARGIN),
      v0: Math.max(0, e.min[pv] - MARGIN), v1: Math.min(dims[pv] - 1, e.max[pv] + MARGIN),
    });
  }
  // Labels that overlap and were painted on the same slices (where their
  // slice ranges meet) are filled as one group: their union is
  // interpolated as one shape, so nested labels (an edema ring round a
  // core) leave no gaps between them, and inside it each voxel takes the
  // label it is deepest in. Labels painted apart stay apart, so separate
  // structures never morph into each other.
  const together = (a: Part, b: Part): boolean => {
    if (a.u0 > b.u1 || b.u0 > a.u1 || a.v0 > b.v1 || b.v0 > a.v1) return false;
    const lo = Math.max(a.keys[0]!, b.keys[0]!), hi = Math.min(a.keys[a.keys.length - 1]!, b.keys[b.keys.length - 1]!);
    if (lo > hi) return false;
    const inA = a.keys.filter((k) => k >= lo && k <= hi), inB = b.keys.filter((k) => k >= lo && k <= hi);
    return inA.join() === inB.join();
  };
  const groupOf = parts.map((_, i) => i);
  const root = (i: number): number => (groupOf[i] === i ? i : (groupOf[i] = root(groupOf[i]!)));
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (together(parts[i]!, parts[j]!)) groupOf[root(j)] = root(i);
  const groups: Part[][] = [];
  const byRoot = new Map<number, Part[]>();
  parts.forEach((t, i) => {
    let g = byRoot.get(root(i));
    if (!g) { byRoot.set(root(i), (g = [])); groups.push(g); }
    g.push(t);
  });
  // a group fills where its painted slices leave a gap
  const todo = groups
    .map((g) => ({ g, keys: [...new Set(g.flatMap((t) => t.keys))].sort((x, y) => x - y) }))
    .filter(({ keys }) => keys.some((k, i) => i > 0 && k - keys[i - 1]! > 1));
  let U0 = Infinity, U1 = -1, V0 = Infinity, V1 = -1;
  for (const { g } of todo) for (const t of g) { U0 = Math.min(U0, t.u0); U1 = Math.max(U1, t.u1); V0 = Math.min(V0, t.v0); V1 = Math.max(V1, t.v1); }
  const BW = U1 - U0 + 1, BH = V1 - V0 + 1;
  // per filled slice: the most-inside distance so far, and whose it is
  const best = new Map<number, { d: Float32Array; label: Uint8Array }>();
  for (const { g: group, keys } of todo) {
    const labels = group.map((t) => t.label);
    const u0 = Math.min(...group.map((t) => t.u0)), v0 = Math.min(...group.map((t) => t.v0));
    const w = Math.max(...group.map((t) => t.u1)) - u0 + 1, h = Math.max(...group.map((t) => t.v1)) - v0 + 1;
    const member = new Uint8Array(256);
    for (const l of labels) member[l] = 1;
    const at = (s: number, p: number): number => s * stride[axis]! + (u0 + (p % w)) * stride[pu]! + (v0 + Math.floor(p / w)) * stride[pv]!;
    /** Signed distance (mm, inside negative) of what `inn` holds. */
    const signed = (inn: (p: number) => boolean): Float32Array => {
      const toIn = edt2(inn, w, h, hu, hv), toOut = edt2((p) => !inn(p), w, h, hu, hv);
      const d = new Float32Array(w * h);
      for (let p = 0; p < d.length; p++) {
        const x = p % w, y = Math.floor(p / w), here = inn(p);
        // next to the edge: the distance to the midpoint(s), exactly
        const tx = (x > 0 && inn(p - 1) !== here) || (x < w - 1 && inn(p + 1) !== here) ? hu / 2 : Infinity;
        const ty = (y > 0 && inn(p - w) !== here) || (y < h - 1 && inn(p + w) !== here) ? hv / 2 : Infinity;
        const near = tx === Infinity ? ty : ty === Infinity ? tx : (tx * ty) / Math.hypot(tx, ty);
        const far = Math.sqrt(here ? toOut[p]! : toIn[p]!) - half;
        d[p] = (here ? -1 : 1) * (near === Infinity ? far : near);
      }
      return d;
    };
    /** A label's distances on its painted slice nearest `s`, pushed out by
     *  the gap to `s` (F5's closure of an object's end): on a group slice
     *  it was not painted on, it tapers instead of stopping dead. */
    const own = (t: Part, s: number): Float32Array => {
      let k = t.keys[0]!;
      for (const q of t.keys) if (Math.abs(q - s) < Math.abs(k - s)) k = q;
      const d = signed((p) => mask[at(k, p)] === t.label);
      const push = Math.abs(k - s) * sp[axis];
      if (push > 0) for (let p = 0; p < d.length; p++) d[p] = d[p]! + push;
      return d;
    };
    // per painted slice: the union's distance, then each label's (one label: the same)
    const cache = new Map<number, Float32Array[]>();
    const sdf = (s: number): Float32Array[] => {
      let d = cache.get(s);
      if (d) return d;
      const union = signed((p) => member[mask[at(s, p)]!] === 1);
      d = labels.length === 1 ? [union, union] : [union, ...group.map((t) => own(t, s))];
      cache.set(s, d);
      return d;
    };
    const last = keys.length - 1;
    for (let i = 0; i < last; i++) {
      const k0 = keys[i]!, k1 = keys[i + 1]!, gap = k1 - k0;
      if (gap < 2) continue;
      // tangents at both ends from the painted slices either side of them
      // (one-sided at the first and last)
      const ia = Math.max(0, i - 1), ib = Math.min(last, i + 2);
      const PA = sdf(keys[ia]!), D0 = sdf(k0), D1 = sdf(k1), PB = sdf(keys[ib]!);
      const s0 = gap / (k1 - keys[ia]!), s1 = gap / (keys[ib]! - k0);
      for (let s = k0 + 1; s < k1; s++) {
        const t = (s - k0) / gap, t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        const lerp = (j: number, p: number): number =>
          h00 * D0[j]![p]! + h10 * (D1[j]![p]! - PA[j]![p]!) * s0 + h01 * D1[j]![p]! + h11 * (PB[j]![p]! - D0[j]![p]!) * s1;
        let b = best.get(s);
        for (let p = 0; p < w * h; p++) {
          // the cubic may bulge a shape out between its slices, never open
          // a hole where both neighbouring painted slices are inside
          const d = Math.min(lerp(0, p), Math.max(D0[0]![p]!, D1[0]![p]!));
          if (!(d < 0)) continue;
          let label = labels[0]!;
          for (let j = 1, most = Infinity; j <= labels.length && labels.length > 1; j++) {
            const dj = lerp(j, p);
            if (dj < most) { most = dj; label = labels[j - 1]!; }
          }
          if (!b) {
            b = { d: new Float32Array(BW * BH).fill(Infinity), label: new Uint8Array(BW * BH) };
            best.set(s, b);
          }
          const q = (v0 - V0 + Math.floor(p / w)) * BW + u0 - U0 + (p % w);
          if (d < b.d[q]!) { b.d[q] = d; b.label[q] = label; }
        }
      }
      if (i > 0) cache.delete(keys[i - 1]!);
    }
  }
  let slices = 0, voxels = 0;
  for (const [s, b] of best) {
    let any = false;
    for (let q = 0; q < b.label.length; q++) {
      const v = b.label[q]!;
      if (!v) continue;
      const o = s * stride[axis]! + (U0 + (q % BW)) * stride[pu]! + (V0 + Math.floor(q / BW)) * stride[pv]!;
      if (out[o]) continue;
      out[o] = v;
      voxels++;
      any = true;
    }
    if (any) slices++;
  }
  return { mask: out, axis, slices, voxels, labels: todo.flatMap(({ g }) => g.map((t) => t.label)).sort((x, y) => x - y) };
}
