import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  ATLAS_ATTRIBUTION, ATLAS_BOUNDS, ATLAS_DIGEST_ID, ATLAS_DIGEST_PIN,
  ATLAS_STRUCTURES, atlasById, BRAIN_ATTRIBUTION, BRAIN_DIGEST_ID, BRAIN_DIGEST_PIN,
  glossaryCard, installBrainTable, installTermTable, installTreeTable,
  isaAncestors, isaChildren, partofChildren, searchBrainLabels, searchTerms, structureTerm,
  termByFma, treeName, validateBrainTable,
  TERMS_DIGEST_ID, TERMS_DIGEST_PIN, validateTermTable, validateTreeTable,
} from '@carys/volume-core';
import { EDUCATION_BADGE, validateKnowledgeEntry, type KnowledgeEntry } from '@carys/study';
import { fitMeshToBox, parseMz3, renderMesh } from '@carys/render-cpu';
import { session } from '../lib/session';
import { setStatus } from '../lib/status';
import { toast } from '../lib/toasts';
import { bump } from '../lib/version';
import { Chip, DarkSelect, IconBtn, SliderRow } from '../ui/primitives';

const W = 560, H = 560;
/** Bone tint on near-black (quarantine: never the measurement grayscale). */
const BONE: [number, number, number] = [224, 213, 184];
const BG: [number, number, number] = [16, 16, 17];

// Term table install (module scope, once): labels resolve through K1.
// fetch failures stay loud on the status — the picker still works off the
// hand-authored A1 entries via the structureTerm fallback.
let termsReady = false;
async function ensureTerms(): Promise<void> {
  if (termsReady) return;
  const r = await fetch('/digests/bodyparts3d-terms/terms.json');
  if (!r.ok) throw new Error(`terms fetch failed (${r.status})`);
  installTermTable(validateTermTable(await r.json()));
  const tr = await fetch('/digests/bodyparts3d-terms/tree.json');
  if (!tr.ok) throw new Error(`tree fetch failed (${tr.status})`);
  installTreeTable(validateTreeTable(await tr.json()));
  const br = await fetch('/digests/openanatomy-brain/labels.json');
  if (!br.ok) throw new Error(`brain labels fetch failed (${br.status})`);
  installBrainTable(validateBrainTable(await br.json()));
  termsReady = true;
}

// Load + validate state per structure id (module-ephemeral, like cine
// playing flags: the mesh itself is the cache, keyed by structure id).
const meshCache = new Map<string, { positions: Float32Array; normals: Float32Array; indices: Uint32Array }>();

async function loadAtlasMesh(id: string): Promise<{ positions: Float32Array; normals: Float32Array; indices: Uint32Array }> {
  const hit = meshCache.get(id);
  if (hit) return hit;
  const s = atlasById(id);
  if (!s) throw new Error(`unknown atlas structure: ${id}`);
  // Compound (sternum): concatenate member meshes, reindexing faces.
  // parseMz3 already returns accumulated unit vertex normals, so keep
  // each member's normals alongside its positions (no recompute).
  const files = s.members ?? [s.file];
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (const f of files) {
    const r = await fetch(`/digests/bodyparts3d-longbones/${f}`);
    if (!r.ok) throw new Error(`atlas fetch failed: ${f} (${r.status})`);
    const { mesh } = parseMz3(await r.arrayBuffer());
    const base = pos.length / 3;
    for (let i = 0; i < mesh.positions.length; i++) pos.push(mesh.positions[i]!);
    for (let i = 0; i < mesh.normals.length; i++) nrm.push(mesh.normals[i]!);
    for (let i = 0; i < mesh.indices.length; i++) idx.push(base + mesh.indices[i]!);
  }
  const mesh = {
    positions: Float32Array.from(pos),
    normals: Float32Array.from(nrm),
    indices: Uint32Array.from(idx),
  };
  meshCache.set(id, mesh);
  return mesh;
}

/** fitMeshToBox needs dims: synthesize a cubic voxel box from the
 *  atlas-local mm bounds so framing never depends on an open volume. */
function boundsDims(id: string): [number, number, number] {
  const b = ATLAS_BOUNDS[id];
  if (!b) throw new Error(`no atlas bounds for ${id}`);
  const span = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1e-9);
  const n = Math.max(8, Math.ceil(span));
  return [n, n, n];
}

/** K2 glossary popover: definition + source + version for one FMA id.
 *  Facts derive from vendored tables via glossaryCard(); unknown ids stay
 *  loud ("no glossary entry") instead of rendering half a card. Exits:
 *  Esc (effect above), ✕ button, re-tap of the term chip. */
