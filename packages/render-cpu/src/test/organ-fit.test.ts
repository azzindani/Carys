import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFit, blendField, fitScale, FIELD_SOFT_MM, holeCentre, icpSimilarity, IDENTITY_FIT, insideMesh, PointTree,
  similarityFit, surfaceSamples, type Similarity,
} from '../organ-fit.js';
import { uvSphere } from './phantoms.js';

// Placing the reference organs in the atlas body.

/** A deterministic spread of points. */
function cloud(n: number, seed = 1): Float64Array {
  let s = seed;
  const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return Float64Array.from({ length: n * 3 }, () => rnd() * 100 - 50);
}

/** scale · rotation about an axis by an angle, then a shift. */
function known(scale: number, axis: [number, number, number], angle: number, t: [number, number, number]): Similarity {
  const l = Math.hypot(...axis), [x, y, z] = axis.map((v) => v / l) as [number, number, number];
  const c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
  const R = [
    c + x * x * k, x * y * k - z * s, x * z * k + y * s,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k,
  ];
  return { m: R.map((v) => v * scale), t };
}

/** An ellipsoid mesh: no symmetry an ICP could settle on the wrong way. */
function ellipsoid(): { positions: Float32Array; indices: Uint32Array } {
  const m = uvSphere([0, 0, 0], 1, 24, 36);
  const P = Float32Array.from(m.positions, (v, i) => v * [40, 25, 15][i % 3]! + (i % 3 === 0 && v > 0 ? v * 8 : 0));
  return { positions: P, indices: m.indices };
}

