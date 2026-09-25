// The gait motions: the mean walking and running
// cycles of digests/gait-motions, BVH files fetched and parsed the first
// time a motion is chosen, with the citations of the data they come from.
// A failed fetch is forgotten, so the next attempt retries.
import { parseBvh, type Bvh } from '@carys/render-cpu';

export const GAIT_DIGEST_ID = 'gait-motions';
export const GAIT_MOTIONS = ['walk', 'run'] as const;
export type GaitMotion = (typeof GAIT_MOTIONS)[number];

export interface GaitCycle {
  bvh: Bvh;
  subjects: number;
  /** the subjects' speed, m/s, and this body's at its height */
  speedMps: number;
  bodySpeedMps: number;
  strideS: number;
  contact: { left: number[]; right: number[] };
}

export interface Gait {
  pin: string;
  motions: Record<GaitMotion, GaitCycle>;
  /** each data set's citation, walking's then running's */
  citations: string[];
}

const base = `/digests/${GAIT_DIGEST_ID}`;

async function get(path: string): Promise<Response> {
  const r = await fetch(`${base}/${path}`);
  if (!r.ok) throw new Error(`${base}/${path} fetch failed (${r.status})`);
  return r;
}

let gait: Promise<Gait> | null = null;

export function loadGait(): Promise<Gait> {
  if (!gait) {
    const p = (async (): Promise<Gait> => {
      const [meta, sources] = await Promise.all([get('gait.json').then((r) => r.json()), get('SOURCES.json').then((r) => r.json())]) as [
        { format?: unknown; pin: string; motions: Record<GaitMotion, Omit<GaitCycle, 'bvh'> & { file: string; frames: number }> },
        { sources: { citation?: string; license_spdx: string }[] },
      ];
      if (meta.format !== 'carys-gait/1') throw new Error('gait.json is not carys-gait/1');
      const citations = sources.sources.map((s) => {
        if (!s.citation || s.license_spdx !== 'CC-BY-4.0') throw new Error('gait SOURCES.json: a source without a CC BY 4.0 citation');
        return s.citation;
      });
      const motions = {} as Record<GaitMotion, GaitCycle>;
      for (const name of GAIT_MOTIONS) {
        const m = meta.motions[name];
        if (!m) throw new Error(`gait.json has no ${name}`);
        const bvh = parseBvh(await (await get(m.file)).text());
        if (bvh.frames.length !== m.frames || m.contact.left.length !== m.frames) throw new Error(`${m.file}: ${bvh.frames.length} frames, gait.json says ${m.frames}`);
        motions[name] = { bvh, subjects: m.subjects, speedMps: m.speedMps, bodySpeedMps: m.bodySpeedMps, strideS: m.strideS, contact: m.contact };
      }
      return { pin: meta.pin, motions, citations };
    })();
    p.catch(() => { if (gait === p) gait = null; });
    gait = p;
  }
  return gait;
}
