// BVH motion (H6, docs/PHASES.md): read and write Biovision hierarchy files
// and turn a frame into the H5 rig's pose. Pure, no DOM.
//
// A BVH names a hierarchy of joints, each with an offset from its parent
// and channels (the root's position, every joint's rotations in its own
// order), then one line of channel values per frame. Rotations are degrees;
// a joint's rotation is the product of its channels' in the order listed
// (ZXY: R = Rz · Rx · Ry). Retargeting assumes the BVH's zero frame is the
// rig's rest (limbs down, the anatomical position; a T-pose file would need
// its arms' rest turned first) and its axes Y up, the body facing +Z, X to
// its left: the renderer's frame, so a rig in it (rigToScene) takes the
// rotations as they are.
import { POSE_DOF, POSE_JOINTS, type JointAngles, type Pose, type PoseJoint, type Rig } from './rig.js';

type V3 = [number, number, number];
export type BvhChannel = 'Xposition' | 'Yposition' | 'Zposition' | 'Xrotation' | 'Yrotation' | 'Zrotation';
const CHANNELS: readonly BvhChannel[] = ['Xposition', 'Yposition', 'Zposition', 'Xrotation', 'Yrotation', 'Zrotation'];

export interface BvhJoint {
  name: string;
  offset?: V3;
  channels: BvhChannel[];
  children: BvhJoint[];
  /** an end site's offset, for a joint with no children */
  end?: V3;
}

export interface Bvh {
  root: BvhJoint;
  /** seconds a frame */
  frameTime: number;
  /** per frame, every channel's value, joints depth first in file order */
  frames: number[][];
}

/** The joints depth first, each with where its channels start in a frame. */
export function bvhJoints(b: Bvh): { joint: BvhJoint; parent: string | null; at: number }[] {
  const out: { joint: BvhJoint; parent: string | null; at: number }[] = [];
  let at = 0;
  const walk = (j: BvhJoint, parent: string | null): void => {
    out.push({ joint: j, parent, at });
    at += j.channels.length;
    for (const c of j.children) walk(c, j.name);
  };
  walk(b.root, null);
  return out;
}

export function parseBvh(text: string): Bvh {
  const tok = text.split(/\s+/).filter(Boolean);
  let i = 0;
  const bad = (why: string): RangeError => new RangeError(`bvh-parse: ${why}`);
  const next = (): string => {
    if (i >= tok.length) throw bad('file ends early');
    return tok[i++]!;
  };
  const expect = (w: string): void => { const t = next(); if (t !== w) throw bad(`"${w}" expected, "${t}" found`); };
  const num = (): number => { const t = next(), v = Number(t); if (!Number.isFinite(v)) throw bad(`number expected, "${t}" found`); return v; };
  const names = new Set<string>();
  let channels = 0;
  const joint = (): BvhJoint => {
    const name = next();
    if (names.has(name)) throw bad(`joint "${name}" twice`);
    names.add(name);
    expect('{');
    expect('OFFSET');
    const offset: V3 = [num(), num(), num()];
    expect('CHANNELS');
    const n = num();
    if (!Number.isInteger(n) || n < 0 || n > 6) throw bad(`${name}: ${n} channels`);
    const ch: BvhChannel[] = [];
    for (let k = 0; k < n; k++) {
      const c = next() as BvhChannel;
      if (!CHANNELS.includes(c) || ch.includes(c)) throw bad(`${name}: channel "${c}"`);
      ch.push(c);
    }
    channels += n;
    const j: BvhJoint = { name, offset, channels: ch, children: [] };
    for (;;) {
      const t = next();
      if (t === '}') break;
      if (t === 'JOINT') j.children.push(joint());
      else if (t === 'End') { expect('Site'); expect('{'); expect('OFFSET'); j.end = [num(), num(), num()]; expect('}'); }
      else throw bad(`${name}: "${t}"`);
    }
    return j;
  };
  expect('HIERARCHY');
  expect('ROOT');
  const root = joint();
  expect('MOTION');
  expect('Frames:');
  const count = num();
  expect('Frame');
  expect('Time:');
  const frameTime = num();
  if (!Number.isInteger(count) || count < 1) throw bad(`${count} frames`);
  if (!(frameTime > 0)) throw bad(`frame time ${frameTime}`);
  const frames: number[][] = [];
  for (let f = 0; f < count; f++) frames.push(Array.from({ length: channels }, num));
  if (i !== tok.length) throw bad(`${tok.length - i} values past the last frame`);
  return { root, frameTime, frames };
}

