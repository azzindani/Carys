// The body rig (H5, docs/PHASES.md): the segments, fitted joints and skin
// weights of digests/body-rig, fetched the first time a pose is set (the
// weights are megabytes) and turned to the renderer's frame. The rig was
// fitted to the atlas' digests at their pins; any other pin fails loud, as
// its weights would not line up. A failed fetch is forgotten, so the next
// attempt retries.
import {
  POSE_DOF, POSE_JOINTS, rigToScene, unpackWeights, type BodySystem, type Rig, type RigJoint, type SkinWeights,
} from '@carys/render-cpu';
import type { BodyAtlas } from './bodyAtlas';

export const RIG_DIGEST_ID = 'body-rig';

export interface BodyRig {
  pin: string;
  /** in the renderer's frame */
  rig: Rig;
  /** a bone's element → its segment */
  bones: Map<string, number>;
  /** "digest/system" → its weights file */
  files: Map<string, string>;
  /** each hip's centre from its acetabulum's own fit, mm */
  hipApartMm: number[];
}

const base = `/digests/${RIG_DIGEST_ID}`;

let rig: Promise<BodyRig> | null = null;

export function loadBodyRig(a: BodyAtlas): Promise<BodyRig> {
  if (!rig) {
    const p = (async (): Promise<BodyRig> => {
      const r = await fetch(`${base}/rig.json`);
      if (!r.ok) throw new Error(`${base}/rig.json fetch failed (${r.status})`);
      const raw = await r.json() as {
        format?: unknown; pin: string; digests: Record<string, string>; segments: string[]; joints: RigJoint[];
        bones: Record<string, number>; hipCheck: { apartMm: number }[]; weights: { files: { digest: string; system: string; file: string }[] };
      };
      if (raw.format !== 'carys-body-rig/1') throw new Error('rig.json is not carys-body-rig/1');
      for (const [d, pin] of Object.entries(raw.digests)) {
        const ix = a.indexes[d as keyof BodyAtlas['indexes']];
        if (!ix || ix.pin !== pin) throw new Error(`the rig was fitted to ${d} ${pin}, the atlas has ${ix?.pin ?? 'none'}`);
      }
      for (const j of POSE_JOINTS) {
        if (!raw.joints.some((k) => k.pose === j && k.dof === POSE_DOF[j])) throw new Error(`rig.json has no ${j} joint`);
      }
      const bones = new Map(Object.entries(raw.bones));
      for (const s of bones.values()) if (!(s >= 0 && s < raw.segments.length)) throw new Error(`rig.json: bone segment ${s}`);
      return {
        pin: raw.pin, rig: rigToScene({ segments: raw.segments, joints: raw.joints }, a), bones,
        files: new Map(raw.weights.files.map((f) => [`${f.digest}/${f.system}`, f.file])),
        hipApartMm: raw.hipCheck.map((h) => h.apartMm),
      };
    })();
    p.catch(() => { if (rig === p) rig = null; });
    rig = p;
  }
  return rig;
}

const weights = new Map<string, Promise<Map<string, SkinWeights>>>();

/** A system's weights, every digest's that has them, by element. */
export async function loadRigWeights(r: BodyRig, s: BodySystem): Promise<Map<string, SkinWeights>> {
  const keys = [...r.files.keys()].filter((k) => k.endsWith(`/${s}`));
  const got = await Promise.all(keys.map((key) => {
    let p = weights.get(key);
    if (!p) {
      p = (async (): Promise<Map<string, SkinWeights>> => {
        const res = await fetch(`${base}/${r.files.get(key)!}`);
        if (!res.ok) throw new Error(`rig weights ${key} fetch failed (${res.status})`);
        return unpackWeights(await res.arrayBuffer());
      })();
      const mine = p;
      mine.catch(() => { if (weights.get(key) === mine) weights.delete(key); });
      weights.set(key, p);
    }
    return p;
  }));
  return new Map(got.flatMap((m) => [...m]));
}
