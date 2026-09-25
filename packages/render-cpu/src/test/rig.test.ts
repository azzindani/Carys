import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fitCircle, fitSphere, NO_SEG, packWeights, poseMesh, rigToScene, segmentTransforms, unpackWeights,
  type Rig, type SkinWeights,
} from '../rig.js';
import { uvSphere } from './phantoms.js';

// A rigged skeleton.

type V3 = [number, number, number];

/** A leg: the root (pelvis), a thigh hanging from a hip at z 100, a shank
 *  from a knee at z 50 (BodyParts3D's frame: x to the left, y back, z up). */
const LEG: Rig = {
  segments: ['pelvis', 'thigh', 'shank'],
  joints: [
    { pose: 'left hip', share: 1, parent: 0, child: 1, centre: [0, 0, 100], dof: 3, axes: [[-1, 0, 0], [0, -1, 0], [0, 0, 1]] },
    { pose: 'left knee', share: 1, parent: 1, child: 2, centre: [0, 0, 50], dof: 1, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  ],
};

const apply = (T: Float64Array, s: number, p: V3): V3 => {
  const o = s * 12;
  return [0, 1, 2].map((r) => T[o + r * 3]! * p[0] + T[o + r * 3 + 1]! * p[1] + T[o + r * 3 + 2]! * p[2] + T[o + 9 + r]!) as V3;
};
const near = (a: readonly number[], b: readonly number[], tol: number): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

describe('rig (H5)', () => {
  it('fits a sphere to part of one, and a hinge\'s circle seen along its axis', () => {
    // a cap: the points within 60° of one pole of a sphere of 23 at (87, −79, 811)
    const s = uvSphere([87, -79, 811], 23, 24, 32), cap: number[] = [];
    for (let i = 0; i < s.positions.length; i += 3) if (s.positions[i + 2]! - 811 > 23 * 0.5) cap.push(s.positions[i]!, s.positions[i + 1]!, s.positions[i + 2]!);
    const f = fitSphere(cap);
    assert.ok(near(f.centre, [87, -79, 811], 1e-3) && Math.abs(f.radius - 23) < 1e-3 && f.rms < 1e-3, JSON.stringify(f));
    // a quarter cylinder along x (radius 15 about y −70, z 1040), x from 190 to 220
    const arc: number[] = [];
    for (let x = 190; x <= 220; x += 5) for (let a = 0; a <= Math.PI / 2; a += 0.1) arc.push(x, -70 + 15 * Math.cos(a), 1040 - 15 * Math.sin(a));
    const c = fitCircle(arc, 0);
    assert.ok(near(c.centre, [205, -70, 1040], 1e-6) && Math.abs(c.radius - 15) < 1e-6, JSON.stringify(c));
    assert.throws(() => fitSphere([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]), /rig-fit/);
  });

  it('poses by joint angles: flexion bends forward, the knee backward, children follow', () => {
    const rest = segmentTransforms(LEG, {});
    assert.deepEqual([...rest], [...Array(3)].flatMap(() => [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]));
    // hip flexed 90°: the knee (50 below the hip) comes forward (−y) to the hip's height
    const T = segmentTransforms(LEG, { 'left hip': [Math.PI / 2, 0, 0] });
    assert.ok(near(apply(T, 1, [0, 0, 50]), [0, -50, 100], 1e-9), `${apply(T, 1, [0, 0, 50])}`);
    // and the shank with it, the ankle (z 0) 100 ahead
    assert.ok(near(apply(T, 2, [0, 0, 0]), [0, -100, 100], 1e-9));
    // knee flexed 90° alone: the ankle goes back (+y) level with the knee
    const K = segmentTransforms(LEG, { 'left knee': [Math.PI / 2, 0, 0] });
    assert.ok(near(apply(K, 2, [0, 0, 0]), [0, 50, 50], 1e-9), `${apply(K, 2, [0, 0, 0])}`);
    // abduction of the left leg: out to the left (+x)
    const A = segmentTransforms(LEG, { 'left hip': [0, Math.PI / 2, 0] });
    assert.ok(near(apply(A, 1, [0, 0, 50]), [50, 0, 100], 1e-9), `${apply(A, 1, [0, 0, 50])}`);
    assert.throws(() => segmentTransforms(LEG, { 'left knee': [0, 0.1, 0] }), /rig-pose: left knee moves in 1 way/);
    assert.throws(() => segmentTransforms(LEG, { 'left knee': [NaN, 0, 0] }), /rig-pose/);
    assert.throws(() => segmentTransforms(LEG, { ['left tail' as 'left knee']: [0, 0, 0] }), /rig-pose: no joint/);
    assert.throws(() => segmentTransforms({ ...LEG, joints: [LEG.joints[1]!, LEG.joints[0]!] }, {}), /rig-order/);
  });

  it('spreads a joint over several: shares add up to the whole angle', () => {
    const spine: Rig = {
      segments: ['pelvis', 'L5', 'trunk'],
      joints: [
        { pose: 'spine', share: 0.5, parent: 0, child: 1, centre: [0, 0, 0], dof: 3, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
        { pose: 'spine', share: 0.5, parent: 1, child: 2, centre: [0, 0, 30], dof: 3, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
      ],
    };
    const T = segmentTransforms(spine, { spine: [0.6, 0, 0] });
    // the trunk turned by the whole 0.6 rad
    assert.ok(near([T[24 + 4]!, T[24 + 5]!], [Math.cos(0.6), -Math.sin(0.6)], 1e-12));
  });

  it('keeps bones rigid under any pose, and a rest pose exactly where it was', () => {
    const bone = uvSphere([0, 0, 25], 6, 12, 16), P = bone.positions, N = bone.normals;
    // rest: the same arrays back
    const rest = poseMesh(P, N, segmentTransforms(LEG, {}), 2);
    assert.equal(rest.positions, P);
    let worst = 0;
    for (const pose of [{ 'left hip': [0.7, -0.3, 0.4], 'left knee': [1.9, 0, 0] }, { 'left hip': [-0.4, 1.1, -1.2], 'left knee': [0.2, 0, 0] }] as const) {
      const got = poseMesh(P, N, segmentTransforms(LEG, pose), 2).positions;
      for (let i = 0; i < P.length; i += 9) {
        for (let j = i + 3; j < P.length; j += 21) {
          const d0 = Math.hypot(P[i]! - P[j]!, P[i + 1]! - P[j + 1]!, P[i + 2]! - P[j + 2]!);
          worst = Math.max(worst, Math.abs(Math.hypot(got[i]! - got[j]!, got[i + 1]! - got[j + 1]!, got[i + 2]! - got[j + 2]!) - d0));
        }
      }
    }
    assert.ok(worst < 1e-4, `lengths change by ${worst} mm`);
  });

  it('blends a soft vertex by its weights; one on an unmoved segment stays put', () => {
    const P = Float32Array.from([0, 0, 50, 0, 0, 200]), N = Float32Array.from([0, 1, 0, 0, 1, 0]);
    // the first half thigh, half shank; the second all pelvis
    const w: SkinWeights = { seg: Uint8Array.from([1, 2, NO_SEG, 0, NO_SEG, NO_SEG]), w: Uint8Array.from([128, 127, 255, 0]) };
    const T = segmentTransforms(LEG, { 'left knee': [Math.PI / 2, 0, 0] });
    const got = poseMesh(P, N, T, w);
    // the knee centre is on the hinge: it does not move under either
    assert.ok(near([...got.positions.subarray(0, 3)], [0, 0, 50], 1e-4));
    assert.deepEqual([...got.positions.subarray(3)], [0, 0, 200]);
    // a normal half turned with the shank, then renormalized
    const n = [...got.normals.subarray(0, 3)];
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6 && n[1]! > 0.6 && n[2]! > 0.6, `${n}`);
    assert.throws(() => poseMesh(P, N, T, { seg: new Uint8Array(3), w: new Uint8Array(2) }), /rig-bind/);
    assert.throws(() => poseMesh(P, N, T, 7), /rig-bind/);
  });

  it('packs weights and reads them back, failing loud', () => {
    const a: SkinWeights = { seg: Uint8Array.from([3, 4, NO_SEG, 5, NO_SEG, NO_SEG]), w: Uint8Array.from([200, 55, 255, 0]) };
    const b: SkinWeights = { seg: Uint8Array.from([1, 2, 3]), w: Uint8Array.from([100, 100]) };
    const bytes = packWeights([{ element: 'FJ1', weights: a }, { element: 'FJ2', weights: b }]);
    const back = unpackWeights(bytes);
    assert.deepEqual([...back.get('FJ1')!.seg, ...back.get('FJ1')!.w, ...back.get('FJ2')!.seg, ...back.get('FJ2')!.w], [...a.seg, ...a.w, ...b.seg, ...b.w]);
    assert.throws(() => packWeights([{ element: 'X', weights: { seg: Uint8Array.from([1, 2, 3]), w: Uint8Array.from([200, 100]) } }]), /rig-weights-sum/);
    assert.throws(() => packWeights([{ element: 'X', weights: { seg: Uint8Array.from([1, NO_SEG, NO_SEG]), w: Uint8Array.from([100, 100]) } }]), /rig-weights-none/);
    assert.throws(() => unpackWeights(bytes.subarray(0, bytes.length - 1)), /rig-weights-truncated/);
    assert.throws(() => unpackWeights(Uint8Array.from([...bytes, 0])), /rig-weights-trailing/);
    assert.throws(() => unpackWeights(new Uint8Array(16)), /rig-weights-magic/);
  });

  it('moves to the renderer\'s frame: posing there is posing here, then moving', () => {
    const box = { min: [-100, -50, 0] as V3, max: [100, 50, 400] as V3 };
    const toScene = (p: V3): V3 => [p[0] - box.min[0], p[2] - box.min[2], box.max[1] - p[1]];
    const pose = { 'left hip': [0.5, 0.2, -0.3], 'left knee': [1.1, 0, 0] } as const;
    const here = apply(segmentTransforms(LEG, pose), 2, [3, -4, 20]);
    const there = apply(segmentTransforms(rigToScene(LEG, box), pose), 2, toScene([3, -4, 20]));
    assert.ok(near(there, toScene(here), 1e-9), `${there} vs ${toScene(here)}`);
  });
});