export function writeBvh(b: Bvh): string {
  const out = ['HIERARCHY'];
  const n = (v: number): string => String(Math.round(v * 1e6) / 1e6);
  const walk = (j: BvhJoint, depth: number, root: boolean): void => {
    const pad = '  '.repeat(depth);
    out.push(`${pad}${root ? 'ROOT' : 'JOINT'} ${j.name}`, `${pad}{`);
    out.push(`${pad}  OFFSET ${(j.offset ?? [0, 0, 0]).map(n).join(' ')}`, `${pad}  CHANNELS ${j.channels.length} ${j.channels.join(' ')}`);
    for (const c of j.children) walk(c, depth + 1, false);
    if (!j.children.length) out.push(`${pad}  End Site`, `${pad}  {`, `${pad}    OFFSET ${(j.end ?? [0, 0, 0]).map(n).join(' ')}`, `${pad}  }`);
    out.push(`${pad}}`);
  };
  walk(b.root, 0, true);
  const width = bvhJoints(b).reduce((s, j) => s + j.joint.channels.length, 0);
  for (const f of b.frames) if (f.length !== width) throw new RangeError(`bvh-write: a frame of ${f.length} values, not ${width}`);
  out.push('MOTION', `Frames: ${b.frames.length}`, `Frame Time: ${n(b.frameTime)}`, ...b.frames.map((f) => f.map(n).join(' ')));
  return out.join('\n') + '\n';
}

// ---- retargeting ------------------------------------------------------------

/** BVH joint names (the common ones) and the pose joint each drives. */
export const BVH_TO_POSE: Readonly<Record<string, PoseJoint>> = {
  LeftUpLeg: 'left hip', LeftLeg: 'left knee', LeftFoot: 'left ankle',
  RightUpLeg: 'right hip', RightLeg: 'right knee', RightFoot: 'right ankle',
  LeftArm: 'left shoulder', LeftForeArm: 'left elbow', LeftHand: 'left wrist',
  RightArm: 'right shoulder', RightForeArm: 'right elbow', RightHand: 'right wrist',
  Spine: 'spine', Neck: 'neck',
};

const axisRot = (axis: 0 | 1 | 2, deg: number): number[] => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return axis === 0 ? [1, 0, 0, 0, c, -s, 0, s, c] : axis === 1 ? [c, 0, s, 0, 1, 0, -s, 0, c] : [c, -s, 0, s, c, 0, 0, 0, 1];
};
const mul3 = (A: readonly number[], B: readonly number[]): number[] => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => A[r * 3]! * B[c]! + A[r * 3 + 1]! * B[3 + c]! + A[r * 3 + 2]! * B[6 + c]!));

/** A joint's rotation in a frame: its rotation channels, in their order. */
function jointRotation(j: BvhJoint, values: readonly number[], at: number): number[] {
  let R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  j.channels.forEach((c, k) => {
    if (c.endsWith('rotation')) R = mul3(R, axisRot(c[0] === 'X' ? 0 : c[0] === 'Y' ? 1 : 2, values[at + k]!));
  });
  return R;
}

/**
 * A rotation as angles about three orthogonal unit axes, outermost first:
 * R = R(u1, a1) · R(u2, a2) · R(u3, a3), radians. The rig's order: abduction,
 * flexion, twist.
 */
