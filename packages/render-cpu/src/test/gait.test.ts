import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { footSlip, groundRoot, muscleEnds, muscleLength, plantRoot, solePoints, stretchColor } from '../gait.js';
import { NO_SEG, segmentTransforms, type Pose, type Rig } from '../rig.js';

// H6 (docs/PHASES.md): a gait cycle on the rig.

/** Two legs (z up, facing −y): a thigh and a foot each, a hip at z 100
 *  (hinge at the knee dropped: the foot hangs from the hip). */
const RIG: Rig = {
  segments: ['pelvis', 'left leg', 'right leg'],
  joints: [
    { pose: 'left hip', share: 1, parent: 0, child: 1, centre: [50, 0, 100], dof: 3, axes: [[-1, 0, 0], [0, -1, 0], [0, 0, 1]] },
    { pose: 'right hip', share: 1, parent: 0, child: 2, centre: [-50, 0, 100], dof: 3, axes: [[-1, 0, 0], [0, 1, 0], [0, 0, -1]] },
  ],
};
/** A sole of four points under each hip, z 0 to 2. */
const sole = (x: number): Float64Array => Float64Array.from([x - 5, -10, 0, x + 5, -10, 0, x - 5, 10, 2, x + 5, 10, 2]);
const FEET = { left: { seg: 1, points: sole(50) }, right: { seg: 2, points: sole(-50) } };

