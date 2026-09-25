import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyFit, blendField, icpSimilarity, IDENTITY_FIT, PointTree } from '../organ-fit.js';
import { GRAD_MAX, icpWarp, spreadNodes, WARP_DEFAULTS, Warp, wendland } from '../organ-warp.js';

// The non-rigid rest of an anchor's fit.

/** A tube's surface along z (radius 20 mm, 300 mm long), samples about
 *  4 mm apart; the part below z = 0 turned by `bend` about the x axis
 *  there, as a knee flexes. */
function tube(bend: number): Float64Array {
  const out: number[] = [];
  for (let z = -150; z <= 150; z += 4) {
    for (let k = 0; k < 32; k++) {
      const a = (2 * Math.PI * k) / 32, x = 20 * Math.cos(a), y = 20 * Math.sin(a);
      if (z >= 0) out.push(x, y, z);
      else out.push(x, y * Math.cos(bend) - z * Math.sin(bend), y * Math.sin(bend) + z * Math.cos(bend));
    }
  }
  return Float64Array.from(out);
}

/** Mean distance between two sample sets, both ways. */
function gap(a: Float64Array, b: Float64Array): number {
  const one = (p: Float64Array, q: Float64Array): number => {
    const t = new PointTree(q);
    let s = 0;
    for (let i = 0; i < p.length; i += 3) s += Math.sqrt(t.nearest(p[i]!, p[i + 1]!, p[i + 2]!).d2);
    return s / (p.length / 3);
  };
  return (one(a, b) + one(b, a)) / 2;
}

/** One flexed-tube fit, shared: fitting one takes seconds. */
const STRAIGHT = tube(0), FLEXED = tube((25 * Math.PI) / 180);
let shared: { placed: Float64Array; warp: Warp; rigid: number } | null = null;
function flexFit(): { placed: Float64Array; warp: Warp; rigid: number } {
  if (!shared) {
    const fit = icpSimilarity([{ src: STRAIGHT, dst: FLEXED, both: true }], IDENTITY_FIT, 30);
    const placed = applyFit(fit, STRAIGHT);
    shared = { placed, warp: icpWarp(placed, FLEXED, true), rigid: gap(placed, FLEXED) };
  }
  return shared;
}

describe('organ warp (H3)', () => {
  it('uses Wendland\'s compact C² function', () => {
    assert.equal(wendland(0, 10), 1);
    assert.equal(wendland(10, 10), 0);
    assert.equal(wendland(25, 10), 0);
    assert.ok(Math.abs(wendland(5, 10) - 0.5 ** 4 * 3) < 1e-12);
    for (let r = 0; r < 10; r += 0.5) assert.ok(wendland(r + 0.5, 10) < wendland(r, 10));
  });

  it('bends a straight tube onto a flexed one that no similarity fits, folding nothing', () => {
    const { placed, warp, rigid } = flexFit();
    const after = gap(warp.apply(placed), FLEXED);
    // measured 5.99 → 1.80 mm: the defaults are the smooth, coarse bend H3 ships
    assert.ok(rigid > 5, `the best similarity is ${rigid.toFixed(2)} mm off`);
    assert.ok(after < rigid / 3 && after < 2, `bent: ${after.toFixed(2)} mm from ${rigid.toFixed(2)}`);
    assert.equal(warp.steps.length, WARP_DEFAULTS.radii.length * WARP_DEFAULTS.iterations);
    // every step's gradient is capped: the bend is one-to-one on the samples
    let least = Infinity;
    for (let i = 0; i < placed.length; i += 3) least = Math.min(least, warp.jacobianDet(placed[i]!, placed[i + 1]!, placed[i + 2]!));
    // at the samples each step keeps det ≥ (1 − GRAD_MAX)³, so the whole bend does to the power of its steps
    assert.ok(least > 0 && least >= (1 - GRAD_MAX) ** (3 * warp.steps.length), `min det ${least}`);
  });

  it('moves nothing past its radius from the organ, and nothing when the organ already fits', () => {
    const { warp } = flexFit(), src = STRAIGHT;
    const far = Float64Array.from([400, 0, 0, 0, 0, 500, -300, 300, -300]);
    assert.deepEqual(warp.apply(far), far);
    const still = icpWarp(src, src, true);
    const moved = still.apply(src);
    for (let i = 0; i < src.length; i++) assert.equal(moved[i], src[i]);
  });

  it('knows its Jacobian: the determinant matches finite differences', () => {
    const { warp } = flexFit(), h = 1e-3;
    for (const p of [[20, 0, -40], [0, -20, -10], [14, 14, 60]] as const) {
      const J: number[] = [];
      for (let b = 0; b < 3; b++) {
        const lo = [...p], hi = [...p];
        lo[b]! -= h; hi[b]! += h;
        const [a0, a1] = [warp.apply(Float64Array.from(lo)), warp.apply(Float64Array.from(hi))];
        for (let a = 0; a < 3; a++) J[a * 3 + b] = (a1[a]! - a0[a]!) / (2 * h);
      }
      const det = J[0]! * (J[4]! * J[8]! - J[5]! * J[7]!) - J[1]! * (J[3]! * J[8]! - J[5]! * J[6]!) + J[2]! * (J[3]! * J[7]! - J[4]! * J[6]!);
      const got = warp.jacobianDet(p[0], p[1], p[2]);
      assert.ok(Math.abs(got - det) < 1e-4 * Math.max(1, Math.abs(det)), `${p}: ${got} vs ${det}`);
      assert.ok(got > 0, `${p}: ${got}`);
    }
  });

  it('moves added points with the anchors\' bends in the blend field', () => {
    const { warp } = flexFit();
    const near = new PointTree(STRAIGHT), pts = Float64Array.from([20, 0, -60, 0, 20, -100]);
    const bentField = blendField([{ fit: IDENTITY_FIT, near, bend: warp }], pts);
    const direct = warp.apply(pts);
    for (let i = 0; i < pts.length; i++) assert.ok(Math.abs(bentField[i]! - direct[i]!) < 1e-9);
    // an anchor without a bend moves points by its similarity alone, as before
    const plain = blendField([{ fit: IDENTITY_FIT, near }], pts);
    for (let i = 0; i < pts.length; i++) assert.ok(Math.abs(plain[i]! - pts[i]!) < 1e-12);
  });

  it('spreads nodes one per cube, deterministically', () => {
    const s = tube(0), a = spreadNodes(s, 16), b = spreadNodes(s, 16);
    assert.deepEqual(a, b);
    assert.ok(a.length / 3 < s.length / 3 / 4 && a.length > 0);
    assert.ok(new Warp([]).apply(s).every((v, i) => v === s[i]));
  });
});