function GlossaryCard({ fma, onClose }: { fma: string; onClose: () => void }): JSX.Element {
  let card = null;
  let err = '';
  try {
    card = glossaryCard(fma);
  } catch (e) {
    err = (e as Error).message;
  }
  if (err) {
    return (
      <div className="hint" id="gloss" role="dialog" aria-label="Glossary">
        terms not loaded ({err})
        <button className="cellrow" title="Close glossary" aria-label="Close glossary" onClick={onClose}>✕</button>
      </div>
    );
  }
  if (!card) {
    return (
      <div className="hint" id="gloss" role="dialog" aria-label="Glossary">
        no glossary entry for {fma}
        <button className="cellrow" title="Close glossary" aria-label="Close glossary" onClick={onClose}>✕</button>
      </div>
    );
  }
  return (
    <dl className="kv" id="gloss" role="dialog" aria-label={`Glossary: ${card.name}`}>
      <div className="mrow">
        <dt>{card.name} · {card.fma}</dt>
        <dd>
          <button className="cellrow" title="Close glossary" aria-label="Close glossary" onClick={onClose}>✕</button>
        </dd>
      </div>
      <div className="mrow">
        <dt>is a</dt>
        <dd id="gloss-parent">{card.parent ? `${card.parent.name} (${card.parent.fma})` : '— (no parent in this cut)'}</dd>
      </div>
      <div className="mrow">
        <dt>children</dt>
        <dd id="gloss-children">{card.children.length > 0 ? `${card.children.length}: ${card.children.join(', ')}` : '— (leaf in this cut)'}</dd>
      </div>
      <div className="mrow">
        <dt>part-of</dt>
        <dd id="gloss-partof">{card.partof.length > 0 ? `${card.partof.length}: ${card.partof.join(', ')}` : '—'}</dd>
      </div>
      <div className="mrow">
        <dt>meshes</dt>
        <dd id="gloss-meshes">{card.members.length > 0 ? `${card.members.length} file(s): ${card.members.slice(0, 6).join(', ')}${card.members.length > 6 ? ', …' : ''}` : '— (IS-A-only concept)'}</dd>
      </div>
      <div className="mrow">
        <dt>source</dt>
        <dd id="gloss-src">{card.source}</dd>
      </div>
    </dl>
  );
}

/** A1 anatomy overlay: BodyParts3D long-bone digest on the CPU rasterizer.
 *  Education pixels only (badged) — measurement canvases never import this. */