describe('organ fit (H3)', () => {
  it('finds the similarity between paired points exactly', () => {
    const x = cloud(200), f = known(0.83, [1, 2, -0.5], 0.7, [12, -30, 800]);
    const g = similarityFit(x, applyFit(f, x));
    g.m.forEach((v, i) => assert.ok(Math.abs(v - f.m[i]!) < 1e-9, `m[${i}] ${v} vs ${f.m[i]}`));
    g.t.forEach((v, i) => assert.ok(Math.abs(v - f.t[i]!) < 1e-6));
    assert.ok(Math.abs(fitScale(g) - 0.83) < 1e-12);
    assert.throws(() => similarityFit([0, 0, 0], [0, 0, 0]), /organ-fit-pairs/);
  });

  it('spreads samples evenly over a surface', () => {
    // a 10 × 10 square as two triangles, samples 1 apart
    const sq = { positions: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0], indices: [0, 1, 2, 0, 2, 3] };
    const s = surfaceSamples(sq, 1);
    // area 50 over pieces of at most √3/4: n = ceil(10.75) = 11, 121 a triangle
    assert.equal(s.length / 3, 242);
    const mean = [0, 1, 2].map((k) => s.filter((_, i) => i % 3 === k).reduce((a, b) => a + b, 0) / 242);
    assert.ok(Math.abs(mean[0]! - 5) < 1e-9 && Math.abs(mean[1]! - 5) < 1e-9 && mean[2] === 0);
    // each quarter of the square holds a quarter of them
    const q = [...Array(242).keys()].filter((i) => s[i * 3]! < 5 && s[i * 3 + 1]! < 5).length;
    assert.ok(Math.abs(q - 60.5) < 6, `${q} in one quarter`);
    // a sliver (100 long, 0.01 high: area 0.5) gets points for its area, not its length
    assert.equal(surfaceSamples({ positions: [0, 0, 0, 100, 0, 0, 50, 0.01, 0], indices: [0, 1, 2] }, 1).length / 3, 4);
  });

  it('finds nearest points as a full search does, near the set and far from it', () => {
    const pts = cloud(2000, 7), tree = new PointTree(pts), qs = cloud(300, 11);
    for (let j = 0; j < 300; j++) {
      // every other query 400 mm off: the subtree boxes prune those
      const off = j % 2 ? 400 : 0;
      const [x, y, z] = [qs[j * 3]! + off, qs[j * 3 + 1]!, qs[j * 3 + 2]! - off / 2];
      let bd = Infinity;
      for (let i = 0; i < 2000; i++) bd = Math.min(bd, (pts[i * 3]! - x) ** 2 + (pts[i * 3 + 1]! - y) ** 2 + (pts[i * 3 + 2]! - z) ** 2);
      assert.equal(tree.nearest(x, y, z).d2, bd);
    }
  });

  it('recovers a similarity from surfaces alone (ICP), both ways or one', () => {
    const e = ellipsoid(), dst = surfaceSamples(e, 3.5);
    const f = known(1.2, [0.3, 1, 0.2], 0.25, [6, -4, 9]);
    // the source is the target moved back, sampled on its own triangles
    const inv = similarityFit(applyFit(f, dst), dst);
    const src = surfaceSamples({ positions: applyFit(inv, e.positions), indices: e.indices }, 4);
    for (const both of [true, false]) {
      const g = icpSimilarity([{ src, dst, both }], IDENTITY_FIT, 40);
      const moved = applyFit(g, src), back = new PointTree(dst);
      let worst = 0;
      for (let i = 0; i < moved.length / 3; i++) worst = Math.max(worst, Math.sqrt(back.nearest(moved[i * 3]!, moved[i * 3 + 1]!, moved[i * 3 + 2]!).d2));
      assert.ok(Math.abs(fitScale(g) - 1.2) < 0.01, `scale ${fitScale(g)}`);
      assert.ok(worst < 3.5, `worst ${worst} mm (both ${both})`);
    }
  });

  it('blends anchors by nearness: on one it moves as that one', () => {
    const a = { positions: [0, 0, 0, 10, 0, 0, 0, 10, 0], indices: [0, 1, 2] };
    const b = { positions: [200, 0, 0, 210, 0, 0, 200, 10, 0], indices: [0, 1, 2] };
    const up: Similarity = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 10] }, down: Similarity = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, -10] };
    const anchors = [
      { fit: up, near: new PointTree(surfaceSamples(a, 1)) },
      { fit: down, near: new PointTree(surfaceSamples(b, 1)) },
    ];
    const out = blendField(anchors, [3, 3, 0, 103, 3, 0, 203, 3, 0]);
    // on a: all but (soft²/d²)² of b's pull, d ≈ 200
    const leak = 20 * (FIELD_SOFT_MM ** 2 / 200 ** 2) ** 2;
    assert.ok(out[2]! > 10 - leak - 0.05 && out[2]! <= 10, `on a: ${out[2]}`);
    // between them, the weighted mix of +10 and −10
    const wa = 1 / (anchors[0]!.near.nearest(103, 3, 0).d2 + FIELD_SOFT_MM ** 2) ** 2, wb = 1 / (anchors[1]!.near.nearest(103, 3, 0).d2 + FIELD_SOFT_MM ** 2) ** 2;
    assert.ok(Math.abs(out[5]! - (10 * wa - 10 * wb) / (wa + wb)) < 1e-9 && Math.abs(out[5]!) < 1, `between: ${out[5]}`);
    assert.ok(Math.abs(out[3]! - 103) < 1e-9 && Math.abs(out[4]! - 3) < 1e-9, `moved across: ${out[3]}, ${out[4]}`);
    assert.ok(out[8]! < -10 + leak + 0.05, `on b: ${out[8]}`);
    assert.throws(() => blendField([], [0, 0, 0]), /organ-fit-field/);
  });

  it('tells inside a closed mesh from outside, a hole included', () => {
    // a hollow ball: a sphere with a smaller one cut out (two closed surfaces)
    const outer = uvSphere([0, 0, 0], 20, 24, 32), inner = uvSphere([0, 0, 0], 10, 24, 32);
    const flip = Uint32Array.from(inner.indices, (_, k) => inner.indices[k - (k % 3) + [0, 2, 1][k % 3]!]! + outer.positions.length / 3);
    const shell = { positions: Float32Array.from([...outer.positions, ...inner.positions]), indices: Uint32Array.from([...outer.indices, ...flip]) };
    assert.equal(insideMesh(shell, 15, 0, 0), true);   // in the wall
    assert.equal(insideMesh(shell, 0, 0, 0), false);   // in the hollow
    assert.equal(insideMesh(shell, 0, 25, 0), false);  // outside
    assert.equal(insideMesh(shell, 0, -3, 17.5), true);
  });

  it('finds the middle of a hole along a line', () => {
    // a ball of 20 with a hollow of 8 centred 3 off its middle, crossed front to back
    const outer = uvSphere([0, 0, 0], 20, 24, 32), inner = uvSphere([0, 3, 0], 8, 24, 32);
    const flip = Uint32Array.from(inner.indices, (_, k) => inner.indices[k - (k % 3) + [0, 2, 1][k % 3]!]! + outer.positions.length / 3);
    const shell = { positions: Float32Array.from([...outer.positions, ...inner.positions]), indices: Uint32Array.from([...outer.indices, ...flip]) };
    // three lines, at heights through the middle of the hollow, off it and over the ball
    const across = (z: number): [[number, number, number], [number, number, number]] => [[0, -30, z], [0, 30, z]];
    const hole = holeCentre(shell, [across(0), across(6), across(25)], 0.5);
    assert.ok(hole && Math.abs(hole.at[1] - 3) <= 0.5 && hole.at[0] === 0 && hole.at[2] === 0, `centre ${hole?.at}`);
    assert.ok(Math.abs(hole.clearance - 8) < 0.5, `clearance ${hole.clearance}`);
    // outside the ball there is surface one way only; a solid ball has no hole
    assert.equal(holeCentre(outer, [across(0)], 0.5), null);
    assert.throws(() => holeCentre(outer, [[[0, 0, 0], [0, 0, 0]]], 0.5), /organ-fit-hole/);
  });
});

