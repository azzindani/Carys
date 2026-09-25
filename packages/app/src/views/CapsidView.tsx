// Whole virus capsids (H7): an entry's asymmetric unit expanded into its
// biological assembly (volume-core assembly.ts, held to RCSB's own
// expansion) and drawn as spheres on the CPU (render-cpu spheres.ts). A
// million atoms draw in a few hundred milliseconds, so turning the shell
// draws residue beads (Auto) and the atoms follow once it settles; chain
// beads show the capsomer layout at a glance. Education pixels only.
import { useEffect, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type React from 'react';
import { elementColor, type AssemblyLevel } from '@carys/volume-core';
import { renderSpheres, sphereScratch, type SphereFrame, type SphereScratch } from '@carys/render-cpu';
import { EDUCATION_BADGE } from '@carys/study';
import { CAPSID_DIGEST_ID, loadCapsid, loadCapsidIndex, type CapsidIndex, type LoadedCapsid } from '../lib/capsids';
import {
  CAPSID_BG, CAPSID_CHAIN_COLORS, CAPSID_FOG, CAPSID_OTHER, CAPSID_PICK_COLOR,
  CAPSID_RADIAL_INNER, CAPSID_RADIAL_MID, CAPSID_RADIAL_OUTER,
} from '../lib/palette';
import { session } from '../lib/session';
import { setAmbientStatus, setStatus } from '../lib/status';
import { Chip, DarkSelect, Seg, SliderRow, Switch } from '../ui/primitives';
import { useOrbitPointer } from './orbitPointer';

type Level = 'atoms' | 'residues' | 'chains';
type LevelChoice = 'auto' | Level;
type CapsidColor = 'chain' | 'radius' | 'element';
type Rgb = readonly [number, number, number];

const W = 640, H = 560;
const ORBIT_SETTLE_MS = 250;
const ZOOM_MIN = 0.8, ZOOM_MAX = 12;
/** The shell's diameter as a share of the frame's short side at zoom 1. */
const FILL = 0.92;
const LEVEL_LABEL: Record<Level, string> = { atoms: 'atoms', residues: 'residue beads', chains: 'chain beads' };
const NO_PICK = -1;

const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** RGB per point of a level: its chain's quasi-equivalent colour, its
 *  distance from the centre, or its element; the picked copy in teal. */
function colours(c: LoadedCapsid, l: AssemblyLevel, by: CapsidColor, pickCopy: number): Uint8Array {
  const { unit, asm } = c;
  const p = l.points;
  const out = new Uint8Array(p.count * 3);
  const [r0, r1] = c.radial;
  const [cx, cy, cz] = asm.centre;
  for (let k = 0; k < p.count; k++) {
    const copy = p.copy[k]!, atom = l.atomOf[k]!;
    let rgb: Rgb;
    if (copy === pickCopy) rgb = CAPSID_PICK_COLOR;
    else if (by === 'element') rgb = elementColor(unit.element[atom]!);
    else if (by === 'radius') {
      const t = Math.min(1, Math.max(0, (Math.hypot(p.x[k]! - cx, p.y[k]! - cy, p.z[k]! - cz) - r0) / (r1 - r0)));
      rgb = t < 0.5 ? mix(CAPSID_RADIAL_INNER, CAPSID_RADIAL_MID, t * 2) : mix(CAPSID_RADIAL_MID, CAPSID_RADIAL_OUTER, t * 2 - 1);
    } else {
      rgb = unit.polymerChain[atom]! < 0 ? CAPSID_OTHER : CAPSID_CHAIN_COLORS[asm.copies[copy]!.asym % CAPSID_CHAIN_COLORS.length]!;
    }
    out[k * 3] = rgb[0];
    out[k * 3 + 1] = rgb[1];
    out[k * 3 + 2] = rgb[2];
  }
  return out;
}

interface Drawn { level: Level; count: number; ms: number }
interface Pick { copy: number; atom: number; level: Level }

export function CapsidView({ modeSwitch }: { modeSwitch: ReactNode }): JSX.Element {
  const [index, setIndex] = useState<CapsidIndex | null>(null);
  const [key, setKey] = useState('');
  const [capsid, setCapsid] = useState<LoadedCapsid | null>(null);
  const [loading, setLoading] = useState('loading the capsid index…');
  const [level, setLevel] = useState<LevelChoice>('auto');
  const [colorBy, setColorBy] = useState<CapsidColor>('chain');
  const [ao, setAo] = useState(true);
  const [orbit, setOrbit] = useState(0.7);
  const [tilt, setTilt] = useState(0.3);
  const [zoom, setZoom] = useState(1);
  const [pick, setPick] = useState<Pick | null>(null);
  const [settled, setSettled] = useState<Drawn | null>(null);
  const [moving, setMoving] = useState<Drawn | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // paint() runs from timers and pointer handlers: it reads refs, which
  // always hold the latest choice
  const loaded = useRef<LoadedCapsid | null>(null);
  const want = useRef({ level: 'auto' as LevelChoice, colorBy: 'chain' as CapsidColor, ao: true, pickCopy: NO_PICK });
  const angles = useRef({ orbit: 0.7, tilt: 0.3 });
  const zoomRef = useRef(1);
  const scratch = useRef<SphereScratch | null>(null);
  const rgbCache = useRef(new Map<Level, { key: string; rgb: Uint8Array }>());
  const frame = useRef<{ f: SphereFrame; level: Level } | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raf = useRef(false);
  const loadToken = useRef(0);

  const rgbOf = (c: LoadedCapsid, lv: Level): Uint8Array => {
    const k = `${c.entry.key}|${want.current.colorBy}|${want.current.pickCopy}`;
    const hit = rgbCache.current.get(lv);
    if (hit && hit.key === k) return hit.rgb;
    const rgb = colours(c, c.asm[lv], want.current.colorBy, want.current.pickCopy);
    rgbCache.current.set(lv, { key: k, rgb });
    return rgb;
  };

  const paint = (mode: 'moving' | 'settled'): void => {
    const c = loaded.current, cv = canvasRef.current;
    if (!c || !cv) return;
    const choice = want.current.level;
    const lv: Level = choice === 'auto' ? (mode === 'moving' ? 'residues' : 'atoms') : choice;
    const l = c.asm[lv];
    const t0 = performance.now();
    const f = renderSpheres(
      { count: l.points.count, x: l.points.x, y: l.points.y, z: l.points.z, r: l.r, rgb: rgbOf(c, lv) },
      {
        width: W, height: H, orbit: angles.current.orbit, tilt: angles.current.tilt, centre: c.asm.centre,
        scale: (FILL * Math.min(W, H) * zoomRef.current) / (2 * c.asm.radius), bg: CAPSID_BG,
        depthSpan: c.asm.radius, fog: CAPSID_FOG, ao: mode === 'settled' && want.current.ao,
      },
      scratch.current ?? undefined,
    );
    const ms = performance.now() - t0;
    cv.getContext('2d')!.putImageData(new ImageData(f.rgba, W, H), 0, 0);
    frame.current = { f, level: lv };
    const drawn = { level: lv, count: l.points.count, ms };
    if (mode === 'settled') setSettled(drawn); else setMoving(drawn);
  };

  const queueMove = (): void => {
    if (!raf.current) {
      raf.current = true;
      requestAnimationFrame(() => { raf.current = false; paint('moving'); });
    }
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => { settle.current = null; paint('settled'); }, ORBIT_SETTLE_MS);
  };

  const choose = (idx: CapsidIndex, k: string): void => {
    const e = idx.entries.find((x) => x.key === k);
    if (!e) {
      setStatus(`unknown capsid: ${k}`, 'error');
      return;
    }
    const token = ++loadToken.current;
    setKey(k);
    setLoading(`expanding ${e.pdbId}: ${e.copies} chain copies, ${e.atoms.toLocaleString()} atoms…`);
    void loadCapsid(e).then((c) => {
      if (token !== loadToken.current) return;
      loaded.current = c;
      scratch.current = sphereScratch(c.asm.atoms.points.count);
      rgbCache.current.clear();
      want.current.pickCopy = NO_PICK;
      setPick(null);
      setMoving(null);
      setCapsid(c);
      setLoading('');
      session.digestPins = { [CAPSID_DIGEST_ID]: idx.pin };
      setAmbientStatus(`${e.pdbId} · ${e.name} · ${e.atoms.toLocaleString()} atoms in ${e.copies} chain copies · ${EDUCATION_BADGE}`);
      paint('settled');
    }).catch((err) => {
      if (token !== loadToken.current) return;
      setLoading(`capsid failed: ${(err as Error).message}`);
      setStatus(`capsid ${e.pdbId} failed: ${(err as Error).message}`, 'error');
    });
  };

  useEffect(() => {
    let live = true;
    const tokens = loadToken;
    void loadCapsidIndex().then((idx) => {
      if (!live) return;
      setIndex(idx);
      choose(idx, idx.entries[0]!.key);
    }).catch((err) => {
      setLoading(`capsid index failed: ${(err as Error).message}`);
      setStatus(`capsid index failed: ${(err as Error).message}`, 'error');
    });
    return () => {
      live = false;
      tokens.current++; // a load still running lands nowhere
      if (settle.current) clearTimeout(settle.current);
    };
    // once on mount: choose and paint read the refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setOrbitV = (v: number): void => { angles.current.orbit = v; setOrbit(v); };
  const setTiltV = (v: number): void => { angles.current.tilt = v; setTilt(v); };
  const setZoomV = (v: number): void => { zoomRef.current = v; setZoom(v); };

  const setLevelV = (v: LevelChoice): void => { want.current.level = v; setLevel(v); paint('settled'); };
  const setColorV = (v: CapsidColor): void => { want.current.colorBy = v; setColorBy(v); paint('settled'); };
  const setAoV = (v: boolean): void => { want.current.ao = v; setAo(v); paint('settled'); };

  /** Tap a sphere: its chain copy turns teal and is named; tap the
   *  background to let go. */
  const { onOrbitDown, onOrbitMove, onOrbitUp } = useOrbitPointer({
    angles, setOrbit: setOrbitV, setTilt: setTiltV, queueOrbit: queueMove,
    zoom: { get: () => zoomRef.current, set: setZoomV, min: ZOOM_MIN, max: ZOOM_MAX },
    onTap: (x, y) => {
      const cv = canvasRef.current, c = loaded.current, fr = frame.current;
      if (!cv || !c || !fr) return;
      const r = cv.getBoundingClientRect();
      const px = Math.floor((x - r.left) * (W / r.width)), py = Math.floor((y - r.top) * (H / r.height));
      const i = px >= 0 && py >= 0 && px < W && py < H ? fr.f.id[py * W + px]! : -1;
      const l = c.asm[fr.level];
      const next = i < 0 ? null : { copy: l.points.copy[i]!, atom: l.atomOf[i]!, level: fr.level };
      want.current.pickCopy = next ? next.copy : NO_PICK;
      setPick(next);
      paint('settled');
    },
  });

  const wheel = (e: React.WheelEvent): void => {
    e.preventDefault();
    setZoomV(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    queueMove();
  };

  const e = capsid?.entry;
  const pickText = ((): string => {
    if (!capsid || !pick) return 'tap a subunit';
    const u = capsid.unit, cp = capsid.asm.copies[pick.copy]!;
    const entity = u.entities.get(u.asymEntity[cp.asym]!) ?? '';
    const where = pick.level === 'chains' ? ''
      : u.residue[pick.atom]! >= 0 ? ` · ${u.comp[pick.atom]} ${u.seq[pick.atom]}` : ` · ${u.comp[pick.atom]}`;
    return `chain ${cp.label} · ${entity}${where} · operator ${cp.ops.join('×')} of ${capsid.entry.operators}`;
  })();

  return (
    <>
      <div className="view-title" id="title-capsid">
        <h1>Capsid</h1>
        <p>{e ? `${e.name} · ${e.lattice} · ${e.pdbId}` : 'a whole virus shell from its asymmetric unit'}</p>
      </div>
      <div className="dock" id="dock-capsid">
        {modeSwitch}
        <div className="sep" />
        <div className="grp">
          <span className="lbl">Capsid</span>
          <DarkSelect id="capsid-entry" value={key} ariaLabel="Capsid structure"
            title="Icosahedral virus capsids from the PDB (CC0), expanded from their asymmetric units"
            onChange={(v) => { if (index) choose(index, v); }}>
            {(index?.entries ?? []).map((x) => (
              <option key={x.key} value={x.key}>{x.pdbId} · {x.name} · {(x.atoms / 1000).toFixed(0)} k atoms</option>
            ))}
          </DarkSelect>
        </div>
        <div className="grp">
          <span className="lbl">Level</span>
          <Seg<LevelChoice> id="capsid-level" dataKey="capsid-level" ariaLabel="Level of detail" value={level} onChange={setLevelV}
            options={[
              { value: 'auto', label: 'Auto', title: 'Residue beads while turning, atoms once it settles' },
              { value: 'atoms', label: 'Atoms', title: 'Every atom (ligands and waters too)' },
              { value: 'residues', label: 'Residues', title: 'A bead per polymer residue, at its atoms\' volume' },
              { value: 'chains', label: 'Chains', title: 'A bead per protein chain: the capsomers at a glance' },
            ]} />
        </div>
        <div className="grp">
          <span className="lbl">Color</span>
          <DarkSelect id="capsid-color" value={colorBy} ariaLabel="Capsid colour"
            title="Chain: each position in the asymmetric unit (all its copies alike); radius: inner to outer surface"
            onChange={(v) => setColorV(v as CapsidColor)}>
            <option value="chain">chain position</option>
            <option value="radius">radius</option>
            <option value="element">element</option>
          </DarkSelect>
        </div>
        <Switch checked={ao} label="Occlusion" onChange={setAoV} />
        <div className="sep" />
        <SliderRow label="Orbit" min={0} max={6.283} step={0.01} value={orbit} onInput={(v) => { setOrbitV(v); queueMove(); }} />
        <SliderRow label="Tilt" min={-1.2} max={1.2} step={0.01} value={tilt} onInput={(v) => { setTiltV(v); queueMove(); }} />
        <SliderRow id="capsid-zoom" label="Zoom" min={ZOOM_MIN} max={ZOOM_MAX} step={0.05} value={zoom} onInput={(v) => { setZoomV(v); queueMove(); }} />
        <div className="grp">
          <Chip><span id="ro-capsid">{loading || (e && settled
            ? `${e.atoms.toLocaleString()} atoms · ${e.chains} chains · settled: ${LEVEL_LABEL[settled.level]} ${settled.count.toLocaleString()} in ${Math.round(settled.ms)} ms`
              + (moving ? ` · turning: ${LEVEL_LABEL[moving.level]} ${moving.count.toLocaleString()} in ${Math.round(moving.ms)} ms` : '')
            : '')}</span></Chip>
        </div>
      </div>
      <div id="view-capsid" className="panes" data-testid="capsid">
        <div className="pane">
          <div className="pane-head">
            <span className="name">Assembly</span>
            <Chip><span id="ro-capsid-pick">{pickText}</span></Chip>
          </div>
          <div className="stage">
            <canvas id="c-capsid" ref={canvasRef} width={W} height={H}
              role="img" aria-label="Virus capsid assembly rendering (education overlay)"
              onPointerDown={onOrbitDown} onPointerMove={onOrbitMove} onPointerUp={onOrbitUp} onPointerCancel={onOrbitUp}
              onWheel={wheel} />
          </div>
          <div className="hint" id="capsid-src">{e && index
            ? `${index.attribution} · ${e.pdbId} (${e.organism || e.name}, revision ${e.revision}${e.resolutionA ? `, ${e.resolutionA} Å` : ''}): assembly ${e.assemblyId}, ${e.assemblyDetails}, ${e.operators} operators; within ${e.maxDeviationA.toFixed(4)} Å of RCSB's own assembly · ${e.citation}`
            : 'Protein Data Bank (CC0)'}</div>
        </div>
      </div>
    </>
  );
}
