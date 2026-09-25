import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackBody } from '../body-pack.js';
import { parseBvh, retargetFrame } from '../bvh.js';
import { footSlip, muscleEnds, muscleLength, solePoints } from '../gait.js';
import { segmentTransforms, unpackWeights, type Rig } from '../rig.js';

// H6 (docs/PHASES.md): the gait motions digest, as built by
// scripts/build-body-gait.mjs, played on the H5 rig and body.

const D = join(process.cwd(), 'digests');
const read = (p: string): string => readFileSync(join(D, p), 'utf8');
interface Motion { file: string; frames: number; strideS: number; subjects: number; bodySpeedMps: number; bodyVelocityMmS: [number, number, number]; contact: { left: number[]; right: number[] }; slipMm: { left: number; right: number } }
const gait = JSON.parse(read('gait-motions/gait.json')) as { format: string; soleMm: number; slipTolMm: number; motions: Record<'walk' | 'run', Motion> };
const rigFile = JSON.parse(read('body-rig/rig.json')) as Rig & { bones: Record<string, number> };
const rig: Rig = { segments: rigFile.segments, joints: rigFile.joints };
/** BVH (X left, Y up, Z front) → the rig's BodyParts3D frame (x left, y back, z up). */
const toBp = (v: [number, number, number]): [number, number, number] => [v[0], -v[2], v[1]];

const ix = JSON.parse(read('bodyparts3d-body/index.json')) as { systems: Record<string, { file: string }> };
const skeletal = new Map(unpackBody(readFileSync(join(D, 'bodyparts3d-body', ix.systems.skeletal!.file))).parts.map((p) => [p.element, p]));
const footOf = (side: 'left' | 'right'): { seg: number; points: Float64Array } => {
  const seg = rig.segments.indexOf(`${side} foot`);
  const bones = Object.entries(rigFile.bones).filter(([, s]) => s === seg).map(([e]) => skeletal.get(e)!.positions);
  return { seg, points: solePoints(bones, 2, gait.soleMm) };
};
const feet = { left: footOf('left'), right: footOf('right') };
const ground = Math.min(...[feet.left, feet.right].flatMap((f) => [...f.points].filter((_, i) => i % 3 === 2)));
const cycle = (m: Motion): { poses: ReturnType<typeof retargetFrame>['pose'][]; roots: [number, number, number][]; frameTime: number } => {
  const bvh = parseBvh(read(`gait-motions/${m.file}`)), got = bvh.frames.map((_, f) => retargetFrame(bvh, f, rig, toBp));
  return { poses: got.map((g) => g.pose), roots: got.map((g) => g.root), frameTime: bvh.frameTime };
};

describe('the gait motions digest (H6)', () => {
  it('holds a walking and a running cycle, cited, CC BY 4.0', () => {
    assert.equal(gait.format, 'carys-gait/1');
    for (const m of Object.values(gait.motions)) {
      const bvh = parseBvh(read(`gait-motions/${m.file}`));
      assert.equal(bvh.frames.length, m.frames);
      assert.ok(Math.abs(bvh.frameTime * m.frames - m.strideS) < 1e-3, `${m.file}: ${bvh.frameTime} × ${m.frames} vs ${m.strideS} s`);
      assert.ok(m.subjects >= 30 && m.contact.left.length === m.frames && m.contact.right.some((c) => c) && m.contact.left.some((c) => c));
    }
    // walking has both feet down at once, running a flight with neither
    const both = (m: Motion): number => m.contact.left.filter((c, f) => c && m.contact.right[f]).length;
    const none = (m: Motion): number => m.contact.left.filter((c, f) => !c && !m.contact.right[f]).length;
    assert.ok(both(gait.motions.walk) > 10 && none(gait.motions.walk) === 0, `walk: ${both(gait.motions.walk)} double, ${none(gait.motions.walk)} flight`);
    assert.ok(none(gait.motions.run) > 10 && both(gait.motions.run) === 0, `run: ${both(gait.motions.run)} double, ${none(gait.motions.run)} flight`);
    const src = JSON.parse(read('gait-motions/SOURCES.json')) as { sources: { license_spdx: string; citation: string; doi: string }[] };
    assert.equal(src.sources.length, 2);
    for (const s of src.sources) assert.ok(s.license_spdx === 'CC-BY-4.0' && s.citation.includes(s.doi.replace('https://doi.org/', '')), s.citation);
    const reg = JSON.parse(readFileSync(join(process.cwd(), 'DIGESTS.json'), 'utf8')) as { digests: { id: string; license_spdx: string; status: string }[] };
    assert.ok(reg.digests.some((r) => r.id === 'gait-motions' && r.license_spdx === 'CC-BY-4.0' && r.status === 'shipped'));
  });

  it('keeps the feet from slipping in contact: under 2 cm a gait cycle', () => {
    for (const [name, m] of Object.entries(gait.motions)) {
      const { poses, roots, frameTime } = cycle(m);
      const slip = footSlip(rig, poses, roots, feet, m.contact, frameTime, m.bodyVelocityMmS, 2, ground, gait.slipTolMm);
      assert.ok(slip.left < 20 && slip.right < 20, `${name}: ${slip.left.toFixed(1)} and ${slip.right.toFixed(1)} mm`);
      // as the build recorded
      assert.ok(Math.abs(slip.left - m.slipMm.left) < 0.01 && Math.abs(slip.right - m.slipMm.right) < 0.01, `${name}: recorded ${JSON.stringify(m.slipMm)}`);
    }
  });

  it('pins the muscles\' lengths over the walking cycle', () => {
    const muscular = new Map(unpackBody(readFileSync(join(D, 'bodyparts3d-body', ix.systems.muscular!.file))).parts.map((p) => [p.element, p]));
    const weights = unpackWeights(readFileSync(join(D, 'body-rig', 'bodyparts3d-body.muscular.cbrw')));
    const { poses, roots } = cycle(gait.motions.walk);
    const lengths = (): Record<string, number[]> => Object.fromEntries(PINNED.map(([e]) => {
      const ends = muscleEnds(e, muscular.get(e)!.positions, weights.get(e)!)!;
      return [e, [0, 25, 50, 75].map((f) => Math.round(muscleLength(ends, segmentTransforms(rig, poses[f]!, roots[f]!)) * 10) / 10)];
    }));
    const got = lengths();
    // the same numbers every time
    assert.deepEqual(lengths(), got);
    for (const [e, want] of PINNED) assert.deepEqual(got[e], want, `${e}: ${got[e]}`);
  });
});

/** Lengths (mm) at 0, 25, 50 and 75% of the walking cycle (the right heel
 *  strike at 0%): the long head of the right biceps femoris, the right
 *  rectus femoris, gluteus maximus and tibialis anterior. */
const PINNED: [string, number[]][] = [
  ['FJ1395', [461.5, 437.5, 423.1, 417.3]], // rest 430.7: longest at the heel strike (hip flexed, knee straight)
  ['FJ1433', [477.2, 496.5, 503.2, 501.9]], // rest 495.6: longest as the hip extends
  ['FJ1418', [223.2, 214.5, 202, 220.9]], // rest 207.9
  ['FJ1439', [304.3, 297, 292.5, 307.2]], // rest 306.4
];
