// A gait cycle on the rig (H6, docs/PHASES.md): the root's rise and fall
// from the feet's contact with the ground, how far a grounded foot slips,
// and each muscle's length between its two attachments. Pure, no DOM.
import { NO_SEG, segmentTransforms, type Pose, type Rig, type SkinWeights } from './rig.js';

type V3 = [number, number, number];

/** A foot's contact with the ground, per frame (1 in contact). */
export interface GaitContact { left: ArrayLike<number>; right: ArrayLike<number> }

/** Where segment s's transform takes point p. */
const move = (T: Float64Array, s: number, x: number, y: number, z: number): V3 => {
  const o = s * 12;
  return [
    T[o]! * x + T[o + 1]! * y + T[o + 2]! * z + T[o + 9]!,
    T[o + 3]! * x + T[o + 4]! * y + T[o + 5]! * z + T[o + 10]!,
    T[o + 6]! * x + T[o + 7]! * y + T[o + 8]! * z + T[o + 11]!,
  ];
};

/** A foot: its segment and points on its sole (rest pose, rig frame). */
export interface Foot { seg: number; points: Float64Array }

/** A foot's sole: its bones' vertices within `height` of the lowest of
 *  them along `up`. */
export function solePoints(bones: readonly ArrayLike<number>[], up: 0 | 1 | 2, height: number): Float64Array {
  let low = Infinity;
  for (const P of bones) for (let i = up; i < P.length; i += 3) low = Math.min(low, P[i]!);
  if (low === Infinity) throw new RangeError('gait-sole: no bone vertices');
  const out: number[] = [];
  for (const P of bones) for (let i = 0; i < P.length; i += 3) if (P[i + up]! - low <= height) out.push(P[i]!, P[i + 1]!, P[i + 2]!);
  return Float64Array.from(out);
}

/**
 * The root's height offset per frame (along axis `up`) that sets the lowest
 * point of the feet in contact on the ground (`ground` along `up`); in a
 * flight between contacts, the arc a body falls on under gravity `g` (the
 * rig's units a second squared) between the contacts either side. The
 * cycle repeats. Throws when no frame is in contact.
 */
export function groundRoot(
  rig: Rig, poses: readonly Pose[], feet: { left: Foot; right: Foot }, contact: GaitContact,
  frameTime: number, up: 0 | 1 | 2, ground: number, g: number,
): number[] {
  const n = poses.length, off = new Array<number>(n).fill(NaN);
  for (let f = 0; f < n; f++) {
    const T = segmentTransforms(rig, poses[f]!);
    let low = Infinity;
    for (const [side, foot] of [['left', feet.left], ['right', feet.right]] as const) {
      if (!contact[side][f]) continue;
      const P = foot.points;
      for (let i = 0; i < P.length; i += 3) low = Math.min(low, move(T, foot.seg, P[i]!, P[i + 1]!, P[i + 2]!)[up]);
    }
    if (low < Infinity) off[f] = ground - low;
  }
  if (off.every((v) => Number.isNaN(v))) throw new RangeError('gait-contact: no frame has a foot on the ground');
  for (let f = 0; f < n; f++) {
    if (!Number.isNaN(off[f]!)) continue;
    let a = f, b = f;
    while (Number.isNaN(off[((a % n) + n) % n]!)) a--;
    while (Number.isNaN(off[b % n]!)) b++;
    const za = off[((a % n) + n) % n]!, zb = off[b % n]!, t = (f - a) * frameTime, span = (b - a) * frameTime;
    // a thrown body: above the chord between take-off and landing
    off[f] = za + ((zb - za) * t) / span + 0.5 * g * t * (span - t);
  }
  return off;
}

/**
 * The root's move across the ground per frame that keeps the grounded sole
 * points still: between two frames the body goes on by as much as the sole
 * points grounded in both slid back (averaged over both feet when both are
 * down); in a flight, at the mean of its take-off and landing steps. With
 * `rise` the root's height offsets (groundRoot). Returns each frame's
 * offset less the cycle's mean velocity × time (so the cycle loops in
 * place), and that velocity (the rig's units a second).
 */
export function plantRoot(
  rig: Rig, poses: readonly Pose[], rise: readonly number[], feet: { left: Foot; right: Foot }, contact: GaitContact,
  frameTime: number, up: 0 | 1 | 2, ground: number, tol: number,
): { offsets: V3[]; velocity: V3 } {
  const n = poses.length, across = [0, 1, 2].filter((k) => k !== up) as [number, number];
  const lift = (f: number): V3 => { const r: V3 = [0, 0, 0]; r[up] = rise[f]!; return r; };
  const Ts = poses.map((p, f) => segmentTransforms(rig, p, lift(f)));
  const step: ([number, number] | null)[] = [];
  for (let f = 0; f < n; f++) {
    const g = (f + 1) % n;
    let sx = 0, sy = 0, k = 0;
    for (const side of ['left', 'right'] as const) {
      if (!contact[side][f] || !contact[side][g]) continue;
      const foot = feet[side], P = foot.points;
      for (let i = 0; i < P.length; i += 3) {
        const a = move(Ts[f]!, foot.seg, P[i]!, P[i + 1]!, P[i + 2]!), b = move(Ts[g]!, foot.seg, P[i]!, P[i + 1]!, P[i + 2]!);
        if (a[up] - ground > tol || b[up] - ground > tol) continue;
        sx -= b[across[0]] - a[across[0]]; sy -= b[across[1]] - a[across[1]]; k++;
      }
    }
    step.push(k ? [sx / k, sy / k] : null);
  }
  if (step.every((s) => !s)) throw new RangeError('gait-contact: no sole point stays on the ground');
  for (let f = 0; f < n; f++) {
    if (step[f]) continue;
    let a = f, b = f;
    while (!step[((a % n) + n) % n]) a--;
    while (!step[b % n]) b++;
    const sa = step[((a % n) + n) % n]!, sb = step[b % n]!;
    step[f] = [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2];
  }
  const total = step.reduce<[number, number]>((s, d) => [s[0] + d![0], s[1] + d![1]], [0, 0]);
  const T = n * frameTime, velocity: V3 = [0, 0, 0];
  velocity[across[0]] = total[0] / T; velocity[across[1]] = total[1] / T;
  const offsets: V3[] = [];
  let at: [number, number] = [0, 0];
  for (let f = 0; f < n; f++) {
    const o: V3 = [0, 0, 0], t = f * frameTime;
    o[across[0]] = at[0] - velocity[across[0]] * t; o[across[1]] = at[1] - velocity[across[1]] * t; o[up] = rise[f]!;
    offsets.push(o);
    at = [at[0] + step[f]![0], at[1] + step[f]![1]];
  }
  return { offsets, velocity };
}

