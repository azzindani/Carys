import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { JSX } from 'react';
import { filterTracts, presetTF, renderMesh, TF_PRESETS, type TF, type TFPresetName } from '@carys/render-cpu';
import {
  presetRois, tractPresetById, TRACT_PRESETS,
} from '@carys/volume-core';
import { EDUCATION_BADGE } from '@carys/study';
import { SERIES } from '../lib/catalog';
import type { Extractor } from '../lib/extractor';
import { paintBus } from '../lib/paintBus';
import { FIBER_BG } from '../lib/palette';
import { maskBox, physicalMesh, toMm } from '../lib/physical3d';
import { session } from '../lib/session';
import { setEngineFromExtractor } from '../lib/sessionOps';
import { setAmbientStatus, setStatus } from '../lib/status';
import { getUi, setUi, useUi, useUiPick } from '../lib/store';
import { useIsMobile } from '../lib/isMobile';
import { bump, useVersion } from '../lib/version';
import { Chip, DarkSelect, IconBtn, Seg, SliderRow, Switch } from '../ui/primitives';
import { AxisGizmo } from '../ui/Icons';
import { ViewportOverlay } from '../ui/ViewportOverlay';
import type { Method, Render3D, Source } from '../lib/types';
import { TfEditor } from './TfEditor';
import { drawCursor3d, drawFibers } from './orbitOverlay';

/** Quiet time after the last orbit frame before the anti-aliased repaint. */
const ORBIT_SETTLE_MS = 160;

/** 3D viewport of the grid: surface/volume render + orbit tools. Bare mode
 *  skips the title (the file tabs head the combined viewer instead). */
