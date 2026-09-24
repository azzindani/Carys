// A rigged skeleton (H5, docs/PHASES.md): segments of rigid bones joined at
// fitted centres, posed by joint angles, the rest of the body skinned to
// them. Pure, no DOM.
//
// Every joint's local frame is the rest pose's (the anatomical position,
// the frame the body digest is in): a pose rotates each segment about its
// joint's centre, in its parent's frame, then carries its children. A
// joint's angles are flexion, abduction and twist about three unit axes it
// carries, signed so positive is the anatomical flexion, abduction (for the
// spine and neck, the bend to the body's left) and external rotation (the
// turn to the left). The spine and the neck are each one pose joint spread
// over the disks of their vertebrae, a share each. Soft parts follow up to
// three segments, weighted per vertex (linear blend skinning).
import type { BodyBox } from './body-scene.js';

type V3 = [number, number, number];

/** The joints a pose sets. */
export const POSE_JOINTS = [
  'spine', 'neck', 'left shoulder', 'right shoulder', 'left elbow', 'right elbow', 'left wrist', 'right wrist',
  'left hip', 'right hip', 'left knee', 'right knee', 'left ankle', 'right ankle',
] as const;
export type PoseJoint = (typeof POSE_JOINTS)[number];
/** How each moves: 1 a hinge (flexion), 2 flexion and abduction (the wrist:
 *  radial deviation), 3 all three. */
export const POSE_DOF: Readonly<Record<PoseJoint, 1 | 2 | 3>> = {
  spine: 3, neck: 3, 'left shoulder': 3, 'right shoulder': 3, 'left elbow': 1, 'right elbow': 1, 'left wrist': 2, 'right wrist': 2,
  'left hip': 3, 'right hip': 3, 'left knee': 1, 'right knee': 1, 'left ankle': 1, 'right ankle': 1,
};
/** Radians: flexion, abduction, twist. */
export type JointAngles = readonly [number, number, number];
export type Pose = Partial<Record<PoseJoint, JointAngles>>;

export interface RigJoint {
  /** the pose joint whose angles it takes, times `share` */
  pose: PoseJoint;
  share: number;
  /** segment indices: the parent is posed before the child */
  parent: number;
  child: number;
  centre: V3;
  /** 1 a hinge (flexion only), 2 flexion and abduction, 3 all three */
  dof: 1 | 2 | 3;
  /** unit axes of flexion, abduction and twist */
  axes: [V3, V3, V3];
}

export interface Rig {
  /** segment 0 is the root; it never moves */
  segments: string[];
  /** parents before children, each segment but the root the child of one */
  joints: RigJoint[];
}

/** A soft part's weights: per vertex three segments (NO_SEG for none) and
 *  the first two weights of 255 (the third is the rest). A vertex attached
 *  to a bone (a muscle's end) has that bone's segment alone, the second
 *  NO_SEG; any other vertex names a second segment, if at weight 0. */
export interface SkinWeights {
  seg: Uint8Array;
  w: Uint8Array;
}
export const NO_SEG = 255;

export interface FitSphere {
  centre: V3;
  radius: number;
  /** root mean square distance of the points from the surface */
  rms: number;
  n: number;
}

// ---- fits -------------------------------------------------------------------

/** Gaussian elimination with partial pivoting; throws on a singular system. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]!]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i]![k]!) > Math.abs(M[p]![k]!)) p = i;
    [M[k], M[p]] = [M[p]!, M[k]!];
    if (Math.abs(M[k]![k]!) < 1e-12) throw new RangeError('rig-fit: the points do not fix a sphere');
    for (let i = k + 1; i < n; i++) {
      const f = M[i]![k]! / M[k]![k]!;
      for (let j = k; j <= n; j++) M[i]![j]! -= f * M[k]![j]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i]![n]!;
    for (let j = i + 1; j < n; j++) s -= M[i]![j]! * x[j]!;
    x[i] = s / M[i]![i]!;
  }
  return x;
}

/**
 * The sphere (or, projected along `along`, the circle) nearest the points:
 * an algebraic fit, then Gauss-Newton on the distances themselves. A circle's
 * centre takes the points' mean along the projected axis.
 */
