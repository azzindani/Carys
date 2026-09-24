// The whole-body atlas' data (H2, docs/PHASES.md): the BodyParts3D body
// digest and the HRA organs placed in it (H3), their indexes merged and
// their system files fetched once each (module scope, like the bone
// atlas' mesh cache) and turned to the renderer's frame. A failed fetch is
// forgotten, so the next attempt retries; errors throw for the view to put
// on the status.
import {
  toScenePart, unpackBody, validateBodyIndex, type BodyIndex, type BodyIndexRow, type BodySystem, type ScenePart,
} from '@carys/render-cpu';

export const BODY_DIGEST_ID = 'bodyparts3d-body';
export const HRA_DIGEST_ID = 'hra-organs';
const DIGESTS = [BODY_DIGEST_ID, HRA_DIGEST_ID] as const;
type DigestId = typeof DIGESTS[number];

/** Where an HRA organ comes from: its dataset citation and DOI. */
export interface HraOrgan {
  citation: string;
  doi: string;
}

/** The digests as one atlas. */
export interface BodyAtlas {
  /** the shared grid (BodyParts3D frame, mm) */
  min: [number, number, number];
  max: [number, number, number];
  indexes: Record<DigestId, BodyIndex>;
  /** every part of every digest */
  parts: BodyIndexRow[];
  /** parts per system, all digests */
  systems: Partial<Record<BodySystem, number>>;
  /** HRA organ name → its citation; and the fit's leave-one-out median, mm */
  hra: { organs: Map<string, HraOrgan>; anchors: number; looMedianMm: number };
}

const base = (d: DigestId): string => `/digests/${d}`;

async function json(url: string): Promise<unknown> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} fetch failed (${r.status})`);
  return r.json();
}

let atlas: Promise<BodyAtlas> | null = null;

export function loadBodyAtlas(): Promise<BodyAtlas> {
  if (!atlas) {
    const p = (async (): Promise<BodyAtlas> => {
      const [body, hra, sources, fit] = await Promise.all([
        json(`${base(BODY_DIGEST_ID)}/index.json`), json(`${base(HRA_DIGEST_ID)}/index.json`),
        json(`${base(HRA_DIGEST_ID)}/SOURCES.json`), json(`${base(HRA_DIGEST_ID)}/fit.json`),
      ]);
      const indexes = { [BODY_DIGEST_ID]: validateBodyIndex(body), [HRA_DIGEST_ID]: validateBodyIndex(hra) } as Record<DigestId, BodyIndex>;
      const b = indexes[BODY_DIGEST_ID], h = indexes[HRA_DIGEST_ID];
      if (b.min.some((v, k) => v !== h.min[k]) || b.max.some((v, k) => v !== h.max[k])) throw new Error('the HRA organs are not on the body digest\'s grid');
      const systems: Partial<Record<BodySystem, number>> = {};
      for (const ix of [b, h]) for (const [s, f] of Object.entries(ix.systems)) systems[s as BodySystem] = (systems[s as BodySystem] ?? 0) + f!.parts;
      const organs = new Map<string, HraOrgan>();
      for (const s of (sources as { sources: { version_pin: string; citation?: string; doi?: string }[] }).sources) {
        if (s.citation && s.doi) organs.set(s.version_pin.split('@')[0]!, { citation: s.citation, doi: s.doi });
      }
      for (const [el] of h.parts) {
        if (!organs.has(el.split('/')[0]!)) throw new Error(`HRA part ${el} has no citation in SOURCES.json`);
      }
      const loo = (fit as { anchors: { leaveOneOutMm: number }[] }).anchors.map((a) => a.leaveOneOutMm).sort((x, y) => x - y);
      if (!loo.length) throw new Error('fit.json lists no anchors');
      return {
        min: b.min, max: b.max, indexes, parts: [...b.parts, ...h.parts], systems,
        hra: { organs, anchors: loo.length, looMedianMm: loo[Math.floor(loo.length / 2)]! },
      };
    })();
    p.catch(() => { if (atlas === p) atlas = null; });
    atlas = p;
  }
  return atlas;
}

const files = new Map<string, Promise<ScenePart[]>>();

/** One system's parts from one digest, in index order, renderer's frame. */
function loadFile(a: BodyAtlas, d: DigestId, s: BodySystem): Promise<ScenePart[]> {
  const key = `${d}/${s}`;
  let p = files.get(key);
  if (!p) {
    p = (async (): Promise<ScenePart[]> => {
      const f = a.indexes[d].systems[s]!;
      const r = await fetch(`${base(d)}/${f.file}`);
      if (!r.ok) throw new Error(`${key} fetch failed (${r.status})`);
      const pack = unpackBody(await r.arrayBuffer());
      if (pack.parts.length !== f.parts) throw new Error(`${key}: ${pack.parts.length} parts, the index says ${f.parts}`);
      if (pack.min.some((v, k) => v !== a.min[k]) || pack.max.some((v, k) => v !== a.max[k])) throw new Error(`${key}: its grid is not the index's`);
      return pack.parts.map((part) => toScenePart(part, a));
    })();
    const mine = p;
    mine.catch(() => { if (files.get(key) === mine) files.delete(key); });
    files.set(key, p);
  }
  return p;
}

/** A system's parts from every digest that has it. */
export async function loadBodySystem(a: BodyAtlas, s: BodySystem): Promise<ScenePart[]> {
  const got = await Promise.all(DIGESTS.filter((d) => a.indexes[d].systems[s]).map((d) => loadFile(a, d, s)));
  if (!got.length) throw new Error(`no ${s} file in the body digests`);
  return got.flat();
}

/** An HRA part's organ (its element is "organ/node"), else null. */
export function hraOrganOf(a: BodyAtlas, element: string): { name: string; organ: HraOrgan } | null {
  const name = element.split('/')[0]!;
  const organ = element.includes('/') ? a.hra.organs.get(name) : undefined;
  return organ ? { name, organ } : null;
}
