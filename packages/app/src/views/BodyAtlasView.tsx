// The whole-body atlas (H2, docs/PHASES.md): BodyParts3D's 2,234 structures
// and the HRA organs placed among them (H3) by body system on the CPU
// rasterizer. Systems switch on and off, a drag
// orbits (a clustered copy at half size while moving, the full mesh
// anti-aliased once it settles), a tap names the structure, a search
// isolates and frames it, a structure hides. A system can be made
// see-through (H4): nerves and vessels show inside muscle and skin, and a
// tap reaches through it. A pose bends the joints (H5): bones rigid, the
// rest skinned to them, rig and weights fetched with the first pose.
// Education pixels only (badged).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type React from 'react';
import {
  assembleScene, clusterScene, frameParts, pickSurface, POSE_DOF, POSE_JOINTS, poseMesh, renderMesh, sceneAlpha, sceneColors,
  sceneDims, segmentTransforms, type BodyScene, type BodySystem, type Pose, type PoseJoint, type ScenePart, type SkinWeights,
} from '@carys/render-cpu';
import { conceptsOfElement, findBodyStructures, TERMS_DIGEST_ID, TERMS_DIGEST_PIN, type BodyRow } from '@carys/volume-core';
import { EDUCATION_BADGE } from '@carys/study';
import { ensureTerms } from '../lib/atlasTerms';
import {
  BODY_DIGEST_ID, HRA_DIGEST_ID, hraOrganOf, loadBodyAtlas, loadBodySystem, type BodyAtlas,
} from '../lib/bodyAtlas';
import { loadBodyRig, loadRigWeights, RIG_DIGEST_ID, type BodyRig } from '../lib/bodyRig';
import { BODY_BG, BODY_PICK_COLOR, BODY_SYSTEM_COLORS, bodyCss } from '../lib/palette';
import { session } from '../lib/session';
import { setAmbientStatus, setStatus } from '../lib/status';
import { bump } from '../lib/version';
import { Chip, DarkSelect, IconBtn, SliderRow, Switch } from '../ui/primitives';
import { useOrbitPointer } from './orbitPointer';

type V3 = [number, number, number];

const W = 480, H = 800;
/** Zoom 1 fits the body's height to the frame: renderMesh fits the box's
 *  longest side (the height) to 0.92 of the shorter side (the width). */
const FIT = (0.96 * H) / (0.92 * W);
/** Frames drawn while the view moves: this fraction of the size, one sample
 *  a pixel, on a copy clustered to cells of about this many of their pixels
 *  (8 mm at zoom 1: 719 k of the full body's 1.94 M triangles, no holes).
 *  Their cost is mostly the fill of every layer the body stacks, which only
 *  the smaller frame cuts; coarser cells gain nothing more. */
const ORBIT_SCALE = 0.5;
const ORBIT_CELL_PX = 2;
/** Idle after the last move before the full frame (ms). */
const ORBIT_SETTLE_MS = 250;
const ZOOM_MIN = 0.5, ZOOM_MAX = 40;
/** The finest clustering cell (mm): below it the copy is the mesh. */
const CELL_MIN_MM = 0.25;

const SYSTEM_LABEL: Record<BodySystem, string> = {
  skeletal: 'Skeletal', muscular: 'Muscular', nervous: 'Nervous', cardiovascular: 'Cardiovascular',
  lymphatic: 'Lymphatic', respiratory: 'Respiratory', digestive: 'Digestive', urinary: 'Urinary',
  reproductive: 'Reproductive', endocrine: 'Endocrine', sensory: 'Sensory', integumentary: 'Skin', other: 'Other',
};
/** Shown on open: all but the layers that cover the rest (muscle, skin). */
const OPEN_SYSTEMS: readonly BodySystem[] = [
  'skeletal', 'nervous', 'cardiovascular', 'respiratory', 'digestive', 'urinary',
  'reproductive', 'endocrine', 'lymphatic', 'sensory',
];
/** The system the see-through slider starts on: the one that covers most. */
const SEE_FIRST: BodySystem = 'muscular';
const OPACITY_MIN = 0.1;
type Opacities = Partial<Record<BodySystem, number>>;
/** A pose slider's idle time before the body is posed and drawn (ms): a
 *  pose moves every vertex, so it is not redrawn per step of a drag. */