function fitRound(P: ArrayLike<number>, along: 0 | 1 | 2 | null): FitSphere {
  const n = P.length / 3;
  const ks = along === null ? [0, 1, 2] : [0, 1, 2].filter((k) => k !== along);
  const m = ks.length;
  if (n < m + 2) throw new RangeError(`rig-fit: ${n} points`);
  const A = Array.from({ length: m + 1 }, () => new Array<number>(m + 1).fill(0)), b = new Array<number>(m + 1).fill(0);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const row = [...ks.map((k) => P[i * 3 + k]!), 1], rhs = -ks.reduce((s, k) => s + P[i * 3 + k]! ** 2, 0);
    if (along !== null) mean += P[i * 3 + along]!;
    for (let r = 0; r <= m; r++) { b[r]! += row[r]! * rhs; for (let c = 0; c <= m; c++) A[r]![c]! += row[r]! * row[c]!; }
  }
  const s = solve(A, b);
  const c = ks.map((_, j) => -s[j]! / 2);
  let r = Math.sqrt(c.reduce((a, v) => a + v * v, 0) - s[m]!);
  const dist = (i: number): number => Math.sqrt(ks.reduce((a, k, j) => a + (P[i * 3 + k]! - c[j]!) ** 2, 0));
  for (let it = 0; it < 50; it++) {
    const J = Array.from({ length: m + 1 }, () => new Array<number>(m + 1).fill(0)), g = new Array<number>(m + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const l = dist(i) || 1e-12, e = l - r;
      const row = [...ks.map((k, j) => -(P[i * 3 + k]! - c[j]!) / l), -1];
      for (let a = 0; a <= m; a++) { g[a]! -= row[a]! * e; for (let q = 0; q <= m; q++) J[a]![q]! += row[a]! * row[q]!; }
    }
    const dx = solve(J, g);
    for (let j = 0; j < m; j++) c[j]! += dx[j]!;
    r += dx[m]!;
    if (Math.hypot(...dx) < 1e-10) break;
  }
  if (!(r > 0) || !c.every(Number.isFinite)) throw new RangeError('rig-fit: no sphere fits the points');
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (dist(i) - r) ** 2;
  const centre: V3 = [0, 0, 0];
  ks.forEach((k, j) => { centre[k] = c[j]!; });
  if (along !== null) centre[along] = mean / n;
  return { centre, radius: r, rms: Math.sqrt(ss / n), n };
}

/** The sphere nearest the points (a femoral head, a talar dome). */
export const fitSphere = (points: ArrayLike<number>): FitSphere => fitRound(points, null);
/** The circle nearest the points seen along axis `along` (a hinge's
 *  articular profile, its axis along `along`). */
export const fitCircle = (points: ArrayLike<number>, along: 0 | 1 | 2): FitSphere => fitRound(points, along);

// ---- posing -----------------------------------------------------------------

/** Rotation by `a` about unit axis `u` (row-major 3×3). */
function rotation(u: V3, a: number): number[] {
  if (a === 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const c = Math.cos(a), s = Math.sin(a), k = 1 - c, [x, y, z] = u;
  return [
    c + x * x * k, x * y * k - z * s, x * z * k + y * s,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k,
  ];
}
const mul = (A: ArrayLike<number>, B: ArrayLike<number>): number[] => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => A[r * 3]! * B[c]! + A[r * 3 + 1]! * B[3 + c]! + A[r * 3 + 2]! * B[6 + c]!));

/**
 * Each segment's transform for a pose, 12 numbers a segment: a rotation
 * (row-major) then a shift, taking a rest-pose point where the pose puts
 * it. Throws on an angle a joint cannot take (a knee's abduction) and on a
 * rig whose joints are not parents first.
 */
export function segmentTransforms(rig: Rig, pose: Pose): Float64Array {
  const S = rig.segments.length, T = new Float64Array(S * 12), set = new Uint8Array(S);
  T.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 0);
  set[0] = 1;
  for (const [name, a] of Object.entries(pose) as [PoseJoint, JointAngles][]) {
    if (!POSE_JOINTS.includes(name)) throw new RangeError(`rig-pose: no joint "${name}"`);
    if (!a.every(Number.isFinite)) throw new RangeError(`rig-pose: ${name} ${a}`);
  }
  for (const j of rig.joints) {
    if (!set[j.parent] || set[j.child]) throw new RangeError(`rig-order: joint to ${rig.segments[j.child]}`);
    const [flex, abd, twist] = (pose[j.pose] ?? [0, 0, 0]).map((v) => v * j.share) as [number, number, number];
    if ((j.dof < 3 && twist !== 0) || (j.dof < 2 && abd !== 0)) throw new RangeError(`rig-pose: ${j.pose} moves in ${j.dof} way(s)`);
    const R = mul(mul(rotation(j.axes[1], abd), rotation(j.axes[0], flex)), rotation(j.axes[2], twist));
    const c = j.centre, p = j.parent * 12, P = T.subarray(p, p + 9), pt = T.subarray(p + 9, p + 12);
    // child = parent ∘ (about the centre: x ↦ R(x − c) + c)
    const m = mul(P, R);
    const local = [0, 1, 2].map((r) => c[r]! - (R[r * 3]! * c[0] + R[r * 3 + 1]! * c[1] + R[r * 3 + 2]! * c[2]));
    const t = [0, 1, 2].map((r) => P[r * 3]! * local[0]! + P[r * 3 + 1]! * local[1]! + P[r * 3 + 2]! * local[2]! + pt[r]!);
    T.set([...m, ...t], j.child * 12);
    set[j.child] = 1;
  }
  if (set.some((v) => !v)) throw new RangeError('rig-order: a segment no joint moves');
  return T;
}

