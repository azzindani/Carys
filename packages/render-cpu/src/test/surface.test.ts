import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractBoundary, meshTriangleCount } from '../surface.js';

function sub(a: number[], b: number[]): number[] {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}
function cross(a: number[], b: number[]): number[] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}

/** Every triangle's geometric normal must equal its stored face normal. */
function assertWinding(m: ReturnType<typeof extractBoundary>): void {
  for (let t = 0; t < m.indices.length; t += 3) {
    const p = (i: number): number[] => {
      const v = m.indices[t + i]! * 3;
      return [m.positions[v]!, m.positions[v + 1]!, m.positions[v + 2]!];
    };
    const n = cross(sub(p(1), p(0)), sub(p(2), p(0)));
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    const stored = [m.normals[m.indices[t]! * 3], m.normals[m.indices[t]! * 3 + 1], m.normals[m.indices[t]! * 3 + 2]];
    assert.deepEqual(
      [n[0]! / len, n[1]! / len, n[2]! / len].map((v) => Math.round(v) + 0),
      stored.map((v) => v + 0),
    );
  }
}

describe('extractBoundary', () => {
  it('empty volume -> no triangles', () => {
    assert.equal(meshTriangleCount(extractBoundary(new Uint8Array(27), 3, 3, 3)), 0);
  });
  it('single voxel -> 12 triangles, correct winding', () => {
    const d = new Uint8Array(27);
    d[13] = 1;
    const m = extractBoundary(d, 3, 3, 3);
    assert.equal(meshTriangleCount(m), 12);
    assertWinding(m);
  });
  it('solid 2x2x2 -> 48 triangles, correct winding', () => {
    const m = extractBoundary(new Uint8Array(8).fill(1), 2, 2, 2);
    assert.equal(meshTriangleCount(m), 24 * 2);
    assertWinding(m);
  });
  it('adjacent pair shares interior face (12+12-4=20)', () => {
    const d = new Uint8Array(3);
    d[0] = 1; d[1] = 1;
    const m = extractBoundary(d, 3, 1, 1);
    assert.equal(meshTriangleCount(m), 20);
    assertWinding(m);
  });
  it('threshold excludes background', () => {
    const d = Uint8Array.from([0, 5, 0]);
    assert.equal(meshTriangleCount(extractBoundary(d, 3, 1, 1, 4)), 12);
    assert.equal(meshTriangleCount(extractBoundary(d, 3, 1, 1, 6)), 0);
  });
});