export function AtlasView(): JSX.Element {
  const [sel, setSel] = useState('femur-r');
  const [orbit, setOrbit] = useState(0.7);
  const [tilt, setTilt] = useState(0.3);
  const [zoom, setZoom] = useState(1);
  const [tris, setTris] = useState(0);
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ReturnType<typeof searchTerms>>([]);
  // A3 brain regions: label-value search over the 335 SPL rows. A hit
  // reports its RadLex id + color (teaching facts); the mesh view stays
  // on the skeleton — the big SPL volume is never vendored.
  const [bquery, setBquery] = useState('');
  const [bhits, setBhits] = useState<ReturnType<typeof searchBrainLabels>>([]);
  // K2 glossary popover: FMA id open in the card, null = closed.
  // Ephemeral like cine flags (never persisted); Esc / ✕ / re-tap exits.
  const [gloss, setGloss] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const paint = async (id: string, o: number, t: number, z: number): Promise<void> => {
    const cv = canvasRef.current;
    if (!cv) return;
    try {
      await ensureTerms();
      const raw = await loadAtlasMesh(id);
      const fitted = fitMeshToBox(
        { positions: raw.positions, normals: raw.normals, indices: raw.indices }, boundsDims(id),
      );
      const out = renderMesh(fitted, boundsDims(id), {
        width: cv.width, height: cv.height, angleY: o, tiltX: t, color: BONE, bg: BG, zoom: z,
      });
      cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(out), cv.width, cv.height), 0, 0);
      setTris(fitted.indices.length / 3);
      setErr('');
      // Provenance rides the session (DigestRows + sidecar) while open.
      session.digestPins = { [ATLAS_DIGEST_ID]: ATLAS_DIGEST_PIN, [TERMS_DIGEST_ID]: TERMS_DIGEST_PIN };
      const st = atlasById(id)!;
      const label = structureTerm(st, (fma: string) => {
        const hit = termByFma(fma);
        return hit ? { term: hit.name, source: 'FMA', source_version: hit.fma, reviewed_by: null } : null;
      });
      setStatus(`${label.term} · ${st.bpId} · ${(fitted.indices.length / 3).toLocaleString()} tris · ${EDUCATION_BADGE}`);
    } catch (e) {
      setErr((e as Error).message);
      setStatus(`atlas failed: ${(e as Error).message}`, 'error');
    }
  };

  useEffect(() => { void paint(sel, orbit, tilt, zoom); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { bump(); }, []);
  useEffect(() => {
    if (!gloss) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setGloss(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [gloss]);

  const s = atlasById(sel);
  // Labels resolve through K1 (structureTerm prefers the installed table,
  // falls back to the hand-authored A1 entry); validation stays loud.
  const resolved = s ? structureTerm(s, (fma: string) => {
    const hit = termByFma(fma);
    return hit ? { term: hit.name, source: 'FMA', source_version: hit.fma, reviewed_by: null } : null;
  }) : null;
  const entry = resolved ? validateKnowledgeEntry({ ...resolved } as KnowledgeEntry) : null;

  const pick = (id: string): void => {
    setSel(id);
    void paint(id, orbit, tilt, zoom);
    const hit = atlasById(id);
    if (hit) {
      const label = structureTerm(hit, (fma: string) => {
        const h = termByFma(fma);
        return h ? { term: h.name, source: 'FMA', source_version: h.fma, reviewed_by: null } : null;
      });
      toast(`${label.term} · ${hit.bpId}`);
    }
  };

  /** K1 search: names + FMA ids over 1368 concepts. A hit whose members
   *  are vendored jumps the 3D view; others report their membership so
   *  the A2 gap is visible, never silent. */
  const runSearch = (): void => {
    const found = searchTerms(query, 25);
    setHits(found);
    if (found.length === 0) {
      setStatus(`no anatomy terms match "${query}"`);
      return;
    }
    const top = found[0]!;
    const local = ATLAS_STRUCTURES.find((a) => a.entry.source_version === top.fma);
    if (local) {
      pick(local.id);
      // A2 teaching walk: IS-A children that are renderable structures.
      const kids = isaChildren(top.fma)
        .map((f: string) => ATLAS_STRUCTURES.find((a) => a.entry.source_version === f))
        .filter((a): a is NonNullable<typeof a> => a !== undefined);
      if (kids.length > 0) {
        setStatus(`${top.name} (${top.fma}) · ${kids.length} child structure(s): ${kids.map((k) => k.entry.term).join(', ')}`);
      }
      return;
    }
    // Hit has no atlas structure: name the IS-A neighbourhood so the
    // student can walk (ancestors up, renderable children down), and say
    // whether member files are vendored (future mesh) or absent (IS-A-only).
    const chain = isaAncestors(top.fma)
      .map((f: string) => treeName(f) ?? f)
      .join(' > ');
    const kids = isaChildren(top.fma)
      .map((f: string) => ATLAS_STRUCTURES.find((a) => a.entry.source_version === f))
      .filter((a): a is NonNullable<typeof a> => a !== undefined);
    const parts = partofChildren(top.fma);
    setStatus(
      `${top.name} (${top.fma}) has no single mesh`
      + (chain ? ` — ${chain}` : '')
      + (kids.length > 0 ? ` · child structure(s): ${kids.map((k) => k.entry.term).join(', ')}` : '')
      + (parts.length > 0 ? ` · ${parts.length} part-of children` : '')
      + (top.members.length === 0 ? ' · IS-A-only concept (no member files)' : ''),
    );
  };

  /** A3 search: SPL brain labels by name or RadLex id. Hits stay loud
   *  facts (label + value + RadLex) with the Slicer-license attribution —
   *  region geometry lives in the remote SPL volume, never here. */
  const runBrainSearch = async (): Promise<void> => {
    try {
      await ensureTerms();
    } catch (e) {
      setStatus(`brain labels failed: ${(e as Error).message}`, 'error');
      return;
    }
    const found = searchBrainLabels(bquery, 25);
    setBhits(found);
    if (found.length === 0) {
      setStatus(`no brain labels match "${bquery}"`);
      return;
    }
    const top = found[0]!;
    session.digestPins = { ...session.digestPins, [BRAIN_DIGEST_ID]: BRAIN_DIGEST_PIN };
    setStatus(`${top.label} (label ${top.v}${top.rid ? ` · ${top.rid}` : ''}) · ${found.length} hit(s) · SPL region (volume remote) · ${EDUCATION_BADGE}`);
  };

  return (
    <>
      <div className="view-title" id="title-atlas">
        <h1>Atlas</h1>
        <p>BodyParts3D skeleton (47 structures) · FMA terms · {EDUCATION_BADGE}</p>
      </div>
      <div className="dock" id="dock-atlas">
        <div className="grp">
          <span className="lbl">Bone</span>
          <DarkSelect value={sel} title="Atlas structure (BodyParts3D PART-OF skeleton)" ariaLabel="Atlas structure"
            onChange={(v) => pick(v)}>
            {ATLAS_STRUCTURES.map((a) => <option key={a.id} value={a.id}>{a.entry.term}</option>)}
          </DarkSelect>
        </div>
        <div className="grp">
          <span className="lbl">Find</span>
          <input id="atlas-search" className="urlinput" value={query} placeholder="femur, rib, FMA…"
            title="Search 1368 BodyParts3D concepts by name or FMA id (Enter jumps to the first renderable hit)"
            aria-label="Search anatomy terms"
            onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }} />
          <IconBtn title="Search anatomy terms" onClick={runSearch}>Go</IconBtn>
        </div>
        {hits.length > 0 && (
          <div className="grp">
            <Chip><span id="ro-atlas-hits">{hits.length} hit(s){hits[0] ? ` · top ${hits[0].name} (${hits[0].fma})` : ''}</span></Chip>
          </div>
        )}
        <div className="grp">
          <span className="lbl">Brain</span>
          <input id="atlas-brain-search" className="urlinput" value={bquery} placeholder="putamen, thalamus, RID…"
            title="Search 335 SPL brain labels by name or RadLex id"
            aria-label="Search brain labels"
            onChange={(e) => setBquery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runBrainSearch(); }} />
          <IconBtn title="Search brain labels" onClick={() => { void runBrainSearch(); }}>Go</IconBtn>
        </div>
        {bhits.length > 0 && (
          <div className="grp">
            <Chip><span id="ro-brain-hits">{bhits.length} hit(s){bhits[0] ? ` · top ${bhits[0].label} (label ${bhits[0].v}${bhits[0].rid ? ` · ${bhits[0].rid}` : ''})` : ''}</span></Chip>
          </div>
        )}
        <div className="sep" />
        <SliderRow label="Orbit" min={0} max={6.283} step={0.01} value={orbit} onInput={(v) => { setOrbit(v); void paint(sel, v, tilt, zoom); }} />
        <SliderRow label="Tilt" min={-1.2} max={1.2} step={0.01} value={tilt} onInput={(v) => { setTilt(v); void paint(sel, orbit, v, zoom); }} />
        <SliderRow label="Zoom" min={0.5} max={4} step={0.05} value={zoom} onInput={(v) => { setZoom(v); void paint(sel, orbit, tilt, v); }} />
        <div className="sep" />
        <div className="grp">
          <IconBtn title="Reload the current mesh (drops the cache)" onClick={() => { meshCache.delete(sel); void paint(sel, orbit, tilt, zoom); }}>Reload</IconBtn>
        </div>
        {(tris > 0 || err) && (
          <div className="grp">
            <Chip><span id="ro-atlas">{err ? `atlas error: ${err}` : `${tris.toLocaleString()} tris · ${s?.bpId ?? ''}`}</span></Chip>
          </div>
        )}
      </div>
      <div id="view-atlas" className="panes" data-testid="atlas">
        <div className="pane" id="pane-atlas">
          <div className="pane-head">
            <span className="name">Atlas</span>
            <Chip><button id="ro-atlas-term" className="cellrow" style={{ cursor: 'pointer' }}
              title={entry ? `Glossary: ${entry.source_version}` : 'No term loaded'}
              aria-expanded={gloss !== null}
              onClick={() => setGloss((g) => (g ? null : (entry?.source_version ?? null)))}>
              {entry ? `${entry.term} · ${s?.bpId} · ${entry.source} ${entry.source_version}` : '—'}
            </button></Chip>
          </div>
          {gloss && <GlossaryCard fma={gloss} onClose={() => setGloss(null)} />}
          <div className="stage">
            <canvas id="c-atlas" ref={canvasRef} width={W} height={H}
              role="img" aria-label="Atlas bone rendering (education overlay)" />
          </div>
          <div className="hint" id="atlas-src">{ATLAS_ATTRIBUTION}</div>
          <div className="hint" id="atlas-brain-src">{BRAIN_ATTRIBUTION}</div>
        </div>
      </div>
    </>
  );
}
