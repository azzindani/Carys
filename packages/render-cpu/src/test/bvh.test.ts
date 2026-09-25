import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { anglesAbout, parseBvh, retargetFrame, writeBvh, type Bvh } from '../bvh.js';
import type { Rig } from '../rig.js';

// BVH motion onto the rig.

type V3 = [number, number, number];

/** Legs in BodyParts3D's frame (x left, y back, z up), axes as the H5 rig. */
const LEGS: Rig = {
  segments: ['pelvis', 'left thigh', 'left shank'],
  joints: [
    { pose: 'left hip', share: 1, parent: 0, child: 1, centre: [87, -79, 811], dof: 3, axes: [[-1, 0, 0], [0, -1, 0], [0, 0, 1]] },
    { pose: 'left knee', share: 1, parent: 1, child: 2, centre: [72, -69, 389], dof: 1, axes: [[1, 0, 0], [0, -1, 0], [0, 0, 1]] },
  ],
};
/** BVH (X left, Y up, Z front) → BodyParts3D (x left, y back, z up). */
const toBp = (v: V3): V3 => [v[0], -v[2], v[1]];

const LEG_BVH = (hip: [number, number, number], knee: [number, number, number]): Bvh => ({
  root: {
    name: 'Hips', offset: [0, 0, 0], channels: ['Xposition', 'Yposition', 'Zposition', 'Zrotation', 'Xrotation', 'Yrotation'],
    children: [{
      name: 'LeftUpLeg', offset: [87, -10, 0], channels: ['Zrotation', 'Xrotation', 'Yrotation'],
      children: [{ name: 'LeftLeg', offset: [0, -420, 0], channels: ['Zrotation', 'Xrotation', 'Yrotation'], children: [], end: [0, -400, 0] }],
    }],
  },
  frameTime: 0.011, frames: [[1, 2, 3, 0, 0, 0, ...hip, ...knee]],
});

const rot = (u: V3, a: number): number[] => {
  const c = Math.cos(a), s = Math.sin(a), k = 1 - c, [x, y, z] = u;
  return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
};
const mul = (A: number[], B: number[]): number[] => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => A[r * 3]! * B[c]! + A[r * 3 + 1]! * B[3 + c]! + A[r * 3 + 2]! * B[6 + c]!));

describe('BVH (H6)', () => {
  it('reads what it writes, and fails loud on a broken file', () => {
    const b = LEG_BVH([5, -30, 0], [0, 60, 0]);
    const back = parseBvh(writeBvh(b));
    assert.deepEqual(back, b);
    const text = writeBvh(b);
    assert.throws(() => parseBvh(text.replace('CHANNELS 3', 'CHANNELS 7')), /bvh-parse: LeftUpLeg: 7 channels/);
    assert.throws(() => parseBvh(text.replace('CHANNELS 3 Zrotation Xrotation Yrotation', 'CHANNELS 3 Zrotation Qrotation Yrotation')), /bvh-parse: LeftUpLeg: channel "Qrotation"/);
    assert.throws(() => parseBvh(text.trimEnd().split(' ').slice(0, -1).join(' ')), /bvh-parse: file ends early/);
    assert.throws(() => parseBvh(`${text} 4`), /bvh-parse: 1 values past/);
    assert.throws(() => writeBvh({ ...b, frames: [[1, 2]] }), /bvh-write/);
  });

  it('splits a rotation into angles about any three orthogonal axes', () => {
    const sets: [V3, V3, V3][] = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, -1, 0], [-1, 0, 0], [0, 0, 1]], [[0, 1, 0], [-1, 0, 0], [0, 0, -1]]];
    for (const [u1, u2, u3] of sets) {
      const want: V3 = [0.3, -0.7, 1.1];
      const R = mul(mul(rot(u1, want[0]), rot(u2, want[1])), rot(u3, want[2]));
      const got = anglesAbout(R, u1, u2, u3);
      got.forEach((v, i) => assert.ok(Math.abs(v - want[i]!) < 1e-12, `${JSON.stringify([u1, u2, u3])}: ${got}`));
    }
  });

  it('retargets a leg: hip flexion and adduction, the knee\'s flexion, the root in the rig\'s frame', () => {
    // hip: 30° forward (−X in BVH), 10° out to the left (+Z); knee 60° back (+X) and 5° of twist it cannot take
    const f = retargetFrame(LEG_BVH([10, -30, 0], [0, 60, 5]), 0, LEGS, toBp);
    const d = (v: number): number => (v * 180) / Math.PI;
    assert.ok(Math.abs(d(f.pose['left hip']![0]) - 30) < 1e-9 && Math.abs(d(f.pose['left hip']![1]) - 10) < 1e-9, `hip ${f.pose['left hip']!.map(d)}`);
    assert.ok(Math.abs(d(f.pose['left knee']![0]) - 60) < 1e-9 && f.pose['left knee']![1] === 0, `knee ${f.pose['left knee']!.map(d)}`);
    assert.ok(Math.abs(d(f.lost['left knee']!) - 5) < 1e-9, `lost ${f.lost['left knee']}`);
    assert.equal(f.lost['left hip'], undefined);
    assert.deepEqual(f.root, [1, -3, 2]);
    assert.throws(() => retargetFrame(LEG_BVH([0, 0, 0], [0, 0, 0]), 1, LEGS), /bvh-frame/);
    assert.throws(() => retargetFrame(LEG_BVH([0, 0, 0], [0, 0, 0]), 0, LEGS, toBp, { LeftUpLeg: 'right hip' }), /the rig has no right hip/);
  });
});
