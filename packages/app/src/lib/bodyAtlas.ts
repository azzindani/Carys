// The whole-body atlas' data (H2, docs/PHASES.md): the BodyParts3D body
// digest's index and system files, each fetched once (module scope, like
// the bone atlas' mesh cache) and turned to the renderer's frame. A failed
// fetch is forgotten, so the next attempt retries; errors throw for the
// view to put on the status.
import {
  toScenePart, unpackBody, validateBodyIndex, type BodyIndex, type BodySystem, type ScenePart,
} from '@carys/render-cpu';

export const BODY_DIGEST_ID = 'bodyparts3d-body';
const BASE = `/digests/${BODY_DIGEST_ID}`;

let index: Promise<BodyIndex> | null = null;

export function loadBodyIndex(): Promise<BodyIndex> {
  if (!index) {
    const p = (async (): Promise<BodyIndex> => {
      const r = await fetch(`${BASE}/index.json`);
      if (!r.ok) throw new Error(`body index fetch failed (${r.status})`);
      return validateBodyIndex(await r.json());
    })();
    p.catch(() => { if (index === p) index = null; });
    index = p;
  }
  return index;
}

const systems = new Map<BodySystem, Promise<ScenePart[]>>();

/** One system's parts, in index order, in the renderer's frame. */
export function loadBodySystem(idx: BodyIndex, s: BodySystem): Promise<ScenePart[]> {
  let p = systems.get(s);
  if (!p) {
    p = (async (): Promise<ScenePart[]> => {
      const f = idx.systems[s];
      if (!f) throw new Error(`no ${s} file in the body digest`);
      const r = await fetch(`${BASE}/${f.file}`);
      if (!r.ok) throw new Error(`body ${s} fetch failed (${r.status})`);
      const pack = unpackBody(await r.arrayBuffer());
      if (pack.parts.length !== f.parts) throw new Error(`body ${s}: ${pack.parts.length} parts, the index says ${f.parts}`);
      if (pack.min.some((v, k) => v !== idx.min[k]) || pack.max.some((v, k) => v !== idx.max[k])) {
        throw new Error(`body ${s}: its grid is not the index's`);
      }
      return pack.parts.map((part) => toScenePart(part, idx));
    })();
    const mine = p;
    mine.catch(() => { if (systems.get(s) === mine) systems.delete(s); });
    systems.set(s, p);
  }
  return p;
}
