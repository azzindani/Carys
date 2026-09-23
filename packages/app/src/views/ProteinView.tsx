import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { isCifLike, parseCif, parsePdb, selectResidueAtoms, type ProteinModel } from '@carys/io';
import {
  PATHOGEN_DIGEST_ID, PATHOGEN_DIGEST_PIN,
  PATHOGEN_STRUCTURES, pathogenById,
} from '@carys/volume-core';
import { EDUCATION_BADGE } from '@carys/study';
import {
  atomRadius, bundleRange, elementColor, findPockets, fitMapToModel, History, minimizeRmsd, parseMolQuery, plddtColor, projectAtoms,
  rotateAtoms, runMolQuery, type Atom, type MapFitReport, type Pocket, type ResidueBundle, type StructureModel,
} from '@carys/volume-core';
import { loadNiiBuffer } from '../lib/loaders';
import { session } from '../lib/session';
import { subscribeResidueLink, takeResidueLink } from '../lib/linkBus';
import { setAmbientStatus, setStatus } from '../lib/status';
import { ACCENT, PROTEIN_BG } from '../lib/palette';
import { toast } from '../lib/toasts';
import { undoBus } from '../lib/undoBus';
import { Chip, DarkSelect, IconBtn, SliderRow, UndoGroup } from '../ui/primitives';

type ColorBy = 'element' | 'chain' | 'plddt';

/** AlphaFold B-factor column carries pLDDT; X-ray B-factors read as disorder. */
function confidenceColor(a: Atom): [number, number, number] {
  const v = a.plddt ?? a.bfactor;
  if (v === undefined || !Number.isFinite(v)) return [150, 150, 150];
  return plddtColor(v);
}

const CHAIN_PALETTE: [number, number, number][] = [
  [45, 212, 191], [96, 165, 250], [250, 204, 21], [248, 113, 113],
  [192, 132, 252], [110, 231, 183], [252, 165, 165], [147, 197, 253],
];

function chainColor(chain: string): [number, number, number] {
  let h = 0;
  for (let i = 0; i < chain.length; i++) h = (h * 31 + chain.charCodeAt(i)) >>> 0;
  return CHAIN_PALETTE[h % CHAIN_PALETTE.length]!;
}

