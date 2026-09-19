import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitPointsToBox, projectFibers } from '../fibers.js';

const DIMS: [number, number, number] = [10, 10, 10];
const OPTS = { width: 100, height: 100, angleY: 0, tiltX: 0 };

describe('fibers', () => {
  it('fitPointsToBox centers + scales into the viewBox', () => {
    const fitted = fitPointsToBox(new Float32Array([0, 0, 0, 10, 0, 0]), DIMS);
    // span 10 -> target 7: x maps 0..10 onto 1.5..8.5, y/z center on 5
    assert.deepEqual([...fitted], [1.5, 5, 5, 8.5, 5, 5]);
    assert.throws(() => fitPointsToBox(new Float32Array(0), DIMS), /bounding box/);
  });
  it('zero rotation maps axes to screen axes monotonically', () => {
    const pts = new Float32Array([2, 5, 5, 8, 5, 5]);
    const [line] = projectFibers(pts, new Uint32Array([0, 2]), DIMS, OPTS);
    assert.equal(line!.length, 2);
    assert.ok(line![1]!.x > line![0]!.x); // +x runs right
    assert.ok(Math.abs(line![1]!.y - line![0]!.y) < 1e-9); // constant y
    assert.ok(Math.abs(line![1]!.z - line![0]!.z) < 1e-9); // constant depth
  });
  it('half-turn yaw mirrors x exactly, empty streamlines give []', () => {
    const pts = new Float32Array([2, 5, 5, 8, 5, 5]);
    const off = new Uint32Array([0, 0, 2]);
    const [empty, line] = projectFibers(pts, off, DIMS, OPTS);
    assert.deepEqual(empty, []);
    assert.equal(line!.length, 2);
    const turned = projectFibers(pts, new Uint32Array([0, 2]), DIMS, { ...OPTS, angleY: Math.PI })[0]!;
    for (let k = 0; k < 2; k++) {
      assert.ok(Math.abs(turned[k]!.x - (100 - line![k]!.x)) < 1e-9, `point ${k}`);
      assert.ok(Math.abs(turned[k]!.y - line![k]!.y) < 1e-9, `point ${k}`);
    }
  });
  it('nearer points carry larger depth', () => {
    const pts = new Float32Array([5, 5, 2, 5, 5, 8]);
    const [line] = projectFibers(pts, new Uint32Array([0, 2]), DIMS, OPTS);
    assert.ok(line![1]!.z > line![0]!.z);
  });
});