const POSE_SETTLE_MS = 150;
/** The pose sliders' ranges, degrees: flexion, abduction, twist. */
const POSE_RANGE: readonly [number, number][] = [[-90, 150], [-60, 180], [-90, 90]];
const POSE_LABEL = ['Flex', 'Abduct', 'Twist'] as const;
const DEG = Math.PI / 180;
const isRest = (p: Pose): boolean => Object.values(p).every((a) => a.every((v) => v === 0));

interface Picked {
  part: ScenePart;
  /** the K1 concepts it is part of, smallest first */
  within: string[];
}
interface Frame { ms: number; tris: number }
interface Scene {
  full: BodyScene;
  colors: Uint8Array;
  /** per triangle, when a shown system is see-through */
  alpha: Float32Array | null;
  /** the clustered copy for moving frames, made on the first one */
  lod: { cell: number; scene: BodyScene; colors: Uint8Array; alpha: Float32Array | null } | null;
}

/** The clustering cell for a moving frame: ORBIT_CELL_PX of its pixels,
 *  a power of two so zooming a little reuses the copy. */
function lodCell(dims: V3, w: number, h: number, zoom: number): number {
  const mm = (ORBIT_CELL_PX * Math.max(...dims)) / (Math.min(w, h) * 0.92 * zoom);
  return Math.max(CELL_MIN_MM, 2 ** Math.round(Math.log2(mm)));
}

/** What a tap found: name and FMA id, what it is part of, its system, where
 *  it comes from and how its shipped mesh compares with the source. */
function BodyCard({ picked, atlas }: { picked: Picked; atlas: BodyAtlas }): JSX.Element {
  const p = picked.part;
  const hra = hraOrganOf(atlas, p.element);
  return (
    <dl className="kv" id="body-card" aria-label={`Structure: ${p.name}`}>
      <div className="mrow"><dt>{p.name}</dt><dd>{p.fma}</dd></div>
      <div className="mrow"><dt>part of</dt><dd id="body-card-within">{picked.within.length ? picked.within.join(' › ') : '— (in no PART-OF tree)'}</dd></div>
      <div className="mrow"><dt>system</dt><dd>{SYSTEM_LABEL[p.system]}</dd></div>
      <div className="mrow"><dt>source</dt><dd id="body-card-source">{hra
        ? `${hra.organ.citation} CC BY 4.0. Placed from the Visible Human male by a fit on ${atlas.hra.anchors} organs both bodies have: an organ placed that way lands ${atlas.hra.looMedianMm} mm from its match (median).`
        : `${atlas.indexes[BODY_DIGEST_ID].attribution} (${atlas.indexes[BODY_DIGEST_ID].pin})`}</dd></div>
      <div className="mrow"><dt>mesh</dt><dd>{p.element} · {(p.indices.length / 3).toLocaleString()} of {p.sourceTris.toLocaleString()} tris · within {p.errorMm.toFixed(2)} mm</dd></div>
    </dl>
  );
}