/**
 * How far a grounded foot slides over a cycle: the rig posed with its root
 * offsets, the body carried along `velocity` (the rig's units a second), a
 * sole point grounded while its foot is in contact and it lies within `tol`
 * of the ground. For each run of grounded frames the point's move across
 * the ground (not along `up`); the largest, per foot. The cycle repeats, so
 * a run may wrap past its end.
 */
export function footSlip(
  rig: Rig, poses: readonly Pose[], roots: readonly V3[], feet: { left: Foot; right: Foot }, contact: GaitContact,
  frameTime: number, velocity: V3, up: 0 | 1 | 2, ground: number, tol: number,
): { left: number; right: number } {
  const n = poses.length, Ts = poses.map((p, f) => segmentTransforms(rig, p, roots[f]!));
  const out = { left: 0, right: 0 };
  for (const side of ['left', 'right'] as const) {
    const foot = feet[side], P = foot.points, m = P.length / 3;
    // each point's place across the ground per frame, over two cycles
    const at = (i: number, f: number): V3 | null => {
      const k = f % n, p = move(Ts[k]!, foot.seg, P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!), t = f * frameTime;
      if (!contact[side][k] || p[up] - ground > tol) return null;
      return [p[0] + velocity[0] * t, p[1] + velocity[1] * t, p[2] + velocity[2] * t];
    };
    for (let i = 0; i < m; i++) {
      let start: V3 | null = null;
      // start where the point is not grounded, so every run is seen whole
      let f0 = 0;
      while (f0 < n && at(i, f0)) f0++;
      if (f0 === n) f0 = 0;
      for (let f = f0; f <= f0 + n; f++) {
        const p = at(i, f);
        if (p && !start) start = p;
        if (start && (!p || f === f0 + n)) {
          const end = p ?? at(i, f - 1)!;
          const d = [0, 1, 2].filter((k) => k !== up).map((k) => end[k]! - start![k]!);
          out[side] = Math.max(out[side], Math.hypot(d[0]!, d[1]!));
          start = null;
        }
      }
    }
  }
  return out;
}

/** A muscle's two ends: where it is attached on two segments (the groups of
 *  its H5 attachment vertices farthest apart at rest), each's centre. */
export interface MuscleEnds { element: string; a: { seg: number; centre: V3 }; b: { seg: number; centre: V3 }; restMm: number }

/** Attachment groups smaller than this are not an end. */
const END_MIN_VERTICES = 3;

/** A muscle's ends from its weights; null when it is attached to one
 *  segment only (then no pose changes its length). */
export function muscleEnds(element: string, positions: ArrayLike<number>, w: SkinWeights): MuscleEnds | null {
  const groups = new Map<number, [number, number, number, number]>();
  for (let v = 0; v < w.seg.length / 3; v++) {
    if (w.seg[v * 3 + 1] !== NO_SEG) continue;
    const s = w.seg[v * 3]!, g = groups.get(s) ?? [0, 0, 0, 0];
    g[0] += positions[v * 3]!; g[1] += positions[v * 3 + 1]!; g[2] += positions[v * 3 + 2]!; g[3]++;
    groups.set(s, g);
  }
  const ends = [...groups].filter(([, g]) => g[3] >= END_MIN_VERTICES).map(([seg, g]) => ({ seg, centre: [g[0] / g[3], g[1] / g[3], g[2] / g[3]] as V3 }));
  let best: MuscleEnds | null = null;
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i]!, b = ends[j]!, d = Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1], a.centre[2] - b.centre[2]);
      if (!best || d > best.restMm) best = a.seg < b.seg ? { element, a, b, restMm: d } : { element, a: b, b: a, restMm: d };
    }
  }
  return best;
}

/** A muscle's length (its ends' distance) under segment transforms T. */
export function muscleLength(m: MuscleEnds, T: Float64Array): number {
  const a = move(T, m.a.seg, ...m.a.centre), b = move(T, m.b.seg, ...m.b.centre);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * A muscle's colour by how far it is stretched: `base` at its rest length,
 * toward `short` as it shortens and `long` as it lengthens, fully at a
 * change of `span` (a fraction of its rest length).
 */
export function stretchColor(
  ratio: number, base: readonly [number, number, number], short: readonly [number, number, number], long: readonly [number, number, number], span: number,
): [number, number, number] {
  if (!(span > 0) || !Number.isFinite(ratio)) throw new RangeError(`gait-stretch: ratio ${ratio}, span ${span}`);
  const t = Math.max(-1, Math.min(1, (ratio - 1) / span)), to = t < 0 ? short : long, u = Math.abs(t);
  return [0, 1, 2].map((k) => Math.round(base[k]! + (to[k]! - base[k]!) * u)) as [number, number, number];
}