describe('gait (H6)', () => {
  it('keeps the feet in contact on the ground, and arcs under gravity between', () => {
    const still: Pose[] = Array.from({ length: 10 }, () => ({}));
    const both = { left: new Array(10).fill(1), right: new Array(10).fill(1) };
    assert.deepEqual(groundRoot(RIG, still, FEET, both, 0.01, 2, 0, 9810), new Array(10).fill(0));
    // raise the ground by 3: the root rises 3
    assert.deepEqual(groundRoot(RIG, still, FEET, both, 0.01, 2, 3, 9810), new Array(10).fill(3));
    // flight over frames 3–6: the arc between the contacts either side
    const hop = { left: [1, 1, 1, 0, 0, 0, 0, 1, 1, 1], right: [1, 1, 1, 0, 0, 0, 0, 1, 1, 1] };
    const up = groundRoot(RIG, still, FEET, hop, 0.01, 2, 0, 9810);
    // from frame 2 to 7: t (0.01…0.04) of 0.05, rise ½·g·t·(0.05 − t)
    [3, 4, 5, 6].forEach((f) => { const t = (f - 2) * 0.01; assert.ok(Math.abs(up[f]! - 0.5 * 9810 * t * (0.05 - t)) < 1e-9, `frame ${f}: ${up[f]}`); });
    assert.throws(() => groundRoot(RIG, still, FEET, { left: new Array(10).fill(0), right: new Array(10).fill(0) }, 0.01, 2, 0, 9810), /gait-contact/);
  });

  it('measures a grounded foot\'s slide, and none for a planted one', () => {
    const still: Pose[] = Array.from({ length: 20 }, () => ({}));
    const roots = still.map(() => [0, 0, 0] as [number, number, number]);
    const halves = { left: Array.from({ length: 20 }, (_, f) => (f < 10 ? 1 : 0)), right: Array.from({ length: 20 }, (_, f) => (f >= 10 ? 1 : 0)) };
    // standing still, not carried: nothing slides
    assert.deepEqual(footSlip(RIG, still, roots, FEET, halves, 0.01, [0, 0, 0], 2, 0, 1), { left: 0, right: 0 });
    // carried forward at 1000 a second: a planted foot is dragged 9 frames × 0.01 s
    const s = footSlip(RIG, still, roots, FEET, halves, 0.01, [0, -1000, 0], 2, 0, 1);
    assert.ok(Math.abs(s.left - 90) < 1e-9 && Math.abs(s.right - 90) < 1e-9, JSON.stringify(s));
    // the root carried back as fast as the body moves on (a treadmill's belt): planted again
    const belt = still.map((_, f) => [0, 1000 * f * 0.01, 0] as [number, number, number]);
    const b = footSlip(RIG, still, belt, FEET, halves, 0.01, [0, -1000, 0], 2, 0, 1);
    assert.ok(b.left < 1e-9 && b.right < 1e-9, JSON.stringify(b));
  });

  it('moves the body on so a swinging-back stance foot stays planted', () => {
    // a loop of 20 frames: the left thigh swings from 0.2 rad forward to 0.2
    // back with its foot down (frames 0–10), then forward again in the air
    const poses: Pose[] = Array.from({ length: 20 }, (_, f) => ({ 'left hip': [f <= 10 ? 0.2 - 0.04 * f : -0.2 + 0.04 * (f - 10), 0, 0] }));
    const contact = { left: Array.from({ length: 20 }, (_, f) => (f <= 10 ? 1 : 0)), right: new Array(20).fill(0) };
    const rise = new Array(20).fill(0);
    const { offsets, velocity } = plantRoot(RIG, poses, rise, FEET, contact, 0.01, 2, -10, 50);
    // forward is −y: the body goes on as the foot goes back, 100·2·sin 0.2 mm in 0.1 s
    assert.ok(Math.abs(velocity[1] + (200 * Math.sin(0.2)) / 0.1) < 10 && velocity[0] === 0 && velocity[2] === 0, JSON.stringify(velocity));
    const still = footSlip(RIG, poses, offsets, FEET, contact, 0.01, velocity, 2, -10, 50);
    // the body kept still instead: the stance foot slides back its whole travel
    const dragged = footSlip(RIG, poses, rise.map(() => [0, 0, 0] as [number, number, number]), FEET, contact, 0.01, [0, 0, 0], 2, -10, 50);
    assert.ok(still.left < 1 && dragged.left > 30, `planted ${still.left}, not ${dragged.left}`);
    assert.throws(() => plantRoot(RIG, poses, rise, FEET, { left: new Array(20).fill(0), right: new Array(20).fill(0) }, 0.01, 2, -10, 50), /gait-contact/);
  });

  it('finds a muscle\'s two ends and its length as the joint turns', () => {
    // six vertices: three on the pelvis at z 110, three on the left leg at z 20, one free
    const P = Float32Array.from([40, 0, 110, 50, 0, 110, 60, 0, 110, 45, 0, 20, 50, 0, 20, 55, 0, 20, 50, 0, 60]);
    const seg = Uint8Array.from([0, NO_SEG, NO_SEG, 0, NO_SEG, NO_SEG, 0, NO_SEG, NO_SEG, 1, NO_SEG, NO_SEG, 1, NO_SEG, NO_SEG, 1, NO_SEG, NO_SEG, 0, 1, NO_SEG]);
    const w = Uint8Array.from([255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 128, 127]);
    const m = muscleEnds('FJ1', P, { seg, w })!;
    assert.deepEqual([m.a.seg, m.b.seg, m.a.centre, m.b.centre, m.restMm], [0, 1, [50, 0, 110], [50, 0, 20], 90]);
    assert.equal(muscleLength(m, segmentTransforms(RIG, {})), 90);
    // the hip flexed 90°: the end at z 20 swings forward to the hip's height, 80 ahead
    const bent = muscleLength(m, segmentTransforms(RIG, { 'left hip': [Math.PI / 2, 0, 0] }));
    assert.ok(Math.abs(bent - Math.hypot(80, 10)) < 1e-9, `${bent}`);
    // attached to one segment only: no ends
    assert.equal(muscleEnds('FJ2', P.subarray(0, 9), { seg: seg.subarray(0, 9), w: w.subarray(0, 6) }), null);
  });

  it('colours by stretch, and picks the sole', () => {
    const base = [200, 60, 60] as const, short = [60, 90, 220] as const, long = [250, 220, 60] as const;
    assert.deepEqual(stretchColor(1, base, short, long, 0.1), [200, 60, 60]);
    assert.deepEqual(stretchColor(0.8, base, short, long, 0.1), [60, 90, 220]);
    assert.deepEqual(stretchColor(1.05, base, short, long, 0.1), [225, 140, 60]);
    assert.throws(() => stretchColor(NaN, base, short, long, 0.1), /gait-stretch/);
    assert.deepEqual([...solePoints([Float64Array.from([0, 0, 5, 1, 1, 30, 2, 2, 12])], 2, 10)], [0, 0, 5, 2, 2, 12]);
  });
});