const isIdentity = (T: Float64Array, s: number): boolean => {
  const o = s * 12;
  return T[o] === 1 && T[o + 4] === 1 && T[o + 8] === 1 && T[o + 1] === 0 && T[o + 2] === 0 && T[o + 3] === 0
    && T[o + 5] === 0 && T[o + 6] === 0 && T[o + 7] === 0 && T[o + 9] === 0 && T[o + 10] === 0 && T[o + 11] === 0;
};

/**
 * A part's vertices and normals posed: all with one segment (a bone, rigid)
 * or blended by its weights. An unmoved segment leaves its vertices as they
 * were, so a rest pose returns the same numbers.
 */
export function poseMesh(
  positions: Float32Array, normals: Float32Array, T: Float64Array, bind: number | SkinWeights,
): { positions: Float32Array; normals: Float32Array } {
  const n = positions.length / 3, S = T.length / 12;
  if (typeof bind === 'number') {
    if (!(bind >= 0 && bind < S)) throw new RangeError(`rig-bind: segment ${bind}`);
    if (isIdentity(T, bind)) return { positions, normals };
  } else if (bind.seg.length !== n * 3 || bind.w.length !== n * 2) {
    throw new RangeError(`rig-bind: weights for ${bind.seg.length / 3} vertices, not ${n}`);
  }
  const P = new Float32Array(positions.length), N = new Float32Array(normals.length);
  const one = [0, 0, 0], ws = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!;
    const a = normals[v * 3]!, b = normals[v * 3 + 1]!, c = normals[v * 3 + 2]!;
    let k = 1;
    if (typeof bind === 'number') { one[0] = bind; ws[0] = 1; } else {
      // in 255ths, so a third weight of none is exactly 0
      const w0 = bind.w[v * 2]!, w1 = bind.w[v * 2 + 1]!;
      one[0] = bind.seg[v * 3]!; one[1] = bind.seg[v * 3 + 1]!; one[2] = bind.seg[v * 3 + 2]!;
      ws[0] = w0 / 255; ws[1] = w1 / 255; ws[2] = Math.max(0, 255 - w0 - w1) / 255;
      k = 3;
    }
    let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0, still = 0;
    for (let i = 0; i < k; i++) {
      const s = one[i]!, w = ws[i]!;
      if (w === 0) continue;
      if (s >= S) throw new RangeError(`rig-bind: segment ${s}`);
      if (isIdentity(T, s)) still += w;
      const o = s * 12;
      px += w * (T[o]! * x + T[o + 1]! * y + T[o + 2]! * z + T[o + 9]!);
      py += w * (T[o + 3]! * x + T[o + 4]! * y + T[o + 5]! * z + T[o + 10]!);
      pz += w * (T[o + 6]! * x + T[o + 7]! * y + T[o + 8]! * z + T[o + 11]!);
      nx += w * (T[o]! * a + T[o + 1]! * b + T[o + 2]! * c);
      ny += w * (T[o + 3]! * a + T[o + 4]! * b + T[o + 5]! * c);
      nz += w * (T[o + 6]! * a + T[o + 7]! * b + T[o + 8]! * c);
    }
    if (still >= 1 - 1e-12) {
      P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
      N[v * 3] = a; N[v * 3 + 1] = b; N[v * 3 + 2] = c;
      continue;
    }
    const l = 1 / (Math.hypot(nx, ny, nz) || 1);
    P[v * 3] = px; P[v * 3 + 1] = py; P[v * 3 + 2] = pz;
    N[v * 3] = nx * l; N[v * 3 + 1] = ny * l; N[v * 3 + 2] = nz * l;
  }
  return { positions: P, normals: N };
}