export function SurfaceView({ extractor, bare }: { extractor: Extractor | null; bare?: boolean }): JSX.Element {
  const ui = useUi();
  const fullVp = useUiPick('fullVp');
  const ver = useVersion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [orbit, setOrbit] = useState(0.7);
  const [tilt, setTilt] = useState(0.3);
  const angles = useRef({ orbit: 0.7, tilt: 0.3 });
  angles.current = { orbit, tilt };
  const rafQueued = useRef(false);
  // orbit frames draw at 1× supersampling; this repaints at 2× once still
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (settleRef.current) clearTimeout(settleRef.current); }, []);
  const vrToken = useRef(0);
  // Mask-bbox center for 3D framing (keyed by series+src+mask version so a
  // stale center never follows a series switch or edit).
  const centerCache = useRef<{ key: string; c: [number, number, number] | null }>({ key: '', c: null });
  const maskCenter = (): [number, number, number] | null => {
    const img = session.img;
    const m = session.editMask;
    const u = getUi();
    if (!img || !m || u.src !== 'mask') return null;
    const key = `${u.series}|${u.src}|${session.maskVer}`;
    if (centerCache.current.key === key) return centerCache.current.c;
    const box = maskBox(m, img.dims, 7);
    const c: [number, number, number] | null = box
      ? [(box.min[0] + box.max[0] + 1) / 2, (box.min[1] + box.max[1] + 1) / 2, (box.min[2] + box.max[2] + 1) / 2]
      : null;
    centerCache.current = { key, c };
    return c;
  };
  // Volume-render state: TF stops, preset, density, quality. Local to 3D.
  const [tfPreset, setTfPreset] = useState<TFPresetName>('bone');
  const [tf, setTf] = useState<TF | null>(null);
  const [density, setDensity] = useState(1);
  const [quality, setQuality] = useState<'draft' | 'full'>('draft');
  const [shade, setShade] = useState(true);
  // N2 tract preset: picker id + last kept count (module-ephemeral like
  // cine flags — the filtered view is derived, never persisted chrome).
  const [presetId, setPresetId] = useState('');
  const [kept, setKept] = useState<number | null>(null);
  // Mobile keeps the 3D toolbar behind a disclosure so the viewport owns
  // the stage; desktop renders it open like before.
  const isMobile = useIsMobile();
  // In the grid (`bare`) the 3D pane is one of four viewports; its dock is
  // only relevant while that viewport is the one mobile is showing.
  const mView = useUiPick('mView');
  const mSheet = useUiPick('mSheet');
  const show3dTools = !bare || mView === 'v3d';
  // Mobile hosts this dock inside the control deck rather than above the
  // image. The slot only exists while the Display panel is open, so resolve
  // it after commit.
  const [deckSlot, setDeckSlot] = useState<HTMLElement | null>(null);
  const docksOpen = useUiPick('docksOpen');
  useEffect(() => {
    if (!bare) { setDeckSlot(null); return; }
    // Mobile: the control deck. Desktop: the toolbar strip. Either way the
    // dock stops stacking above the image and costing it height.
    setDeckSlot(document.getElementById(isMobile ? 'deck-3d' : 'dockslot-3d'));
  }, [isMobile, bare, mSheet, mView, docksOpen]);

  /** Data range of the current VR field (for preset construction). */
  const fieldRange = (): [number, number] => {
    const u = getUi();
    const f = u.src === 'mask' && session.editMask
      ? session.editMask
      : session.img?.data;
    if (!f) return [0, 1];
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < f.length; i += 37) {
      const v = f[i]!;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    return mn > mx ? [0, 1] : [mn, mx];
  };

  /** Mask ↔ image: each keeps its own cut, and the slider its own range. */
  const switchSource = (v: Source): void => {
    const t = session.thresholds;
    if (!t) { setUi({ src: v }); return; }
    t[getUi().src].value = getUi().threshold;
    session.autoThreshold = t[v].hint;
    setUi({ src: v, threshold: t[v].value });
  };

  const currentTF = (): TF => {
    if (tf) return tf;
    const [mn, mx] = fieldRange();
    return presetTF(tfPreset, mn, mx);
  };

  const paintVr = async (): Promise<void> => {
    const img = session.img;
    const cv = canvasRef.current;
    if (!img || !cv || !extractor) return;
    const u = getUi();
    const s0 = u.series;
    const pmine = session.paintToken;
    if (u.src === 'mask' && (!session.editMask || !session.editMask.some((v) => v > 0))) {
      cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height);
      setAmbientStatus('mask empty — paint in MPR or switch source to image');
      return;
    }
    const useMask = u.src === 'mask';
    const field = useMask ? Float64Array.from(session.editMask!) : img.data;
    // Tight padded bounds for mask fields: rays skip the empty 95%+.
    let bounds: { min: [number, number, number]; max: [number, number, number] } | null = null;
    const box = useMask && session.editMask ? maskBox(session.editMask, img.dims, 2) : null;
    if (box) {
      const [nx, ny, nz] = img.dims;
      bounds = {
        min: [Math.max(0, box.min[0] - 2), Math.max(0, box.min[1] - 2), Math.max(0, box.min[2] - 2)],
        max: [Math.min(nx, box.max[0] + 3), Math.min(ny, box.max[1] + 3), Math.min(nz, box.max[2] + 3)],
      };
    }
    const full = quality === 'full';
    const rw = full ? cv.width : Math.min(cv.width, 300);
    const rh = full ? cv.height : Math.round(cv.height * (rw / cv.width));
    const mine = ++vrToken.current;
    setAmbientStatus('raycasting…');
    await new Promise((r) => setTimeout(r, 10));
    try {
      const r = await extractor.renderVr(field, img.dims, {
        w: rw, h: rh,
        angleY: angles.current.orbit, tiltX: angles.current.tilt,
        zoom: session.zoom3d, tf: currentTF(),
        step: full ? 1.5 : 3, shade, density, bounds,
        // in mm, like the surface: a 5 mm-slice CT is not a fifth of its height
        spacing: img.spacing ?? [1, 1, 1],
      });
      if (mine !== vrToken.current || pmine !== session.paintToken || getUi().series !== s0) return;
      const ctx = cv.getContext('2d')!;
      if (full) {
        ctx.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.w, r.h), 0, 0);
      } else {
        const tmp = document.createElement('canvas');
        tmp.width = r.w; tmp.height = r.h;
        tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.w, r.h), 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(tmp, 0, 0, cv.width, cv.height);
      }
      setEngineFromExtractor();
      const ro = document.getElementById('ro-3d');
      if (ro) ro.textContent = `VR ${r.w}×${r.h} · ${(r.ms / 1000).toFixed(1)}s`;
      const zchip = document.getElementById('zoom3d');
      if (zchip) zchip.textContent = `${Math.round(session.zoom3d * 100)}%`;
      setAmbientStatus(`VR ${r.w}×${r.h} · ${(r.ms / 1000).toFixed(1)}s via ${extractor.usedWorker ? 'worker' : 'main thread'} · ${u.series}`);
    } catch (e) {
      if (mine !== vrToken.current) return;
      setStatus(`VR failed: ${(e as Error).message}`, 'error');
    }
  };

  const repaint3d = (): void => {
    if (getUi().render3d === 'volume') void paintVr();
    else void paint3d();
  };

  /** Surface + overlays at the current orbit. `ss` 1 while the view is
   *  moving (a quarter of the fill), 2 once it settles (anti-aliased). */
  const paintOrbit = (ss: 1 | 2 = 2): void => {
    const cv = canvasRef.current;
    if (!cv || !session.img || (!session.mesh && !session.fibers)) return;
    // The canvas belongs to the raycaster in volume mode: a surface drawn
    // here (a late extraction, a zoom reset) used to replace the render.
    if (getUi().render3d === 'volume') return;
    const ctx = cv.getContext('2d')!;
    // Everything below is drawn in mm (lib/physical3d.ts): the box, the
    // mesh, the fibres, the cursor and the orbit centre share one scale.
    const sp = session.img.spacing ?? [1, 1, 1];
    const box = toMm(session.img.dims, sp);
    const mc0 = maskCenter();
    const view = {
      width: cv.width, height: cv.height, angleY: angles.current.orbit, tiltX: angles.current.tilt,
      zoom: session.zoom3d, center: mc0 ? toMm(mc0, sp) : undefined,
    };
    if (session.mesh) {
      const out = renderMesh(physicalMesh(session.mesh, sp), box, {
        ...view, color: SERIES[getUi().series]?.color ?? [225, 215, 200], supersample: ss,
      });
      ctx.putImageData(new ImageData(new Uint8ClampedArray(out), cv.width, cv.height), 0, 0);
    } else {
      ctx.fillStyle = FIBER_BG;
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
    // same rotation centre as the mesh, or fibres and cursor drift off it
    if (session.fibers) drawFibers(ctx, session.fibers, sp, box, view);
    const ch = session.crosshair;
    if (ch && getUi().sync) drawCursor3d(ctx, [ch[0], ch[1], ch[2]], sp, box, view);
    const z = document.getElementById('zoom3d');
    if (z) z.textContent = `${Math.round(session.zoom3d * 100)}%`;
    const ro = document.getElementById('ro-3d');
    if (ro) {
      const tris = session.mesh?.tris ? `${session.mesh.tris.toLocaleString()} tris · ` : '';
      const n = session.fibers?.count ?? 0;
      const fib = n > 0 ? `${n.toLocaleString()} tract${n === 1 ? '' : 's'} · ` : '';
      const scal = session.fibers?.scalarName ? `scal ${session.fibers.scalarName} · ` : '';
      ro.textContent = `${tris}${fib}${scal}${Math.round(session.zoom3d * 100)}%`;
    }
  };

  const paint3d = async (): Promise<void> => {
    const img = session.img;
    const cv = canvasRef.current;
    if (!img || !cv || !extractor) return;
    // Any new 3D paint invalidates in-flight extraction/VR before it.
    session.paintToken++;
    if (session.meshPinned || session.fibersPinned) {
      // Pinned imports are the whole scene: a tract-only import shows the
      // tracts, not whatever surface the idle pre-extraction left behind.
      session.mesh = session.meshPinned;
      if (session.fibersPinned) session.fibers = session.fibersPinned;
      paintOrbit();
      const parts: string[] = [];
      if (session.meshPinned) parts.push(`${session.meshPinned.tris.toLocaleString()} tris (imported mesh)`);
      if (session.fibersPinned) {
        const n = session.fibersPinned.count;
        parts.push(`${n.toLocaleString()} tract${n === 1 ? '' : 's'} (imported TCK)`);
      }
      setAmbientStatus(`${parts.join(' + ')} · ${getUi().series}`);
      return;
    }
    const u = getUi();
    const s0 = u.series;
    if (u.src === 'mask' && (!session.editMask || !session.editMask.some((v) => v > 0))) {
      session.mesh = null;
      cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height);
      setAmbientStatus('mask empty — paint in MPR or switch source to image');
      const ro = document.getElementById('ro-3d');
      if (ro) ro.textContent = 'empty mask';
      return;
    }
    const field = u.src === 'mask' ? session.editMask! : img.data;
    const key = session.meshKey(u.series, u.src, u.threshold, u.method, u.smooth3d);
    const hit = session.getMesh(key);
    if (hit) {
      session.mesh = hit;
      setAmbientStatus(`${hit.tris.toLocaleString()} tris (cached) · ${u.series}`);
    } else {
      setAmbientStatus('extracting…');
      if (!session.mesh) {
        // A new series has no surface yet: say so on the pane rather than
        // leave the previous series' surface standing under this one's name.
        cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height);
        const ro = document.getElementById('ro-3d');
        if (ro) ro.textContent = 'extracting…';
      }
      await new Promise((r) => setTimeout(r, 10));
      const mine = ++session.paintToken;
      const mesh = await session.meshOnce(key, () => extractor.extract(field, img.dims, u.threshold, u.method === 'smooth', u.smooth3d, img.spacing));
      if (mine !== session.paintToken || getUi().series !== s0) return;
      session.mesh = mesh;
      session.cacheMesh(key, mesh);
      setAmbientStatus(`${mesh.tris.toLocaleString()} tris via ${extractor.usedWorker ? 'worker' : 'main thread'} · ${u.series}`);
    }
    if (!session.mesh) return;
    // Switched to volume rendering while extracting: the surface is cached
    // for the way back, but neither frames the zoom nor paints over the VR.
    if (getUi().render3d === 'volume') return;
    const box = u.src === 'mask' && session.editMask ? maskBox(session.editMask, img.dims, 3) : null;
    if (box) {
      // framing in mm, like the render: the mask's longest side vs the box's
      const [nx, ny, nz] = img.dims;
      const sp = img.spacing ?? [1, 1, 1];
      const span = Math.max(
        (box.max[0] - box.min[0] + 1) * sp[0], (box.max[1] - box.min[1] + 1) * sp[1], (box.max[2] - box.min[2] + 1) * sp[2],
      );
      session.zoom3d = Math.min(8, Math.max(0.5, (Math.max(nx * sp[0], ny * sp[1], nz * sp[2]) / span) * 0.85));
    } else {
      session.zoom3d = 1;
    }
    paintOrbit();
    setEngineFromExtractor();
    const mesh = session.mesh;
    // the last word on the surface, cached or fresh: thick slices say so
    setAmbientStatus(`${mesh.tris.toLocaleString()} tris via ${extractor.usedWorker ? 'worker' : 'main thread'}${(mesh.sliceFactor ?? 1) > 1 ? ` · slices ×${mesh.sliceFactor} interpolated` : ''} · ${u.series}`);
    // No bump(): nothing reactive changed — bumping here would loop the ver effect.
  };

  useEffect(() => {
    paintBus.surface = repaint3d;
    return () => { paintBus.surface = () => {}; };
  });

  // Live 3D: control changes repaint at once; mask edits (paint strokes)
  // debounce 600ms so a stroke doesn't pay a full extraction per dab.
  const sigRef = useRef('');
  const mvRef = useRef(-1);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (debRef.current) clearTimeout(debRef.current); }, []);

  useEffect(() => {
    const u = getUi();
    const sig = [
      u.series, u.src, u.method, u.smooth3d, u.threshold, u.render3d, tfPreset, density,
      quality, shade, tf ? JSON.stringify(tf) : '',
      session.meshPinned ? 'mp' : '', session.fibersPinned ? 'fp' : '',
    ].join('|');
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      mvRef.current = session.maskVer;
      repaint3d();
      return;
    }
    if (session.maskVer !== mvRef.current) {
      mvRef.current = session.maskVer;
      if (debRef.current) clearTimeout(debRef.current);
      debRef.current = setTimeout(() => { debRef.current = null; repaint3d(); }, 600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver]);

  /** N2 preset filter: keep pinned-tract streamlines passing the preset.
   *  Filters session.fibers (the live view); fibersPinned keeps the raw
   *  import so Clear restores it exactly. Empty result stays loud. */
  const applyPreset = (id: string): void => {
    setPresetId(id);
    if (!id) {
      if (session.fibersPinned) {
        session.fibers = session.fibersPinned;
        setKept(null);
        paintOrbit();
        setStatus('tract preset cleared — full import restored');
      }
      return;
    }
    const preset = tractPresetById(id);
    if (!preset) {
      setStatus(`unknown tract preset: ${id}`);
      return;
    }
    const img = session.img;
    const pinned = session.fibersPinned;
    if (!img || !pinned) {
      setStatus('open a series + import tracts first — presets filter imports');
      return;
    }
    try {
      const { waypoints, exclusions } = presetRois(preset, img.dims);
      const keep = filterTracts(pinned.pts, pinned.offsetPt0, waypoints, exclusions);
      setKept(keep.length);
      if (keep.length === 0) {
        setStatus(`${preset.title}: 0/${pinned.count} pass — try another preset · teaching waypoints, not patient anatomy · ${EDUCATION_BADGE}`);
        return;
      }
      // rebuild the live FiberSet over kept indices (fence-posted offsets)
      const keptSet = new Set(keep);
      const pts: number[] = [];
      const off: number[] = [0];
      for (let s = 0; s + 1 < pinned.offsetPt0.length; s++) {
        if (!keptSet.has(s)) continue;
        const a = pinned.offsetPt0[s]!, b = pinned.offsetPt0[s + 1]!;
        for (let v = a; v < b; v++) pts.push(pinned.pts[v * 3]!, pinned.pts[v * 3 + 1]!, pinned.pts[v * 3 + 2]!);
        off.push(pts.length / 3);
      }
      session.fibers = {
        pts: Float32Array.from(pts),
        offsetPt0: Uint32Array.from(off),
        count: keep.length,
        scalars: null,
        scalarName: null,
      };
      paintOrbit();
      const ro = document.getElementById('ro-3d');
      if (ro) ro.textContent = `${keep.length.toLocaleString()} tract${keep.length === 1 ? '' : 's'} · preset ${preset.id} · ${Math.round(session.zoom3d * 100)}%`;
      setStatus(`${preset.title}: ${keep.length}/${pinned.count} pass · ${preset.lesson} · teaching waypoints, not patient anatomy · ${EDUCATION_BADGE}`);
    } catch (e) {
      setStatus(`preset filter failed: ${(e as Error).message}`, 'error');
    }
  };

  const queueOrbit = (): void => {
    if (getUi().render3d === 'volume') {
      // VR frames are worker-async: debounce, don't queue per tick.
      if (rafQueued.current) return;
      rafQueued.current = true;
      requestAnimationFrame(() => { rafQueued.current = false; void paintVr(); });
      return;
    }
    if (!session.mesh || rafQueued.current) return;
    rafQueued.current = true;
    requestAnimationFrame(() => { rafQueued.current = false; paintOrbit(1); });
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => { settleRef.current = null; paintOrbit(2); }, ORBIT_SETTLE_MS);
  };

  /** Zoom and repaint whichever renderer owns the canvas. */
  const setZoom3d = (z: number): void => {
    session.zoom3d = z;
    if (getUi().render3d === 'volume') void paintVr();
    else if (session.mesh) paintOrbit();
  };
  const zoomStep3d = (f: number): void => setZoom3d(Math.min(8, Math.max(0.5, session.zoom3d * f)));

  const wheelZoom = (e: React.WheelEvent): void => {
    e.preventDefault();
    zoomStep3d(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  /** Drag-to-orbit: the demo's slow orbit drag now really rotates the volume. */
  const orbDrag = useRef<{ x: number; y: number } | null>(null);
  // Touch: one finger orbits, two fingers pinch to zoom — the same contract
  // a 3D viewport gives a trackpad, so zoom is a gesture and not a button.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);

  const onOrbitDown = (e: React.PointerEvent): void => {
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        orbDrag.current = null;                       // a pinch is not an orbit
        pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), z: session.zoom3d };
        return;
      }
      if (touches.current.size > 2) return;
    }
    orbDrag.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onOrbitMove = (e: React.PointerEvent): void => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = pinch.current;
      if (p && touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (p.d > 0) {
          session.zoom3d = Math.min(8, Math.max(0.4, p.z * (d / p.d)));
          queueOrbit();
        }
        return;
      }
    }
    const d = orbDrag.current;
    // Touch reports buttons === 0 while dragging, so only gate a mouse on it.
    if (!d || (e.pointerType !== 'touch' && !(e.buttons & 1))) return;
    const TAU = Math.PI * 2;
    const o = (((angles.current.orbit + (e.clientX - d.x) * 0.006) % TAU) + TAU) % TAU;
    const t = Math.min(1.2, Math.max(-1.2, angles.current.tilt + (e.clientY - d.y) * 0.004));
    orbDrag.current = { x: e.clientX, y: e.clientY };
    setOrbit(o);
    setTilt(t);
    queueOrbit();
  };
  const onOrbitUp = (e?: React.PointerEvent): void => {
    if (e?.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2) pinch.current = null;
    }
    orbDrag.current = null;
  };

  /** One dock, two homes: above the viewport on desktop, inside the control
   *  deck on mobile — so tools never cover the image they act on. */
  const dockHost = (dock: JSX.Element): JSX.Element | null => {
    if (!bare) return dock;                       // standalone Surface route
    if (!show3dTools) return null;                // 3D viewport not on screen
    if (deckSlot) return createPortal(dock, deckSlot);
    // No slot yet (first commit) or toolbar hidden: desktop keeps it inline
    // rather than losing the controls entirely.
    return isMobile ? null : dock;
  };

  return (
    <>
      {!bare && (
        <div className="view-title" id="title-3d">
          <h1>Surface</h1>
          <p>drag to orbit — extracted on demand, cached per edit</p>
        </div>
      )}
      {dockHost(
      <div className="dock" id="dock-3d">
        <div className="grp">
          <span className="lbl">Render</span>
          <Seg<Render3D>
            id="renderseg" dataKey="r"
            ariaLabel="Render mode" value={ui.render3d}
            onChange={(v) => { setUi({ render3d: v }); session.zoom3d = 1; bump(); }}
            options={[{ value: 'surface', label: 'Surface' }, { value: 'volume', label: 'Volume' }]}
          />
        </div>
        <div className="sep" />
        <div className="grp">
          <span className="lbl">Source</span>
            <Seg<Source>
              id="srcseg"
              dataKey="s"
              ariaLabel="Source" value={ui.src} onChange={(v) => { switchSource(v); session.meshPinned = null; bump(); }}
            options={[{ value: 'mask', label: 'Mask' }, { value: 'image', label: 'Image' }]}
          />
        </div>
        <div className="sep" />
        {ui.render3d === 'surface' ? (
          <>
            <SliderRow label="Threshold" min={session.autoThreshold?.lo ?? 0} max={session.autoThreshold?.hi ?? 1000} step={1} value={ui.threshold} onInput={(v) => setUi({ threshold: v })} onCommit={() => { session.meshPinned = null; bump(); }} />
            <Chip><span id="tval">{ui.threshold}</span></Chip>
            <div className="grp">
              <span className="lbl">Surface</span>
              <Seg<Method>
                id="methodseg"
                dataKey="m"
                ariaLabel="Surface" value={ui.method} onChange={(v) => { setUi({ method: v }); session.meshPinned = null; bump(); }}
                options={[{ value: 'blocky', label: 'Blocky' }, { value: 'smooth', label: 'Smooth' }]}
              />
            </div>
            {ui.method === 'smooth' && (
              // 0 is the surface as extracted; higher filters terraces away
              // and keeps each piece's volume (render-cpu/mesh-smooth.ts).
              <SliderRow
                label="Smoothing" min={0} max={1} step={0.1} value={ui.smooth3d}
                onInput={(v) => setUi({ smooth3d: v })} onCommit={() => { session.meshPinned = null; bump(); }}
              />
            )}
          </>
        ) : (
          <>
            <div className="grp">
              <span className="lbl">TF</span>
              <DarkSelect
                value={tfPreset} title="Transfer function" ariaLabel="Transfer function"
                onChange={(v) => {
                  const name = v as TFPresetName;
                  setTfPreset(name);
                  const [mn, mx] = fieldRange();
                  setTf(presetTF(name, mn, mx));
                  bump();
                }}
              >
                {TF_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
              </DarkSelect>
            </div>
            <SliderRow label="Density" min={0.2} max={3} step={0.05} value={density}
              onInput={(v) => setDensity(v)} onCommit={() => bump()} />
            <div className="grp">
              <span className="lbl">Quality</span>
              <Seg<'draft' | 'full'>
                ariaLabel="Quality" value={quality}
                onChange={(v) => { setQuality(v); bump(); }}
                options={[{ value: 'draft', label: 'Draft' }, { value: 'full', label: 'Full' }]}
              />
            </div>
            <Switch checked={shade} label="Shade" onChange={(v) => { setShade(v); bump(); }} />
          </>
        )}
        <div className="sep" />
        <div className="grp">
          <span className="lbl">Tracts</span>
          <DarkSelect value={presetId} title="Teaching waypoint preset (filters imported tracts; fractional viewBox, never patient anatomy)" ariaLabel="Tract preset"
            onChange={(v) => applyPreset(v)}>
            <option value="">—</option>
            {TRACT_PRESETS.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </DarkSelect>
          <Chip><span id="ro-preset">{kept !== null ? `${kept} kept` : 'no filter'} · {presetId || '—'}</span></Chip>
        </div>
        <div className="sep" />
        <div className="grp">
            {/* the input itself is the viewer's (ViewerView), always mounted */}
            <label className="iconbtn" htmlFor="upload" title="Open a .nii/.nii.gz mask, SEG, RTSTRUCT, DICOM files, .nrrd/.nhdr(+data)/.tif volume, .stl/.mz3/.gii mesh or .tck tracts">Open file</label>
        </div>
      </div>
      )}
      {ui.render3d === 'volume' && (
        <div className="pane tfpane" id="pane-tf">
          <div className="pane-head"><span className="name">Transfer function</span><span className="sub">drag stops · double-click adds · right-click removes</span></div>
          <div className="tfwrap">
            <TfEditor tf={currentTF()} range={fieldRange()} onCommit={(stops) => { setTf(stops); bump(); }} />
          </div>
        </div>
      )}
      <div id="view-3d" className="panes">
        <div className="pane" id="pane-3d">
          <div className="pane-head">
            <span className="name">3D</span>
            <Chip><span id="ro-3d">—</span></Chip>
            <div className="vptools">
              <IconBtn title="Zoom out 3D" onClick={() => zoomStep3d(1 / 1.25)}>−</IconBtn>
              <Chip className="zoom" title="Double-click canvas also resets" onClick={() => setZoom3d(1)}>
                <span id="zoom3d">100%</span>
              </Chip>
              <IconBtn title="Zoom in 3D" onClick={() => zoomStep3d(1.25)}>+</IconBtn>
              <button
                className={`iconbtn full${fullVp === 'v3d' ? ' on' : ''}`} id="full-v3d"
                title={fullVp === 'v3d' ? 'Exit 3D fullscreen (Esc)' : '3D fullscreen'}
                aria-label="3D fullscreen" aria-pressed={fullVp === 'v3d'}
                onClick={() => setUi({ fullVp: fullVp === 'v3d' ? null : 'v3d' })}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
                </svg>
              </button>
            </div>
          </div>
          <div className="stage">
            <div className="viewport-canvas">
              <canvas
                id="view3d" ref={canvasRef} width={560} height={560}
                role="img" aria-label="3D surface. Drag to orbit, wheel to zoom."
                onWheel={wheelZoom}
                onDoubleClick={() => setZoom3d(1)}
                onPointerDown={onOrbitDown}
                onPointerMove={onOrbitMove}
                onPointerUp={onOrbitUp}
                onPointerCancel={onOrbitUp}
              />
              {/* Viewport chrome, drawn as SVG/CSS over the CPU raster — the
                  orientation read every 3D tool gives you, with no GL context. */}
              <ViewportOverlay compact />
              <AxisGizmo
                orbit={orbit} tilt={tilt}
                onSnap={(o, t) => { setOrbit(o); setTilt(t); queueOrbit(); }}
              />
            </div>
            <div className="vrail" aria-label="3D orbit controls">
              <SliderRow vertical label="Orbit" min={0} max={6.283} step={0.01} value={orbit} onInput={(v) => { setOrbit(v); queueOrbit(); }} />
              <SliderRow vertical label="Tilt" min={-1.2} max={1.2} step={0.01} value={tilt} onInput={(v) => { setTilt(v); queueOrbit(); }} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