function css([r, g, b]: [number, number, number]): string {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

const W = 640, H = 560;

export function ProteinView({ initialPathogen }: { initialPathogen?: string }): JSX.Element {
  const [model, setModel] = useState<ProteinModel | null>(null);
  const [name, setName] = useState('');
  const [orbit, setOrbit] = useState(0.7);
  const [tilt, setTilt] = useState(0.3);
  const [colorBy, setColorBy] = useState<ColorBy>('element');
  const [sel, setSelState] = useState<ResidueBundle | null>(null);
  const [query, setQuery] = useState('chain A');
  /** Null until a pocket query runs on this model; [] is a real answer. */
  const [pockets, setPockets] = useState<Pocket[] | null>(null);
  const [rmsd, setRmsd] = useState<string>('');
  // Map-fit stub: uploaded density (NIfTI) + dock-and-score report. Null =
  // no map open; the report says translation-only docking, never a 6D fit.
  const [mapName, setMapName] = useState('');
  const [pathogenId, setPathogenId] = useState('');
  const initialRef = useRef(initialPathogen ?? '');
  const [pathogenNote, setPathogenNote] = useState('');
  const [fit, setFit] = useState<MapFitReport | null>(null);
  const [fitThr, setFitThr] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Selection undo shares the History contract (not the mask UndoStack:
  // snapshots are tiny immutable bundles, not voxelLabelmaps). null is a
  // valid snapshot (deselected), so emptiness is tested via canUndo —
  // undo() returning null can mean "restore deselected".
  const selHist = useRef(new History<ResidueBundle | null>(32));
  const setSel = (next: ResidueBundle | null, record = true): void => {
    if (record) selHist.current.push(sel);
    setSelState(next);
  };

  const paint = (): void => {
    const cv = canvasRef.current;
    if (!cv || !model) return;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = PROTEIN_BG;
    ctx.fillRect(0, 0, W, H);
    // fit span into view
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const a of model.atoms) {
      if (a.x < x0) x0 = a.x; if (a.x > x1) x1 = a.x;
      if (a.y < y0) y0 = a.y; if (a.y > y1) y1 = a.y;
      if (a.z < z0) z0 = a.z; if (a.z > z1) z1 = a.z;
    }
    const span = Math.max(x1 - x0, y1 - y0, z1 - z0, 1e-6);
    const scale = (Math.min(W, H) / span) * 0.92;
    const rotated = rotateAtoms(model.atoms, orbit, tilt);
    // project about origin, then recenter on the rotated centroid
    const pts = projectAtoms(rotated, { scale, cx: 0, cy: 0 });
    let px = 0, py = 0;
    for (const p of pts) { px += p.x; py += p.y; }
    const dx = W / 2 - px / pts.length, dy = H / 2 - py / pts.length;
    // pts[] preserves model.atoms order, so index into the original array —
    // rotated atoms are copies and never identical to the selected originals.
    const hi = new Set(selectResidueAtoms(model, sel ?? { residues: [] }).map((a) => model.atoms.indexOf(a)));
    // far first (smaller z after rotation is farther from a +z camera)
    const order = pts.map((p, i) => i).sort((a, b) => pts[a]!.atom.z - pts[b]!.atom.z);
    for (const i of order) {
      const p = pts[i]!;
      const a: Atom = p.atom;
      const r = Math.max(1, atomRadius(a, 'vdw') * scale * 0.45);
      const col = colorBy === 'element' ? elementColor(a.element)
        : colorBy === 'chain' ? chainColor(a.chain) : confidenceColor(a);
      ctx.beginPath();
      ctx.arc(p.x + dx, p.y + dy, r, 0, Math.PI * 2);
      ctx.fillStyle = css(col);
      ctx.fill();
      if (hi.has(i)) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = ACCENT;
        ctx.stroke();
      }
    }
    const chains = new Set(model.atoms.map((a) => a.chain)).size;
    // every render repaints: the summary is ambient, or it would erase the
    // result of whatever the user just ran (pockets, RMSD, a query)
    setAmbientStatus(`${model.atoms.length.toLocaleString()} atoms · ${model.residues.length} residues · ${chains} chain(s)${sel ? ` · ${sel.residues.length} selected` : ''} · ${name}`);
  };

  const doUndoSel = (): void => {
    if (!selHist.current.canUndo) {
      toast('Nothing to undo', 'error');
      return;
    }
    setSelState(selHist.current.undo() ?? null);
  };
  const clearSel = (): void => {
    if (sel) setSel(null);
  };

  useEffect(() => { paint(); });
  useEffect(() => {
    undoBus.current = doUndoSel;
    // Learn's "Open structure" arrives as initialPathogen: open that entry
    // instead of the demo. It used to go through a ref nothing had filled
    // yet (a no-op, so the link landed on crambin), and the demo fetch
    // raced the entry's anyway — whichever parsed last was shown.
    const initial = initialRef.current;
    initialRef.current = '';
    if (initial) openPathogen(initial);
    else {
      void fetch('/samples/1crn.pdb').then(async (r) => {
        if (!r.ok) return;
        openModel(await r.text(), '1crn.pdb (crambin demo)');
      }).catch(() => { /* offline: upload instead */ });
    }
    // A residue link queued while the protein view was already mounted
    // (tracks → protein jump with the demo model open) is consumed against
    // the model once it lands.
    const unsub = subscribeResidueLink(() => consumeLink(modelRef.current));
    return () => { undoBus.current = () => {}; unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Latest model for the link subscription (state lags the bus event).
  const modelRef = useRef<ProteinModel | null>(null);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  const openModel = (text: string, label: string): void => {
    try {
      // mmCIF sniffed by content (data_ + _atom_site.), not extension
      const m = isCifLike(text) ? parseCif(text) : parsePdb(text);
      if (m.atoms.length === 0) {
        setStatus(`no ATOM records in ${label}`);
        return;
      }
      setModel(m);
      setName(label);
      selHist.current.clear(); // new document drops selection history (mirrors mask undo)
      setSelState(null);
      // results describe the model they ran on
      setPockets(null);
      setRmsd('');
      setFit(null);
      toast(`Protein: ${m.atoms.length} atoms, ${m.residues.length} residues`);
      // A queued tracks link belongs to the model just opened.
      requestAnimationFrame(() => consumeLink(m));
    } catch (err) {
      setStatus(`model load failed: ${(err as Error).message}`, 'error');
    }
  };

  /** M1 pathogen digest: open a vendored PDB entry (chains included for
   *  context), pin the digest, and announce chain roles. Failures stay
   *  loud on the visible status — never a silent empty view. */
  const openPathogen = (id: string): void => {
    const entry = pathogenById(id);
    if (!entry) {
      setStatus(`unknown pathogen entry: ${id}`);
      return;
    }
    setPathogenId(id);
    // the caption names the structure, then what each chain is
    setPathogenNote([entry.pdbId, ...Object.entries(entry.chainRoles).map(([c, r]) => `${c}: ${r}`)].join(' · '));
    session.digestPins = { [PATHOGEN_DIGEST_ID]: PATHOGEN_DIGEST_PIN };
    void fetch(`/digests/rcsb-pathogens/${entry.file}`).then(async (r) => {
      if (!r.ok) {
        setStatus(`pathogen fetch failed: ${entry.file} (${r.status})`, 'error');
        return;
      }
      openModel(await r.text(), `${entry.pdbId} (${entry.entry.term})`);
    }).catch((e) => setStatus(`pathogen load failed: ${(e as Error).message}`, 'error'));
  };

  /** M1 interface contacts: select the precomputed contact residues on the
   *  open pathogen model (chain+resSeq resolved against parsed residues).
   *  Missing residues stay loud — the contact list is digest data, the
   *  model is parsed bytes, and disagreement names itself. */
  const showContacts = (): void => {
    const entry = pathogenById(pathogenId);
    if (!entry || !model) {
      setStatus('open a pathogen entry first, then show its interface contacts');
      return;
    }
    const byKey = new Map(model.residues.map((r) => [`${r.chain}:${r.seqId}`, r.index]));
    const idx: number[] = [];
    const missing: string[] = [];
    for (const c of entry.contacts) {
      const hit = byKey.get(`${c.chain}:${c.resSeq}`);
      if (hit === undefined) missing.push(`${c.chain}:${c.resSeq}`);
      else idx.push(hit);
    }
    if (missing.length > 0) {
      setStatus(`contacts missing from parsed model: ${missing.join(', ')}`);
      return;
    }
    setSel({ residues: idx });
    toast(`${entry.contacts.length} interface contacts selected (${entry.contacts[0]?.partner ?? ''})`);
    setStatus(`${entry.contacts.length} interface contacts selected · ${entry.pdbId} · ${EDUCATION_BADGE}`);
  };

  /** M1 variant-note sites: highlight widely reported RBD positions on the
   *  resolved chain. Teaching highlight only — never a phenotype call. */
  const showVariants = (): void => {
    const entry = pathogenById(pathogenId);
    if (!entry || !model) {
      setStatus('open a pathogen entry first, then show its variant-note sites');
      return;
    }
    if (entry.variantSites.length === 0) {
      setStatus(`${entry.pdbId}: no variant-note sites (capsid assembly entry)`);
      return;
    }
    const chain = entry.contacts[0]?.chain ?? entry.chains[0]!;
    const byKey = new Map(model.residues.map((r) => [`${r.chain}:${r.seqId}`, r.index]));
    const idx: number[] = [];
    const missing: number[] = [];
    for (const s of entry.variantSites) {
      const hit = byKey.get(`${chain}:${s}`);
      if (hit === undefined) missing.push(s);
      else idx.push(hit);
    }
    if (missing.length > 0) {
      setStatus(`variant sites missing from parsed model: ${missing.join(', ')}`);
      return;
    }
    setSel({ residues: idx });
    toast(`${idx.length} variant-note sites selected (chain ${chain})`);
    setStatus(`${idx.length} variant-note sites selected · teaching highlight, not a phenotype call · ${EDUCATION_BADGE}`);
  };

  const toggleResidue = (index: number): void => {
    if (sel && sel.residues.length === 1 && sel.residues[0] === index) setSel(null);
    else setSel(bundleRange(index, index));
  };

  /** Consume a queued tracks→protein link: resolve chain+seqId against the
   *  open model, select the residue, announce. Unknown targets stay loud on
   *  the visible status (wrong model open) — never a silent no-op. */
  const consumeLink = (m: ProteinModel | null): void => {
    const link = takeResidueLink();
    if (!link) return;
    if (!m) {
      setStatus(`variant ${link.label} → ${link.chain}:${link.resSeq}: load the matching model first`);
      return;
    }
    const hit = m.residues.find((r) => r.chain === link.chain && r.seqId === link.resSeq);
    if (!hit) {
      const chains = [...new Set(m.residues.map((r) => r.chain))].join(',');
      setStatus(`variant ${link.label} → ${link.chain}:${link.resSeq}: not in ${name || 'open model'} (chains ${chains || '—'})`);
      return;
    }
    setSel({ residues: [hit.index] });
    toast(`Variant ${link.label} → ${hit.label} (chain ${hit.chain})`);
    setStatus(`variant ${link.label} → ${hit.label} selected (${m.residues.length} residues)`);
  };

  /** CA positions per residue index (first CA atom wins; no CA = skipped). */
  const caPositions = (): Map<number, [number, number, number]> => {
    const out = new Map<number, [number, number, number]>();
    if (!model) return out;
    const byKey = new Map(model.residues.map((r) => [`${r.chain}:${r.seqId}`, r.index]));
    for (const a of model.atoms) {
      const idx = byKey.get(`${a.chain}:${a.resSeq}`);
      if (idx === undefined || out.has(idx)) continue;
      const nm = (a.atomName ?? '').trim().toUpperCase();
      if (nm === 'CA') out.set(idx, [a.x, a.y, a.z]);
    }
    return out;
  };

  /** Ligand pocket query: exposed clefts over the CA graph, largest first. */
  const runPockets = (): void => {
    if (!model) { setStatus('load a model first'); return; }
    try {
      const found = findPockets(model.residues, caPositions());
      setPockets(found);
      if (found.length === 0) setStatus('no pockets found (all buried or too small)');
      else {
        const top = found[0]!;
        setSel({ residues: top.residues.map((r) => r.index) });
        setStatus(`${found.length} pocket(s): largest ${top.residues.length} residues selected`);
      }
    } catch (err) {
      setStatus(`pocket query failed: ${(err as Error).message}`, 'error');
    }
  };

  /** RMSD of the current selection against itself after centroid alignment
   *  (sanity: ~0 proves the Kabsch path; the cross-model comparison needs
   *  a second model, which stays next). */
  const runRmsd = (): void => {
    if (!model || !sel || sel.residues.length < 2) {
      setStatus('select 2+ residues first (click the sequence strip)');
      return;
    }
    const atoms = selectResidueAtoms(model, sel);
    if (atoms.length === 0) { setStatus('selection has no atoms'); return; }
    const n = atoms.length;
    const P = {
      x: Float64Array.from(atoms.map((a) => a.x)),
      y: Float64Array.from(atoms.map((a) => a.y)),
      z: Float64Array.from(atoms.map((a) => a.z)),
    };
    const r = minimizeRmsd(P, P, n);
    setRmsd(`RMSD ${r.rmsd.toFixed(3)} Å · n=${r.n}`);
    setStatus(`self-RMSD ${r.rmsd.toFixed(3)} Å over ${r.n} atoms (alignment sanity)`);
  };

  /** Cryo-EM stub: dock the open model into an uploaded NIfTI density map
   *  (centroid translation only) and score per-residue inclusion. MRC/CCP4
   *  binary stays out — maps convert to NIfTI losslessly; a 6D rigid-body
   *  search stays out — the report names translation as the only DOF. */
  const runMapFit = async (file: File, contour: number): Promise<void> => {
    if (!model) {
      setStatus('load a model first — the map docks onto its CA centroid');
      return;
    }
    try {
      const vol = loadNiiBuffer(await file.arrayBuffer());
      const report = fitMapToModel(model.residues, caPositions(), {
        dims: vol.dims, spacing: vol.spacing ?? [1, 1, 1], origin: [0, 0, 0], data: vol.data,
      }, { contour });
      setMapName(file.name);
      setFit(report);
      const pct = Number.isNaN(report.inclusion) ? '—' : `${Math.round(report.inclusion * 100)}%`;
      setStatus(`${file.name}: ${report.nIncluded}/${report.nScored} CAs in density (${pct}) · translation-only dock, no rotation search`);
      toast(`Map fit: ${report.nIncluded}/${report.nScored} in density (${pct})`);
    } catch (err) {
      setStatus(`map fit failed: ${(err as Error).message}`, 'error');
    }
  };

  const openMapFile = (file: File): void => {
    void runMapFit(file, fitThr);
  };

  /** MolQL string subset over the open model (chain/resi/atom/element + AND). */
  const runQuery = (): void => {
    if (!model) { setStatus('load a model first'); return; }
    try {
      const q = parseMolQuery(query);
      const struct: StructureModel = {
        hierarchy: {
          atoms: model.atoms.map((a) => ({
            type_symbol: a.element, label_atom_id: a.atomName ?? '', label_comp_id: a.resName,
            label_asym_id: a.chain, auth_asym_id: a.chain,
            label_seq_id: a.resSeq, auth_seq_id: a.resSeq,
            x: a.x, y: a.y, z: a.z, occupancy: 1, b_iso: a.bfactor ?? 0,
          })),
          residues: [], chains: [], residueOffsets: [], chainOffsets: [],
        },
        units: [], entities: [],
      };
      const hits = runMolQuery(struct, q);
      if (hits.length === 0) { setStatus(`no atoms match "${query}"`); return; }
      const byRes = new Map<string, number>();
      for (const r of model.residues) byRes.set(`${r.chain}:${r.seqId}`, r.index);
      const idx = [...new Set(hits.map((h) => {
        const a = model.atoms[h]!;
        return byRes.get(`${a.chain}:${a.resSeq}`);
      }).filter((v): v is number => v !== undefined))].sort((a, b) => a - b);
      setSel({ residues: idx });
      setStatus(`${hits.length} atoms · ${idx.length} residues match "${query}"`);
    } catch (err) {
      setStatus(`bad query: ${(err as Error).message}`);
    }
  };

  return (
    <>
      <div className="view-title" id="title-protein">
        <h1>Protein</h1>
        <p>{name || 'load a .pdb/.cif — spacefill CPU projection, sequence ↔ 3D highlight'}</p>
      </div>
      <div className="dock" id="dock-protein">
        <div className="grp">
          <IconBtn accent title="Load the built-in 1CRN crambin demo"
            onClick={() => { void fetch('/samples/1crn.pdb').then(async (r) => openModel(await r.text(), '1crn.pdb')); }}>Demo 1CRN</IconBtn>
          <IconBtn accent title="Load AlphaFold ubiquitin (pLDDT in B-factor)"
            onClick={() => {
              void fetch('/samples/af-p0cg48-ubiquitin.pdb').then(async (r) => {
                openModel(await r.text(), 'af-ubiquitin (pLDDT demo)');
                setColorBy('plddt');
              });
            }}>Demo AF</IconBtn>
          <label className="iconbtn" htmlFor="pdb-upload" title="Open a .pdb/.cif file">Open model</label>
          <input
            type="file" id="pdb-upload" accept=".pdb,.ent,.cif" hidden
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) void f.text().then((t) => openModel(t, f.name));
            }}
          />
        </div>
        <div className="sep" />
        <div className="grp">
          <span className="lbl">Pathogen</span>
          <DarkSelect value={pathogenId} title="Pathogen digest (RCSB PDB, CC0 — teaching structures)" ariaLabel="Pathogen structure"
            onChange={(v) => openPathogen(v)}>
            <option value="">—</option>
            {PATHOGEN_STRUCTURES.map((e) => <option key={e.id} value={e.id}>{e.pdbId} · {e.entry.term.slice(0, 42)}</option>)}
          </DarkSelect>
          <IconBtn title="Select the precomputed interface contacts on the open model" onClick={showContacts}>Contacts</IconBtn>
          <IconBtn title="Highlight variant-note positions (teaching highlight, not a phenotype call)" onClick={showVariants}>Variants</IconBtn>
        </div>
        {(pathogenId || pathogenNote) && (
          <div className="grp">
            <Chip><span id="ro-pathogen">{pathogenNote || pathogenId} · {EDUCATION_BADGE}</span></Chip>
          </div>
        )}
        <div className="sep" />
        <SliderRow label="Orbit" min={0} max={6.283} step={0.01} value={orbit} onInput={setOrbit} />
        <SliderRow label="Tilt" min={-1.2} max={1.2} step={0.01} value={tilt} onInput={setTilt} />
        <div className="sep" />
        <div className="grp">
          <span className="lbl">Color</span>
          <DarkSelect value={colorBy} title="AlphaFold B-factor column carries pLDDT; X-ray B-factors read as disorder" ariaLabel="Color scheme"
            onChange={(v) => setColorBy(v as ColorBy)}>
            <option value="element">element</option>
            <option value="chain">chain</option>
            <option value="plddt">pLDDT / B-factor</option>
          </DarkSelect>
        </div>
        {sel && (
          <div className="grp">
            <Chip><span id="ro-sel">{sel.residues.length} selected</span></Chip>
            <IconBtn title="Clear selection" onClick={() => setSel(null)}>✕</IconBtn>
          </div>
        )}
        <div className="sep" />
        <div className="grp">
          <span className="lbl">Query</span>
          <input id="molq" className="urlinput" value={query} placeholder="chain A and resi 10:20"
            title="MolQL subset: chain / resi / atom / element joined by AND"
            aria-label="Residue query"
            onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runQuery(); }} />
          <IconBtn title="Select matching residues" onClick={runQuery}>Go</IconBtn>
        </div>
        <div className="sep" />
        <div className="grp">
          <IconBtn title="Find ligand pockets (exposed clefts), select the largest" onClick={runPockets}>Pockets</IconBtn>
          <IconBtn title="Self-RMSD of the selection (alignment sanity)" onClick={runRmsd}>RMSD</IconBtn>
        </div>
        {(pockets !== null || rmsd) && (
          <div className="grp">
            <Chip><span id="ro-pocket">{[
              pockets === null ? '' : pockets.length > 0 ? `${pockets.length} pocket(s) · top ${pockets[0]!.residues.length} res` : 'no pockets',
              rmsd,
            ].filter(Boolean).join(' · ')}</span></Chip>
          </div>
        )}
        <div className="sep" />
        <div className="grp">
          <span className="lbl">EM map</span>
          <label className="iconbtn" htmlFor="map-upload" title="Open a density map as NIfTI (.nii/.nii.gz) — docked by centroid translation, scored per residue">Open map</label>
          <input
            type="file" id="map-upload" accept=".nii,.gz" hidden
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) openMapFile(f);
              (e.target as HTMLInputElement).value = '';
            }}
          />
        </div>
        {mapName && (
          <div className="grp">
            <span className="lbl">Contour</span>
            <SliderRow label="Thr" min={0} max={100} step={1} value={fitThr} width={56}
              onInput={(v) => setFitThr(v)} onCommit={() => {
                const input = document.getElementById('map-upload') as HTMLInputElement | null;
                void input; // contour applies to the next Open map; rescore needs the file bytes
                setStatus('contour applies to the next map open (NIfTI bytes are not retained)');
              }} />
          </div>
        )}
        {fit && (
          <div className="grp">
            <Chip title="Translation-only dock score (no rotation search)"><span id="ro-mapfit">{mapName}: {fit.nIncluded}/{fit.nScored} in density{Number.isNaN(fit.inclusion) ? '' : ` (${Math.round(fit.inclusion * 100)}%)`}</span></Chip>
          </div>
        )}
        <div className="sep" />
        <UndoGroup onUndo={doUndoSel} onClear={clearSel} undoTitle="Undo selection" clearTitle="Clear selection" />
      </div>
      <div id="view-protein" className="panes" data-testid="protein">
        <div className="pane" id="pane-protein">
          <div className="pane-head">
            <span className="name">Structure</span>
            <Chip><span id="ro-protein">{model ? `${model.atoms.length} atoms` : '—'}</span></Chip>
          </div>
          <div className="stage">
            <canvas id="c-protein" ref={canvasRef} width={W} height={H}
              role="img" aria-label="Protein spacefill projection" />
          </div>
        </div>
        <div className="pane" id="pane-sequence">
          <div className="pane-head"><span className="name">Sequence</span>
            <Chip><span id="ro-seq">{model ? `${model.residues.length} residues` : '—'}</span></Chip>
          </div>
          <div className="seqstrip" id="seqstrip">
            {model ? model.residues.map((r) => {
              const on = sel?.residues.includes(r.index) ?? false;
              return (
                <button key={r.index} data-res={r.index} className={on ? 'on' : ''}
                  title={`${r.label} (chain ${r.chain})`} aria-pressed={on}
                  onClick={() => toggleResidue(r.index)}>{r.label}</button>
              );
            }) : <div className="hint">No model loaded.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