// ---- the weights file ---------------------------------------------------------
//
// "carys-body-weights/1", little-endian: the magic "CBRW", a u32 version, a
// u32 header length, the header (UTF-8 JSON, space-padded to 4 bytes:
// the parts in their body file's order, element and vertex count), then
// per part its segments (3 a vertex) and first two weights (2 a vertex).

const WEIGHTS_MAGIC = 0x57524243; // "CBRW"
const WEIGHTS_VERSION = 1;

export function packWeights(parts: readonly { element: string; weights: SkinWeights }[]): Uint8Array {
  const rows = parts.map((p) => {
    const n = p.weights.seg.length / 3;
    if (!Number.isInteger(n) || p.weights.w.length !== n * 2) throw new RangeError(`rig-weights-part: ${p.element}`);
    for (let v = 0; v < n; v++) {
      const w0 = p.weights.w[v * 2]!, w1 = p.weights.w[v * 2 + 1]!;
      if (w0 + w1 > 255) throw new RangeError(`rig-weights-sum: ${p.element} vertex ${v}`);
      // a segment with weight must be one; none may carry weight
      if ((w0 > 0 && p.weights.seg[v * 3] === NO_SEG) || (w1 > 0 && p.weights.seg[v * 3 + 1] === NO_SEG) || (w0 + w1 < 255 && p.weights.seg[v * 3 + 2] === NO_SEG)) {
        throw new RangeError(`rig-weights-none: ${p.element} vertex ${v}`);
      }
    }
    return [p.element, n] as const;
  });
  let text = JSON.stringify({ format: 'carys-body-weights/1', parts: rows });
  while (text.length % 4) text += ' ';
  const head = new TextEncoder().encode(text);
  const body = parts.reduce((s, p) => s + p.weights.seg.length + p.weights.w.length, 0);
  const out = new Uint8Array(12 + head.length + body), dv = new DataView(out.buffer);
  dv.setUint32(0, WEIGHTS_MAGIC, true); dv.setUint32(4, WEIGHTS_VERSION, true); dv.setUint32(8, head.length, true);
  out.set(head, 12);
  let at = 12 + head.length;
  for (const p of parts) { out.set(p.weights.seg, at); at += p.weights.seg.length; out.set(p.weights.w, at); at += p.weights.w.length; }
  return out;
}

export function unpackWeights(src: ArrayBuffer | Uint8Array): Map<string, SkinWeights> {
  const bytes = src instanceof Uint8Array ? src : new Uint8Array(src);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || dv.getUint32(0, true) !== WEIGHTS_MAGIC) throw new RangeError('rig-weights-magic: not a carys-body-weights file');
  if (dv.getUint32(4, true) !== WEIGHTS_VERSION) throw new RangeError(`rig-weights-version: ${dv.getUint32(4, true)}`);
  const hl = dv.getUint32(8, true);
  if (12 + hl > bytes.length) throw new RangeError('rig-weights-truncated: header');
  let header: { format?: unknown; parts?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + hl))) as typeof header;
  } catch {
    throw new RangeError('rig-weights-header: not JSON');
  }
  if (header.format !== 'carys-body-weights/1' || !Array.isArray(header.parts)) throw new RangeError('rig-weights-header: not carys-body-weights/1');
  const out = new Map<string, SkinWeights>();
  let at = 12 + hl;
  for (const row of header.parts as unknown[]) {
    const [element, n] = row as [unknown, unknown];
    if (typeof element !== 'string' || !Number.isInteger(n) || (n as number) < 0 || out.has(element)) throw new RangeError(`rig-weights-header: part ${JSON.stringify(row)}`);
    const k = n as number;
    if (at + k * 5 > bytes.length) throw new RangeError(`rig-weights-truncated: ${element}`);
    out.set(element, { seg: bytes.slice(at, at + k * 3), w: bytes.slice(at + k * 3, at + k * 5) });
    at += k * 5;
  }
  if (at !== bytes.length) throw new RangeError(`rig-weights-trailing: ${bytes.length - at} bytes`);
  return out;
}

/**
 * The rig in the renderer's frame (body-scene toScenePart's map: (x, y, z)
 * → (x − min.x, z − min.z, max.y − y)), centres and axes alike.
 */
export function rigToScene(rig: Rig, box: BodyBox): Rig {
  const pt = (p: V3): V3 => [p[0] - box.min[0], p[2] - box.min[2], box.max[1] - p[1]];
  const ax = (u: V3): V3 => [u[0], u[2], -u[1]];
  return { segments: rig.segments, joints: rig.joints.map((j) => ({ ...j, centre: pt(j.centre), axes: [ax(j.axes[0]), ax(j.axes[1]), ax(j.axes[2])] })) };
}
