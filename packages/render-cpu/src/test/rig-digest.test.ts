import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackBody, type BodyPart } from '../body-pack.js';
import { PointTree, surfaceSamples } from '../organ-fit.js';
import {
  NO_SEG, POSE_DOF, POSE_JOINTS, poseMesh, segmentTransforms, unpackWeights, type Pose, type Rig, type SkinWeights,
} from '../rig.js';

// H5 (docs/PHASES.md): the body rig digest, as built by
// scripts/build-body-rig.mjs, against the body digests it was fitted to.

const DIGESTS = join(process.cwd(), 'digests');
interface Fit { centre: number[]; radiusMm: number; rmsMm: number }
interface RigFile extends Rig {
  format: string;
  bones: Record<string, number>;
  hipCheck: { side: string; femoralHead: Fit; acetabulum: Fit; apartMm: number }[];
  weights: { attachments: number; files: { digest: string; system: string; file: string; parts: number; vertices: number }[] };
}
const rig = JSON.parse(readFileSync(join(DIGESTS, 'body-rig', 'rig.json'), 'utf8')) as RigFile;

/** Every part of both body digests, by element, with its digest and system. */
const parts = new Map<string, { part: BodyPart; digest: string; system: string }>();
for (const d of ['bodyparts3d-body', 'hra-organs']) {
  const ix = JSON.parse(readFileSync(join(DIGESTS, d, 'index.json'), 'utf8')) as { systems: Record<string, { file: string }> };
  for (const [system, f] of Object.entries(ix.systems)) {
    for (const p of unpackBody(readFileSync(join(DIGESTS, d, f.file))).parts) parts.set(p.element, { part: p, digest: d, system });
  }
}
const weights = new Map<string, SkinWeights>();
for (const f of rig.weights.files) for (const [e, w] of unpackWeights(readFileSync(join(DIGESTS, 'body-rig', f.file)))) weights.set(e, w);

/** Every joint bent well away from rest, each within what it can do. */
const BENT: Pose = {
  spine: [0.5, 0.2, 0.3], neck: [0.4, -0.3, 0.5], 'left shoulder': [1.2, 0.8, 0.4], 'right shoulder': [-0.5, 1.4, -0.3],
  'left elbow': [1.8, 0, 0], 'right elbow': [0.9, 0, 0], 'left wrist': [0.6, 0.2, 0], 'right wrist': [-0.5, -0.1, 0],
  'left hip': [1.4, 0.3, 0.2], 'right hip': [-0.3, 0.2, -0.4], 'left knee': [1.9, 0, 0], 'right knee': [0.5, 0, 0],
  'left ankle': [0.3, 0, 0], 'right ankle': [-0.4, 0, 0],
};
const STEP: Pose = { 'left hip': [0.6, 0, 0], 'right hip': [-0.3, 0, 0], 'left knee': [0.3, 0, 0], 'right knee': [0.9, 0, 0], 'right shoulder': [0.5, 0, 0], 'left shoulder': [-0.4, 0, 0] };

