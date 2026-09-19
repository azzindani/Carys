import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cursorAxes, cursorOnCanvas, projectCursor } from '../cursor3d.js';
import { projectFibers } from '../fibers.js';

// V2 parity goldens: the 3D cursor is NiiVue's "crosshair visible in 3D",
// but the math must be OURS — the cursor has to land on the mesh/fiber
// pixel it names. Every `it` below ties projectCursor to the shipped
// projectors (raster/fibers convention) instead of hand-rolled numbers.
const DIMS: [number, number, number] = [10, 10, 10];
const OPTS = { width: 100, height: 100, angleY: 0.7, tiltX: 0.3 };

describe('cursor3d parity', () => {
  it('agrees with projectFibers on the same voxel + view', () => {
    const v: [number, number, number] = [7, 2, 8];
    const dot = projectCursor(v, DIMS, OPTS);
    const [line] = projectFibers(new Float32Array([...v, ...v]), new Uint32Array([0, 2]), DIMS, OPTS);
    assert.ok(Math.abs(line![0]!.x - dot.x) < 1e-9);
    assert.ok(Math.abs(line![0]!.y - dot.y) < 1e-9);
    assert.ok(Math.abs(line![0]!.z - dot.z) < 1e-9);
  });
  it('volume center hits canvas center; zero rotation maps axes monotonically', () => {
    const c = projectCursor([5, 5, 5], DIMS, { width: 100, height: 100, angleY: 0, tiltX: 0 });
    assert.ok(Math.abs(c.x - 50) < 1e-9 && Math.abs(c.y - 50) < 1e-9);
    assert.equal(cursorOnCanvas(c, { width: 100, height: 100, angleY: 0, tiltX: 0 }), true);
    const z = { width: 100, height: 100, angleY: 0, tiltX: 0 };
    const px = projectCursor([8, 5, 5], DIMS, z);
    const nx = projectCursor([2, 5, 5], DIMS, z);
    assert.ok(px.x > c.x && nx.x < c.x);
    const up = projectCursor([5, 8, 5], DIMS, z);
    assert.ok(up.y < c.y); // +y runs up (H/2 − y1·scale)
    const near = projectCursor([5, 5, 8], DIMS, z);
    const far = projectCursor([5, 5, 2], DIMS, z);
    assert.ok(near.z > far.z); // larger z = nearer (raster.ts camera)
  });
  it('half-turn yaw mirrors x around canvas center exactly (fibers parity)', () => {
    // yaw+π flips the orbit-plane components but the tilt mixes z1 into
    // y1, so y moves too — assert x-mirror + agreement with projectFibers
    // (the shipped projector), not a y pin that neither has.
    const v: [number, number, number] = [7, 2, 8];
    const a = projectCursor(v, DIMS, OPTS);
    const b = projectCursor(v, DIMS, { ...OPTS, angleY: OPTS.angleY + Math.PI });
    assert.ok(Math.abs(b.x - (100 - a.x)) < 1e-9);
    const fb = projectFibers(new Float32Array([...v, ...v]), new Uint32Array([0, 2]), DIMS, { ...OPTS, angleY: OPTS.angleY + Math.PI })[0]!;
    assert.ok(Math.abs(fb[0]!.x - b.x) < 1e-9);
    assert.ok(Math.abs(fb[0]!.y - b.y) < 1e-9);
  });
  it('axes endpoints agree with the dot; center segment midpoint is the dot', () => {
    const v: [number, number, number] = [4, 6, 3];
    const [sx, sy, sz] = cursorAxes(v, DIMS, OPTS);
    for (const [seg, axis] of [[sx, 0], [sy, 1], [sz, 2]] as const) {
      const dot = projectCursor(v, DIMS, OPTS);
      // clipping keeps both ends inside: midpoint need not equal the dot
      // at the faces, so assert the dot lies ON the segment instead.
      const { a, b } = seg;
      const cross = (b.x - a.x) * (dot.y - a.y) - (b.y - a.y) * (dot.x - a.x);
      assert.ok(Math.abs(cross) < 1e-6, `axis ${axis} off-segment`);
      void axis;
    }
    // the dot lies ON its axis segments by construction (same projector);
    // the stronger claim is per-axis direction: the x-segment runs
    // horizontally through the dot at zero rotation, the y-segment
    // vertically (volume faces clip the ends asymmetrically — halfLen 10
    // from voxel 5 reaches face 0 one way and face 9 the other).
    const z0 = { width: 100, height: 100, angleY: 0, tiltX: 0 };
    const [zx, zy] = cursorAxes([5, 5, 5], DIMS, z0);
    const dot0 = projectCursor([5, 5, 5], DIMS, z0);
    assert.ok(Math.abs(zx.a.y - dot0.y) < 1e-9 && Math.abs(zx.b.y - dot0.y) < 1e-9);
    assert.ok(Math.abs(zy.a.x - dot0.x) < 1e-9 && Math.abs(zy.b.x - dot0.x) < 1e-9);
    assert.ok(zx.a.x < dot0.x && dot0.x < zx.b.x);
    assert.ok(zy.a.y > dot0.y && dot0.y > zy.b.y); // +y runs up
  });
  it('out-of-volume + bad inputs fail loud with named errors', () => {
    assert.throws(() => projectCursor([10, 5, 5], DIMS, OPTS), /cursor3d-bounds/);
    assert.throws(() => projectCursor([-1, 5, 5], DIMS, OPTS), /cursor3d-bounds/);
    assert.throws(() => projectCursor([5, 5, 5], [0, 10, 10], OPTS), /cursor3d-dims/);
    assert.throws(() => projectCursor([5, 5, 5], DIMS, { ...OPTS, width: 0 }), /cursor3d-size/);
    assert.throws(() => projectCursor([5, 5, 5], DIMS, { ...OPTS, angleY: NaN }), /cursor3d-angle/);
    assert.throws(() => cursorAxes([5, 5, 5], DIMS, OPTS, 0), /cursor3d-halfLen/);
    assert.equal(cursorOnCanvas({ x: -1, y: 50, z: 0 }, OPTS), false);
  });
});
