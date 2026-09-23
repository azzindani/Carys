import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { needs } from '@carys/testkit';
import { sincCoefficients, smoothMesh } from '../mesh-smooth.js';
import { maskNets } from '../surface-nets.js';
import type { TriMesh } from '../surface.js';
import { loadMask } from './goldens.js';
import { sampleMask, sphere } from './phantoms.js';

/** Filter gain at an umbrella-operator eigenvalue k ∈ [0, 2]. */
const gain = (c: Float64Array, k: number): number => {
  const th = Math.acos(1 - k / 2);
  let g = 0;
  c.forEach((v, j) => { g += v * Math.cos(j * th); });
  return g;
};

const volume = (m: { positions: ArrayLike<number>; indices: ArrayLike<number> }): number => {
  const P = m.positions, I = m.indices;
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
    v += (P[a]! * (P[b + 1]! * P[c + 2]! - P[b + 2]! * P[c + 1]!) + P[a + 1]! * (P[b + 2]! * P[c]! - P[b]! * P[c + 2]!)
      + P[a + 2]! * (P[b]! * P[c + 1]! - P[b + 1]! * P[c]!)) / 6;
  }
  return v;
};

/** Mean angle (degrees) between the normals of triangles sharing an edge. */
function roughness(m: TriMesh): number {
  const I = m.indices, P = m.positions;
  const fn: [number, number, number][] = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
    const u = [P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!];
    const v = [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!, P[c + 2]! - P[a + 2]!];
    const n: [number, number, number] = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const l = Math.hypot(...n) || 1;
    fn.push([n[0] / l, n[1] / l, n[2] / l]);
  }
  const seen = new Map<number, number>();
  const nv = P.length / 3;
  let sum = 0, cnt = 0;
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[t + e]!, b = I[t + ((e + 1) % 3)]!;
      const key = a < b ? a * nv + b : b * nv + a;
      const other = seen.get(key);
      if (other === undefined) { seen.set(key, t / 3); continue; }
      const p = fn[other]!, q = fn[t / 3]!;
      sum += Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
      cnt++;
    }
  }
  return (sum / cnt) * (180 / Math.PI);
}

describe('windowed-sinc smoothing (F4)', () => {
  it('is a low-pass with unit gain below the pass band', () => {
    for (const s of [0.2, 0.5, 1]) {
      const pb = 10 ** (-4 * s);
      const c = sincCoefficients(20, pb);
      assert.ok(Math.abs(gain(c, 0) - 1) < 5e-3, `s${s}: DC gain ${gain(c, 0)}`);
      assert.ok(Math.abs(gain(c, pb) - 1) < 2e-3, `s${s}: pass-band gain ${gain(c, pb)}`);
      assert.ok(Math.abs(gain(c, 1)) < 5e-3, `s${s}: terrace-frequency gain ${gain(c, 1)}`);
    }
  });

  it('strength 0 is the mesh as extracted; bad input fails loud', () => {
    const m = maskNets(sampleMask(sphere([8, 8, 8], 5), [16, 16, 16], [1, 1, 1]), 16, 16, 16);
    assert.equal(smoothMesh(m, { strength: 0 }), m);
    assert.throws(() => smoothMesh(m, { strength: 1.5 }), /smooth-strength/);
    assert.throws(() => smoothMesh(m, { strength: Number.NaN }), /smooth-strength/);
    assert.throws(() => sincCoefficients(0, 0.1), /smooth-iterations/);
    assert.throws(() => sincCoefficients(20, 2), /smooth-passband/);
  });

  it('keeps each closed piece at its volume, and filtering alone would not', () => {
    const m = maskNets(sampleMask(sphere([8, 8, 8], 3), [16, 16, 16], [1, 1, 1]), 16, 16, 16);
    const v0 = volume(m);
    const kept = volume(smoothMesh(m, { strength: 0.7 }));
    const raw = volume(smoothMesh(m, { strength: 0.7, preserveVolume: false }));
    assert.ok(Math.abs(kept - v0) / v0 < 1e-3, `restored: ${v0.toFixed(2)} → ${kept.toFixed(2)}`);
    assert.ok(raw < v0 * 0.99, `unrestored filtering shrinks a small sphere: ${v0.toFixed(2)} → ${raw.toFixed(2)}`);
  });

  it('leaves slivers and open pieces alone instead of blowing them up', () => {
    // a closed sphere plus a zero-volume sliver (a triangle and its reverse)
    // and an open fan: nothing may leave the neighbourhood of the input
    const s = maskNets(sampleMask(sphere([8, 8, 8], 4), [16, 16, 16], [1, 1, 1]), 16, 16, 16);
    const nv = s.positions.length / 3;
    const positions = Float32Array.from([...s.positions, 1, 1, 1, 2, 1, 1, 1, 2, 1, 10, 10, 1, 11, 10, 1, 10, 11, 1, 11, 11, 1.5]);
    const indices = Uint32Array.from([
      ...s.indices,
      nv, nv + 1, nv + 2, nv, nv + 2, nv + 1, // sliver: closed, encloses nothing
      nv + 3, nv + 4, nv + 5, nv + 4, nv + 6, nv + 5, // open patch
    ]);
    const out = smoothMesh({ positions, normals: new Float32Array(positions.length), indices }, { strength: 0.8 });
    for (let i = 0; i < out.positions.length; i++) {
      assert.ok(Number.isFinite(out.positions[i]!) && out.positions[i]! > -2 && out.positions[i]! < 18, `vertex ${Math.floor(i / 3)} ran off`);
    }
    assert.ok(Math.abs(volume(out) - volume(s)) / volume(s) < 2e-3, 'the sphere keeps its volume beside them');
  });

  it('BraTS tumour: terraces filtered, volume kept', needs('brain_tumor_BraTS19_CBICA_AQN_1_seg.nii'), () => {
    // The segmentation steps up to 23 voxels between columns (F3); strength
    // 0.5 took its roughness from 19.7° to 13.5° with the volume unchanged.
    const { dims, mask } = loadMask(join(process.cwd(), 'samples/brain_tumor_BraTS19_CBICA_AQN_1_seg.nii'));
    const m = maskNets(mask, dims[0], dims[1], dims[2]);
    const sm = smoothMesh(m, { strength: 0.5 });
    const r0 = roughness(m), r1 = roughness(sm);
    assert.ok(r1 < r0 * 0.75, `roughness ${r0.toFixed(1)}° → ${r1.toFixed(1)}°`);
    assert.ok(Math.abs(volume(sm) - volume(m)) / volume(m) < 1e-3, `volume ${volume(m).toFixed(0)} → ${volume(sm).toFixed(0)}`);
  });
});