describe('the body rig digest (H5)', () => {
  it('fits the joints from the bones: the hip centre within 5 mm of the acetabulum\'s own fit', () => {
    assert.equal(rig.format, 'carys-body-rig/1');
    assert.equal(rig.segments.length, 25);
    // one joint a segment, parents first, every pose joint moving as it may
    assert.doesNotThrow(() => segmentTransforms(rig, BENT));
    for (const j of POSE_JOINTS) assert.ok(rig.joints.some((k) => k.pose === j && k.dof === POSE_DOF[j]), j);
    for (const h of rig.hipCheck) {
      const hip = rig.joints.find((j) => j.pose === `${h.side} hip`)!;
      assert.deepEqual(hip.centre, h.femoralHead.centre);
      assert.ok(h.apartMm <= 5, `${h.side} hip ${h.apartMm} mm from the acetabulum's centre`);
      assert.ok(h.femoralHead.rmsMm < 1 && h.femoralHead.radiusMm > 18 && h.femoralHead.radiusMm < 30, JSON.stringify(h.femoralHead));
    }
  });

  it('names a segment for every bone and weights every other part, vertex for vertex', () => {
    let bones = 0;
    for (const [e, { part, digest, system }] of parts) {
      const seg = rig.bones[e], w = weights.get(e);
      assert.ok((seg === undefined) !== (w === undefined), `${part.name} (${e}): bone ${seg}, weights ${!!w}`);
      if (seg !== undefined) {
        assert.ok(digest === 'bodyparts3d-body' && system === 'skeletal' && seg > 0 || part.name === 'sacrum' || /hip bone$/.test(part.name), part.name);
        bones++;
        continue;
      }
      const n = part.positions.length / 3;
      assert.equal(w!.seg.length, n * 3, part.name);
      for (let i = 0; i < w!.seg.length; i++) assert.ok(w!.seg[i]! < rig.segments.length || w!.seg[i] === NO_SEG);
    }
    assert.equal(bones, Object.keys(rig.bones).length);
    // the long bones where they belong
    const segOf = (name: string): string => rig.segments[rig.bones[[...parts].find(([, p]) => p.part.name === name)![0]]!]!;
    assert.deepEqual(['left femur', 'right tibia', 'left humerus', 'right ulna', 'fifth lumbar vertebra', 'mandible'].map(segOf),
      ['left thigh', 'right shank', 'left upper arm', 'right forearm', 'L5', 'head']);
  });

  it('keeps every bone\'s lengths under any pose (within 0.01 mm)', () => {
    let worst = 0;
    for (const pose of [BENT, STEP]) {
      const T = segmentTransforms(rig, pose);
      for (const [e, seg] of Object.entries(rig.bones)) {
        const P = parts.get(e)!.part.positions, N = new Float32Array(P.length);
        const got = poseMesh(P, N, T, seg).positions, n = P.length / 3, k = Math.max(1, Math.floor(n / 40));
        for (let i = 0; i < n; i += k) {
          for (let j = i + k; j < n; j += k) {
            const d0 = Math.hypot(P[i * 3]! - P[j * 3]!, P[i * 3 + 1]! - P[j * 3 + 1]!, P[i * 3 + 2]! - P[j * 3 + 2]!);
            const d1 = Math.hypot(got[i * 3]! - got[j * 3]!, got[i * 3 + 1]! - got[j * 3 + 1]!, got[i * 3 + 2]! - got[j * 3 + 2]!);
            worst = Math.max(worst, Math.abs(d1 - d0));
          }
        }
      }
    }
    assert.ok(worst < 0.01, `a bone length changes by ${worst} mm`);
  });

  it('keeps the muscles\' ends on their bones (within 2 mm) under any pose', () => {
    // the ends: muscle vertices on one segment alone, no second named
    const ends: { e: string; v: number; seg: number }[] = [];
    for (const [e, w] of weights) {
      if (parts.get(e)!.system !== 'muscular') continue;
      for (let v = 0; v < w.seg.length / 3; v++) if (w.seg[v * 3 + 1] === NO_SEG) ends.push({ e, v, seg: w.seg[v * 3]! });
    }
    assert.equal(ends.length, rig.weights.attachments);
    assert.ok(ends.length > 10000, `${ends.length} muscle ends`);
    // they are on their bones at rest: within 1 mm, sampled 2 mm apart (so up to ~1.2 mm more)
    const bySeg = rig.segments.map(() => [] as number[]);
    for (const [e, s] of Object.entries(rig.bones)) for (const x of surfaceSamples(parts.get(e)!.part, 2)) bySeg[s]!.push(x);
    const trees = bySeg.map((s) => new PointTree(Float64Array.from(s)));
    for (let i = 0; i < ends.length; i += 97) {
      const { e, v, seg } = ends[i]!, P = parts.get(e)!.part.positions;
      const d = Math.sqrt(trees[seg]!.nearest(P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!).d2);
      assert.ok(d <= 2.2, `${parts.get(e)!.part.name} vertex ${v} is ${d} mm from ${rig.segments[seg]}`);
    }
    // posed, each stays where its bone takes it
    let worst = 0;
    for (const pose of [BENT, STEP]) {
      const T = segmentTransforms(rig, pose);
      const posed = new Map<string, Float32Array>();
      for (const { e, v, seg } of ends) {
        const part = parts.get(e)!.part;
        if (!posed.has(e)) posed.set(e, poseMesh(part.positions, new Float32Array(part.positions.length), T, weights.get(e)!).positions);
        const P = part.positions, Q = posed.get(e)!, o = seg * 12;
        const want = [0, 1, 2].map((r) => T[o + r * 3]! * P[v * 3]! + T[o + r * 3 + 1]! * P[v * 3 + 1]! + T[o + r * 3 + 2]! * P[v * 3 + 2]! + T[o + 9 + r]!);
        worst = Math.max(worst, Math.hypot(Q[v * 3]! - want[0]!, Q[v * 3 + 1]! - want[1]!, Q[v * 3 + 2]! - want[2]!));
      }
    }
    assert.ok(worst <= 2, `a muscle end leaves its bone by ${worst} mm`);
  });

  it('cites the digests it was fitted to, at the pins it was fitted to', () => {
    const src = JSON.parse(readFileSync(join(DIGESTS, 'body-rig', 'SOURCES.json'), 'utf8')) as { sources: { license_spdx: string; version_pin: string; source_url: string }[] };
    const pins = (rig as unknown as { digests: Record<string, string> }).digests;
    for (const d of ['bodyparts3d-body', 'hra-organs']) {
      const ix = JSON.parse(readFileSync(join(DIGESTS, d, 'index.json'), 'utf8')) as { pin: string };
      assert.equal(pins[d], ix.pin, d);
      assert.ok(src.sources.some((s) => s.version_pin === ix.pin && s.license_spdx === 'CC-BY-4.0' && s.source_url.startsWith('https://')), d);
    }
    const reg = JSON.parse(readFileSync(join(process.cwd(), 'DIGESTS.json'), 'utf8')) as { digests: { id: string; license_spdx: string; status: string }[] };
    assert.ok(reg.digests.some((r) => r.id === 'body-rig' && r.license_spdx === 'CC-BY-4.0' && r.status === 'shipped'));
  });

  it('leaves every part as it was at rest, so the atlas draws as in H2', () => {
    const T = segmentTransforms(rig, {});
    for (const [e, { part }] of parts) {
      const N = new Float32Array(part.positions.length).fill(0.5);
      const got = poseMesh(part.positions, N, T, rig.bones[e] ?? weights.get(e)!);
      assert.ok(Buffer.from(got.positions.buffer).equals(Buffer.from(part.positions.buffer, part.positions.byteOffset, part.positions.byteLength)), part.name);
      assert.ok(Buffer.from(got.normals.buffer).equals(Buffer.from(N.buffer)), part.name);
    }
  });
});