export function anglesAbout(R: readonly number[], u1: V3, u2: V3, u3: V3): V3 {
  // in the basis (u1, u2, u3) the rotation is Rx · Ry · Rz; a left-handed
  // basis turns about −u3 instead
  const flip = u1[0] * (u2[1] * u3[2] - u2[2] * u3[1]) - u1[1] * (u2[0] * u3[2] - u2[2] * u3[0]) + u1[2] * (u2[0] * u3[1] - u2[1] * u3[0]) < 0 ? -1 : 1;
  const B = [u1, u2, [u3[0] * flip, u3[1] * flip, u3[2] * flip]];
  // R' = Bᵀ R B: R'[i][j] = b_i · R b_j
  const Rb = (j: number): number[] => [0, 1, 2].map((r) => R[r * 3]! * B[j]![0]! + R[r * 3 + 1]! * B[j]![1]! + R[r * 3 + 2]! * B[j]![2]!);
  const P = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => { const v = Rb(j); return B[i]![0]! * v[0]! + B[i]![1]! * v[1]! + B[i]![2]! * v[2]!; }));
  const b = Math.asin(Math.max(-1, Math.min(1, P[2]!)));
  const a = Math.atan2(-P[5]!, P[8]!), c = Math.atan2(-P[1]!, P[0]!);
  return [a, b, c * flip];
}

export interface RetargetedFrame {
  pose: Pose;
  /** the root's position, the file's units in the rig's frame */
  root: V3;
  /** per pose joint, the rotation it could not take (a knee's twist), radians */
  lost: Partial<Record<PoseJoint, number>>;
}

/**
 * One frame of a BVH as the rig's pose: each mapped joint's rotation split
 * into the rig joint's flexion, abduction and twist (its axes), those it
 * cannot take dropped and measured. `toRig` turns a BVH vector into the
 * rig's frame (identity for a rig in the renderer's frame).
 */
export function retargetFrame(b: Bvh, f: number, rig: Rig, toRig: (v: V3) => V3 = (v) => v, map: Readonly<Record<string, PoseJoint>> = BVH_TO_POSE): RetargetedFrame {
  const values = b.frames[f];
  if (!values) throw new RangeError(`bvh-frame: ${f} of ${b.frames.length}`);
  // the change of frame as a matrix, its columns the images of X, Y, Z
  const cols = [toRig([1, 0, 0]), toRig([0, 1, 0]), toRig([0, 0, 1])];
  const M = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => cols[c]![r]!));
  const Mt = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => M[c * 3 + r]!));
  const pose: Pose = {}, lost: Partial<Record<PoseJoint, number>> = {};
  let root: V3 = [0, 0, 0];
  for (const { joint, at } of bvhJoints(b)) {
    if (joint === b.root) {
      const p = (c: BvhChannel): number => { const k = joint.channels.indexOf(c); return k < 0 ? 0 : values[at + k]!; };
      root = toRig([p('Xposition'), p('Yposition'), p('Zposition')]);
    }
    const target = map[joint.name];
    if (!target) continue;
    if (!POSE_JOINTS.includes(target)) throw new RangeError(`bvh-map: ${joint.name} → ${target}`);
    const rj = rig.joints.find((k) => k.pose === target);
    if (!rj) throw new RangeError(`bvh-map: the rig has no ${target}`);
    const R = mul3(mul3(M, jointRotation(joint, values, at)), Mt);
    const [abd, flex, twist] = anglesAbout(R, rj.axes[1], rj.axes[0], rj.axes[2]);
    const dof = POSE_DOF[target];
    // the whole joint's angles: a spread joint (the spine) shares them out itself
    const a: JointAngles = [flex, dof >= 2 ? abd : 0, dof >= 3 ? twist : 0];
    pose[target] = a;
    const dropped = Math.hypot(dof < 2 ? abd : 0, dof < 3 ? twist : 0);
    if (dropped) lost[target] = dropped;
  }
  return { pose, root, lost };
}