export function BodyAtlasView({ modeSwitch }: { modeSwitch: ReactNode }): JSX.Element {
  const [idx, setIdx] = useState<BodyAtlas | null>(null);
  const [on, setOn] = useState<ReadonlySet<BodySystem>>(() => new Set(OPEN_SYSTEMS));
  const [loading, setLoading] = useState('');
  const [orbit, setOrbit] = useState(0);
  const [tilt, setTilt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [hidden, setHidden] = useState(0);
  const [isolate, setIsolate] = useState<{ label: string; count: number } | null>(null);
  const [query, setQuery] = useState('');
  const [settled, setSettled] = useState<Frame | null>(null);
  const [moving, setMoving] = useState<Frame | null>(null);
  const [err, setErr] = useState('');
  const [see, setSee] = useState<Opacities>({});
  const [seeSys, setSeeSys] = useState<BodySystem>(SEE_FIRST);
  const [pose, setPose] = useState<Pose>({});
  const [poseJoint, setPoseJoint] = useState<PoseJoint>('left knee');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const idxRef = useRef<BodyAtlas | null>(null);
  /** every loaded part, systems appended as they arrive, and where each is */
  const parts = useRef<ScenePart[]>([]);
  const at = useRef(new Map<string, number>());
  const loaded = useRef(new Set<BodySystem>());
  const scene = useRef<Scene | null>(null);
  /** what should show: the latest, whatever load is still in flight */
  const want = useRef({
    on: new Set(OPEN_SYSTEMS) as ReadonlySet<BodySystem>, hidden: new Set<string>() as ReadonlySet<string>,
    isolate: null as ReadonlySet<string> | null, pick: null as string | null, see: {} as Opacities, pose: {} as Pose,
  });
  /** the rig and the skin weights of the loaded systems, once a pose is set */
  const rigRef = useRef<BodyRig | null>(null);
  const skin = useRef(new Map<string, SkinWeights>());
  const skinned = useRef(new Set<BodySystem>());
  /** the parts posed (same order as `parts`), null at rest */
  const posed = useRef<ScenePart[] | null>(null);
  const poseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const angles = useRef({ orbit: 0, tilt: 0 });
  const zoomRef = useRef(1);
  const centerRef = useRef<V3 | null>(null);
  const raf = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rows = useMemo<BodyRow[]>(() => (idx ? idx.parts.map(([element, fma, name, system]) => ({ element, fma, name, system })) : []), [idx]);

  const colorOf = (i: number): readonly [number, number, number] => {
    const p = parts.current[i]!;
    return p.element === want.current.pick ? BODY_PICK_COLOR : BODY_SYSTEM_COLORS[p.system];
  };
  const alphaOf = (i: number): number => want.current.see[parts.current[i]!.system] ?? 1;

  const viewOf = (w: number, h: number): { width: number; height: number; angleY: number; tiltX: number; zoom: number; center?: V3 } => ({
    width: w, height: h, angleY: angles.current.orbit, tiltX: angles.current.tilt,
    zoom: FIT * zoomRef.current, center: centerRef.current ?? undefined,
  });

  const build = (): void => {
    const w = want.current, P = posed.current ?? parts.current;
    const full = assembleScene(P, (i) => {
      const p = P[i]!;
      return w.on.has(p.system) && !w.hidden.has(p.element) && (!w.isolate || w.isolate.has(p.element));
    });
    scene.current = { full, colors: sceneColors(full, colorOf), alpha: sceneAlpha(full, alphaOf), lod: null };
  };

  const recolor = (): void => {
    const s = scene.current;
    if (!s) return;
    s.colors = sceneColors(s.full, colorOf);
    if (s.lod) s.lod.colors = sceneColors(s.lod.scene, colorOf);
  };

  const realpha = (): void => {
    const s = scene.current;
    if (!s) return;
    s.alpha = sceneAlpha(s.full, alphaOf);
    if (s.lod) s.lod.alpha = sceneAlpha(s.lod.scene, alphaOf);
  };

  const paint = (kind: 'settled' | 'moving'): void => {
    const cv = canvasRef.current, s = scene.current, ix = idxRef.current;
    if (!cv || !s || !ix) return;
    const dims = sceneDims(ix);
    const g = cv.getContext('2d')!;
    if (kind === 'settled') {
      const t0 = performance.now();
      const px = renderMesh(s.full.mesh, dims, {
        ...viewOf(W, H), color: BODY_SYSTEM_COLORS.skeletal, bg: BODY_BG, triColor: s.colors, triAlpha: s.alpha ?? undefined,
      });
      g.putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
      setSettled({ ms: performance.now() - t0, tris: s.full.triPart.length });
      return;
    }
    const w = Math.round(W * ORBIT_SCALE), h = Math.round(H * ORBIT_SCALE);
    const cell = lodCell(dims, w, h, FIT * zoomRef.current);
    if (!s.lod || s.lod.cell !== cell) {
      const lod = clusterScene(s.full, cell);
      s.lod = { cell, scene: lod, colors: sceneColors(lod, colorOf), alpha: sceneAlpha(lod, alphaOf) };
    }
    const t0 = performance.now();
    const px = renderMesh(s.lod.scene.mesh, dims, {
      ...viewOf(w, h), color: BODY_SYSTEM_COLORS.skeletal, bg: BODY_BG, triColor: s.lod.colors, triAlpha: s.lod.alpha ?? undefined, supersample: 1,
    });
    const off = (offRef.current ??= document.createElement('canvas'));
    off.width = w; off.height = h;
    off.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
    g.drawImage(off, 0, 0, W, H);
    setMoving({ ms: performance.now() - t0, tris: s.lod.scene.triPart.length });
  };

  /** Every loaded part posed as `want.pose` says (the rig and the weights
   *  fetched first), or none at rest: the parts as loaded, drawn as in H2. */
  const posePartsNow = async (ix: BodyAtlas): Promise<void> => {
    const p = want.current.pose;
    if (isRest(p)) { posed.current = null; return; }
    if (!rigRef.current) {
      rigRef.current = await loadBodyRig(ix);
      session.digestPins = { ...session.digestPins, [RIG_DIGEST_ID]: rigRef.current.pin };
    }
    const r = rigRef.current;
    const need = [...loaded.current].filter((s) => !skinned.current.has(s));
    if (need.length) {
      setLoading(`loading the rig for ${need.map((s) => SYSTEM_LABEL[s].toLowerCase()).join(', ')}…`);
      try {
        const got = await Promise.all(need.map((s) => loadRigWeights(r, s)));
        need.forEach((s, k) => { skinned.current.add(s); for (const [e, w] of got[k]!) skin.current.set(e, w); });
      } finally {
        setLoading('');
      }
    }
    if (want.current.pose !== p) return; // a newer pose is on its way
    const T = segmentTransforms(r.rig, p);
    posed.current = parts.current.map((part) => {
      const bind = r.bones.get(part.element) ?? skin.current.get(part.element);
      if (bind === undefined) throw new Error(`${part.name} (${part.element}) is in no rig segment and has no weights`);
      const m = poseMesh(part.positions, part.normals, T, bind);
      return m.positions === part.positions ? part : { ...part, positions: m.positions, normals: m.normals };
    });
  };

  /** Fetch what the shown systems need, pose, then frame (on a find),
   *  rebuild and paint. */
  const sync = async (frame = false): Promise<void> => {
    const ix = idxRef.current;
    if (!ix) return;
    const missing = [...want.current.on].filter((s) => !loaded.current.has(s) && ix.systems[s]);
    if (missing.length) {
      setLoading(`loading ${missing.map((s) => SYSTEM_LABEL[s].toLowerCase()).join(', ')}…`);
      try {
        const got = await Promise.all(missing.map((s) => loadBodySystem(ix, s)));
        missing.forEach((s, k) => {
          if (loaded.current.has(s)) return;
          loaded.current.add(s);
          for (const p of got[k]!) { at.current.set(p.element, parts.current.length); parts.current.push(p); }
        });
      } catch (e) {
        setErr((e as Error).message);
        setStatus(`body atlas failed: ${(e as Error).message}`, 'error');
        return;
      } finally {
        setLoading('');
      }
    }
    try {
      await posePartsNow(ix);
    } catch (e) {
      setErr((e as Error).message);
      setStatus(`body pose failed: ${(e as Error).message}`, 'error');
      return;
    }
    const iso = want.current.isolate;
    if (frame && iso) {
      const f = frameParts(posed.current ?? parts.current, [...iso].map((e) => at.current.get(e)!), sceneDims(ix));
      if (f) {
        centerRef.current = f.center;
        zoomRef.current = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, f.zoom / FIT));
        setZoom(zoomRef.current);
      }
    }
    setErr('');
    build();
    paint('settled');
  };

  useEffect(() => {
    bump();
    let live = true;
    void (async () => {
      try {
        const [ix] = await Promise.all([loadBodyAtlas(), ensureTerms()]);
        if (!live) return;
        idxRef.current = ix;
        setIdx(ix);
        session.digestPins = {
          [BODY_DIGEST_ID]: ix.indexes[BODY_DIGEST_ID].pin, [HRA_DIGEST_ID]: ix.indexes[HRA_DIGEST_ID].pin, [TERMS_DIGEST_ID]: TERMS_DIGEST_PIN,
        };
        await sync();
      } catch (e) {
        setErr((e as Error).message);
        setStatus(`body atlas failed: ${(e as Error).message}`, 'error');
      }
    })();
    return () => {
      live = false;
      if (settle.current) clearTimeout(settle.current);
      if (poseTimer.current) clearTimeout(poseTimer.current);
    };
    // once on mount: sync reads the refs, which hold the latest state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const queueMove = (): void => {
    if (!raf.current) {
      raf.current = true;
      requestAnimationFrame(() => { raf.current = false; paint('moving'); });
    }
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => { settle.current = null; paint('settled'); }, ORBIT_SETTLE_MS);
  };

  const setOrbitV = (v: number): void => { angles.current.orbit = v; setOrbit(v); };
  const setTiltV = (v: number): void => { angles.current.tilt = v; setTilt(v); };
  const setZoomV = (v: number): void => { zoomRef.current = v; setZoom(v); };

  const choose = (p: ScenePart | null): void => {
    want.current.pick = p?.element ?? null;
    setPicked(p ? { part: p, within: conceptsOfElement(p.element, p.fma).map((t) => t.name) } : null);
    if (p) setAmbientStatus(`${p.name} · ${p.fma} · ${SYSTEM_LABEL[p.system]} · ${EDUCATION_BADGE}`);
    recolor();
    paint('settled');
  };

  const { onOrbitDown, onOrbitMove, onOrbitUp } = useOrbitPointer({
    angles, setOrbit: setOrbitV, setTilt: setTiltV, queueOrbit: queueMove,
    zoom: { get: () => zoomRef.current, set: setZoomV, min: ZOOM_MIN, max: ZOOM_MAX },
    onTap: (x, y) => {
      const cv = canvasRef.current, s = scene.current, ix = idxRef.current;
      if (!cv || !s || !ix) return;
      const r = cv.getBoundingClientRect();
      const view = { ...viewOf(W, H), triAlpha: s.alpha ?? undefined };
      const hit = pickSurface(s.full.mesh, sceneDims(ix), view, (x - r.left) * (W / r.width), (y - r.top) * (H / r.height));
      choose(hit?.tri !== undefined ? parts.current[s.full.triPart[hit.tri]!]! : null);
    },
  });

  const wheel = (e: React.WheelEvent): void => {
    e.preventDefault();
    setZoomV(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    queueMove();
  };

  const toggle = (s: BodySystem, v: boolean): void => {
    const next = new Set(want.current.on);
    if (v) next.add(s); else next.delete(s);
    want.current.on = next;
    setOn(next);
    void sync();
  };

  /** A system's opacity: redrawn as a moving frame while the slider slides,
   *  then settled. */
  const setOpacity = (s: BodySystem, v: number): void => {
    const next = { ...want.current.see };
    if (v < 1) next[s] = v; else delete next[s];
    want.current.see = next;
    setSee(next);
    realpha();
    queueMove();
  };

  /** One angle of the chosen joint (degrees); the body is posed and drawn
   *  once the slider rests. */
  const setAngle = (k: 0 | 1 | 2, deg: number): void => {
    const a = [...(want.current.pose[poseJoint] ?? [0, 0, 0])] as [number, number, number];
    a[k] = deg * DEG;
    const next = { ...want.current.pose, [poseJoint]: a };
    if (a.every((v) => v === 0)) delete next[poseJoint];
    want.current.pose = next;
    setPose(next);
    if (poseTimer.current) clearTimeout(poseTimer.current);
    poseTimer.current = setTimeout(() => { poseTimer.current = null; void sync(); }, POSE_SETTLE_MS);
  };

  const restPose = (): void => {
    want.current.pose = {};
    setPose({});
    void sync();
  };

  const hide = (): void => {
    const p = want.current.pick;
    if (!p) return;
    want.current.hidden = new Set([...want.current.hidden, p]);
    setHidden(want.current.hidden.size);
    want.current.pick = null;
    setPicked(null);
    void sync();
  };

  const showAll = (): void => {
    want.current.hidden = new Set();
    want.current.isolate = null;
    setHidden(0);
    setIsolate(null);
    centerRef.current = null;
    setZoomV(1);
    void sync();
  };

  const find = (): void => {
    const found = findBodyStructures(rows, query);
    if (!found) {
      setStatus(`no body structures match "${query}"`);
      return;
    }
    const system = new Map(rows.map((r) => [r.element, r.system as BodySystem]));
    const next = new Set(want.current.on);
    for (const e of found.elements) next.add(system.get(e)!);
    want.current.on = next;
    setOn(next);
    want.current.isolate = new Set(found.elements);
    setIsolate({ label: found.label, count: found.elements.length });
    want.current.pick = null;
    setPicked(null);
    setStatus(`${found.label} · ${found.elements.length} structure(s) isolated · ${EDUCATION_BADGE}`);
    void sync(true);
  };

  const systems = idx ? (Object.keys(idx.systems) as BodySystem[]) : [];
  const p = picked?.part;
  return (
    <>
      <div className="view-title" id="title-atlas">
        <h1>Atlas</h1>
        <p>Whole body: BodyParts3D and HRA organs ({idx ? idx.parts.length.toLocaleString() : '…'} structures, {systems.length} systems) · FMA terms · {EDUCATION_BADGE}</p>
      </div>
      <div className="dock" id="dock-body">
        {modeSwitch}
        <div className="sep" />
        {systems.map((s) => (
          <div className="grp" key={s}>
            <span className="lblswatch" style={{ background: bodyCss(s) }} aria-hidden="true" />
            <Switch checked={on.has(s)} label={`${SYSTEM_LABEL[s]} ${idx!.systems[s]}`} onChange={(v) => toggle(s, v)} />
          </div>
        ))}
        <div className="sep" />
        <div className="grp">
          <span className="lbl">See-through</span>
          <DarkSelect id="body-see-system" value={seeSys} onChange={(v) => setSeeSys(v as BodySystem)}
            title="The system the opacity slider sets">
            {systems.map((s) => <option key={s} value={s}>{SYSTEM_LABEL[s]}</option>)}
          </DarkSelect>
        </div>
        <SliderRow id="body-opacity" label="Opacity" min={OPACITY_MIN} max={1} step={0.05} value={see[seeSys] ?? 1}
          onInput={(v) => setOpacity(seeSys, v)} />
        <div className="sep" />
        <div className="grp">
          <span className="lbl">Pose</span>
          <DarkSelect id="body-pose-joint" value={poseJoint} onChange={(v) => setPoseJoint(v as PoseJoint)}
            title="The joint the pose sliders bend: centres fitted from the bones">
            {POSE_JOINTS.map((j) => <option key={j} value={j}>{j}</option>)}
          </DarkSelect>
          <IconBtn id="body-pose-rest" title="Back to the rest pose (the anatomical position)" onClick={restPose}>Rest</IconBtn>
        </div>
        {POSE_LABEL.slice(0, POSE_DOF[poseJoint]).map((label, k) => (
          <SliderRow key={`${poseJoint}-${label}`} id={`body-pose-${label.toLowerCase()}`} label={label}
            min={POSE_RANGE[k]![0]} max={POSE_RANGE[k]![1]} step={1}
            value={Math.round((pose[poseJoint]?.[k] ?? 0) / DEG)} onInput={(v) => setAngle(k as 0 | 1 | 2, v)} />
        ))}
        <div className="sep" />
        <div className="grp">
          <span className="lbl">Find</span>
          <input id="body-search" className="urlinput" value={query} placeholder="heart, liver, FMA7088…"
            title="Find a structure by name, FMA id or element id: it is isolated and framed"
            aria-label="Find a body structure"
            onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') find(); }} />
          <IconBtn title="Find a body structure" onClick={find}>Go</IconBtn>
        </div>
        {isolate && (
          <div className="grp">
            <Chip><span id="ro-body-find">{isolate.label} · {isolate.count} isolated</span></Chip>
          </div>
        )}
        <div className="grp">
          <IconBtn id="body-hide" title="Hide the tapped structure" onClick={hide}>Hide</IconBtn>
          <IconBtn id="body-show-all" title="Show every structure of the shown systems again, whole body framed" onClick={showAll}>Show all</IconBtn>
        </div>
        <div className="sep" />
        <SliderRow label="Orbit" min={0} max={6.283} step={0.01} value={orbit} onInput={(v) => { setOrbitV(v); queueMove(); }} />
        <SliderRow label="Tilt" min={-1.2} max={1.2} step={0.01} value={tilt} onInput={(v) => { setTiltV(v); queueMove(); }} />
        <SliderRow label="Zoom" min={ZOOM_MIN} max={ZOOM_MAX} step={0.05} value={zoom} onInput={(v) => { setZoomV(v); queueMove(); }} />
        <div className="grp">
          <Chip><span id="ro-body">{err ? `body atlas error: ${err}` : loading || (settled
            ? `${settled.tris.toLocaleString()} tris · settled ${Math.round(settled.ms)} ms`
              + (moving ? ` · moving ${Math.round(moving.ms)} ms at ${moving.tris.toLocaleString()} tris, half size` : '')
              + (hidden ? ` · ${hidden} hidden` : '')
              + (Object.keys(see).length ? ` · see-through ${(Object.entries(see) as [BodySystem, number][])
                .map(([s, v]) => `${SYSTEM_LABEL[s].toLowerCase()} ${Math.round(v * 100)}%`).join(', ')}` : '')
              + (isRest(pose) ? '' : ` · posed ${(Object.entries(pose) as [PoseJoint, readonly number[]][])
                .map(([j, a]) => `${j} ${a.slice(0, POSE_DOF[j]).map((v) => `${Math.round(v / DEG)}°`).join('/')}`).join(', ')}`)
            : 'loading…')}</span></Chip>
        </div>
      </div>
      <div id="view-atlas" className="panes" data-testid="atlas">
        <div className="pane">
          <div className="pane-head">
            <span className="name">Body</span>
            <Chip><span id="ro-body-part">{p ? `${p.name} · ${p.fma} · ${p.element} · ${SYSTEM_LABEL[p.system]}` : 'tap a structure'}</span></Chip>
          </div>
          <div className="stage">
            <canvas id="c-body" className="tall" ref={canvasRef} width={W} height={H}
              role="img" aria-label="Whole-body atlas rendering (education overlay)"
              onPointerDown={onOrbitDown} onPointerMove={onOrbitMove} onPointerUp={onOrbitUp} onPointerCancel={onOrbitUp}
              onWheel={wheel} />
          </div>
          {picked && idx && <BodyCard picked={picked} atlas={idx} />}
          <div className="hint" id="body-src">{idx ? `${idx.indexes[BODY_DIGEST_ID].attribution} · ${idx.indexes[BODY_DIGEST_ID].pin}` : 'BodyParts3D'}</div>
          <div className="hint" id="body-hra-src">{idx ? `${idx.indexes[HRA_DIGEST_ID].attribution} · ${idx.hra.organs.size} organs, cited on tap` : 'HRA'}</div>
        </div>
      </div>
    </>
  );
}
