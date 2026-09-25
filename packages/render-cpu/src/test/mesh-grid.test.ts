import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TriangleGrid } from '../mesh-grid.js';
import { uvSphere } from './phantoms.js';

// Whether a segment crosses a surface.

describe('triangle grid (H5)', () => {
  it('tells a segment that leaves a closed surface from one that stays inside', () => {
    const ball = uvSphere([0, 0, 0], 20, 24, 32), g = new TriangleGrid(ball, 6);
    assert.equal(g.crosses(-5, 0, 0, 5, 3, -2), false); // inside to inside
    assert.equal(g.crosses(0, 0, 0, 30, 1, 2), true); // inside to outside
    assert.equal(g.crosses(-30, 0, 0, 30, 0.5, 0.3), true); // through
    assert.equal(g.crosses(25, 25, 0, 30, 30, 0), false); // outside, beside it
    // from a point on the surface inward: its own triangle skipped
    const [x, y, z] = [ball.positions[300]!, ball.positions[301]!, ball.positions[302]!];
    assert.equal(g.crosses(x, y, z, 0, 0, 0, 0.5), false);
    assert.equal(g.crosses(x, y, z, -x * 2, -y * 2, -z * 2, 0.5), true); // on through the far side
  });

  it('agrees with testing every triangle, over many segments', () => {
    const ball = uvSphere([3, -2, 7], 15, 16, 24), g = new TriangleGrid(ball, 4), P = ball.positions, I = ball.indices;
    let s = 5;
    const rnd = (): number => { s = (s * 16807) % 2147483647; return (s / 2147483647) * 50 - 25; };
    for (let k = 0; k < 400; k++) {
      const a = [rnd(), rnd(), rnd()], b = [rnd(), rnd(), rnd()];
      let brute = false;
      const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!), d = b.map((v, i) => (v - a[i]!) / len);
      for (let t = 0; t < I.length && !brute; t += 3) {
        const p = [0, 1, 2].map((j) => [P[I[t + j]! * 3]!, P[I[t + j]! * 3 + 1]!, P[I[t + j]! * 3 + 2]!]);
        const e1 = [0, 1, 2].map((i) => p[1]![i]! - p[0]![i]!), e2 = [0, 1, 2].map((i) => p[2]![i]! - p[0]![i]!);
        const h = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!, d[0]! * e2[1]! - d[1]! * e2[0]!];
        const det = e1[0]! * h[0]! + e1[1]! * h[1]! + e1[2]! * h[2]!;
        if (Math.abs(det) < 1e-12) continue;
        const sv = [0, 1, 2].map((i) => a[i]! - p[0]![i]!), u = (sv[0]! * h[0]! + sv[1]! * h[1]! + sv[2]! * h[2]!) / det;
        if (u < 0 || u > 1) continue;
        const q = [sv[1]! * e1[2]! - sv[2]! * e1[1]!, sv[2]! * e1[0]! - sv[0]! * e1[2]!, sv[0]! * e1[1]! - sv[1]! * e1[0]!];
        const v = (d[0]! * q[0]! + d[1]! * q[1]! + d[2]! * q[2]!) / det;
        if (v < 0 || u + v > 1) continue;
        const tt = (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) / det;
        if (tt > 0 && tt < len) brute = true;
      }
      assert.equal(g.crosses(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!), brute, `segment ${k}`);
    }
    assert.throws(() => new TriangleGrid(ball, 0), /mesh-grid-cell/);
  });
});
