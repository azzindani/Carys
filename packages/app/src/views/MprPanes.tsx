import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { measureClick, paintDown, paintMove, planePoint } from './PanePaint';
import type { PaintHost, StrokeState } from './PanePaint';
import { ColorTable } from '@carys/volume-core';
import {
  fuseSlices, labelOutlines, labelSlice, labelSliceOblique, mipRotate, obliqueBasis, reslice, resliceOblique, slabLabels,
  slabProject, tintLabels, voxelSlices,
} from '@carys/render-cpu';
import { paintBus } from '../lib/paintBus';
import { LABEL_FILL_ALPHA, LABEL_LUT } from '../lib/palette';
import { fmtDims, session } from '../lib/session';
import { drawChrome, drawMeasures, fmtVal } from './paneChrome';
import { drawLabelOutlines } from './paneLabels';
import { fitPane, planeSpacing, toBitmap, type PaneView } from './paneView';

import { doUndo } from '../lib/sessionOps';
import { setAmbientStatus, setStatus } from '../lib/status';
import { getUi, setUi, useUiPick } from '../lib/store';
import { bump, useVersion } from '../lib/version';
import { Chip, IconBtn } from '../ui/primitives';
import { ViewportOverlay } from '../ui/ViewportOverlay';
import { undoBus } from '../lib/undoBus';
import type { FullVp, Plane } from '../lib/types';
import type { SliceInit } from '../lib/sessionOps';
import { PLANES } from '../lib/types';

const TITLES: Record<Plane, string> = { axial: 'Axial', coronal: 'Coronal', sagittal: 'Sagittal' };

/** Baked 256-entry LUTs by Papaya table name (pure function of the name). */
const lutCache = new Map<string, ColorTable>();

const FULL_ICON = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
  </svg>
);

/** The three 2D viewports: paint/measure/sync logic + per-pane canvas, slider
 *  and tools (zoom, pan, fullscreen). Docks live in MprView and drive this
 *  pane set through paintBus. */
export function MprPanes({ sliceInit, axialCanvasRef }: {
  sliceInit: SliceInit | null;
  axialCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}): JSX.Element {
  const layout = useUiPick('layout');
  const fullVp: FullVp = useUiPick('fullVp');
  // Subscribed so projection/tilt changes re-render AND re-register the
  // paint closures below: paint() reads getUi() live, but paintBus.mpr
  // holds the closure registered by the last effect run — without these
  // subscriptions the component never re-renders on a proj/obl change, the
  // handler stays stale, and the tag freezes (leg-9 stuck-tag root cause).
  useUiPick('proj');
  useUiPick('oblA');
  useUiPick('oblB');
  useUiPick('oblPlane');
  const canvasRefs = useRef<Record<Plane, HTMLCanvasElement | null>>({ axial: null, coronal: null, sagittal: null });
  const sliderRefs = useRef<Record<Plane, HTMLInputElement | null>>({ axial: null, coronal: null, sagittal: null });
  const zoomRef = useRef<Record<Plane, number>>({ axial: 1, coronal: 1, sagittal: 1 });
  const panRef = useRef<Record<Plane, { x: number; y: number }>>({
    axial: { x: 0, y: 0 }, coronal: { x: 0, y: 0 }, sagittal: { x: 0, y: 0 },
  });
  const dragRef = useRef<{ plane: Plane; lx: number; ly: number; sx: number; sy: number; moved: boolean } | null>(null);
  /** Shift-drag window/level: start client point + starting WL. */
  const wlDragRef = useRef<{ lx: number; ly: number; w0: number; c0: number } | null>(null);
  const [, setZoomTick] = useState(0);
  const strokeState = useRef<StrokeState>({ stroke: null, oblStroke: null });
  const hostRef = useRef<PaintHost>(null as unknown as PaintHost);
  const planeVoxelRef = useRef<(plane: Plane, clientX: number, clientY: number) => [number, number]>(null as unknown as (plane: Plane, clientX: number, clientY: number) => [number, number]);
  /** The last reslice per plane, at voxel resolution (offscreen). */
  const sliceRef = useRef<Record<Plane, { cv: HTMLCanvasElement; W: number; H: number; idx: number } | null>>({
    axial: null, coronal: null, sagittal: null,
  });
  /** Each label's outline on the last reslice, when the mask shows as
   *  outlines (F14). */
  const outlineRef = useRef<Record<Plane, Map<number, Float32Array> | null>>({ axial: null, coronal: null, sagittal: null });
  /** The screen mapping the last compose used — taps invert through it. */
  const viewRef = useRef<Record<Plane, PaneView | null>>({ axial: null, coronal: null, sagittal: null });

  /** Pan/zoom only moves the reslice on screen: recompose, no reslice. */
  const applyPanZoom = (plane: Plane): void => { compose(plane); };

  /** Inverted grayscale (post-window, pre-overlay so the mask tint stays red). */
  const maybeInvert = (out: Uint8ClampedArray): void => {
    if (!getUi().invert) return;
    for (let i = 0; i < out.length; i += 4) {
      out[i] = 255 - out[i]!; out[i + 1] = 255 - out[i + 1]!; out[i + 2] = 255 - out[i + 2]!;
    }
  };

  /** Colormap (post-window + post-invert, pre-overlay): with Invert on,
   *  inverted intensities map through the same table (NiiVue
   *  colormapInvert semantics). Grayscale skips: identity. */
  const applyLut = (out: Uint8ClampedArray): void => {
    const name = getUi().lut;
    if (!name || name === 'Grayscale') return;
    let t = lutCache.get(name);
    if (!t) {
      t = new ColorTable(name, true);
      lutCache.set(name, t);
    }
    for (let i = 0; i < out.length; i += 4) {
      const g = out[i]!;
      out[i] = t.lookupRed(g); out[i + 1] = t.lookupGreen(g); out[i + 2] = t.lookupBlue(g);
    }
  };

  const paint = (plane: Plane): void => {
    const img = session.img;
    const cv = canvasRefs.current[plane];
    const slider = sliderRefs.current[plane];
    if (!img || !cv || !slider || !session.wl) return;
    const u = getUi();    const { dims, data } = img;
    const [nx, ny, nz] = dims;
    const idx = Number(slider.value);
    session.slices[plane] = idx;
    const max = plane === 'axial' ? nz - 1 : plane === 'coronal' ? ny - 1 : nx - 1;
    const vol = { dims, spacing: [1, 1, 1] as [number, number, number], origin: [0, 0, 0] as [number, number, number], dtype: 'float64' as const, data };
    const W = plane === 'axial' ? nx : plane === 'coronal' ? nx : ny;
    const H = plane === 'axial' ? ny : nz;
    const oblique = plane === u.oblPlane && (u.oblA !== 0 || u.oblB !== 0);
    let out: Uint8ClampedArray;
    let labels: Uint8Array | null = null;
    let tag = `${idx} / ${max}`;
    if (oblique && u.proj !== 'slice') {
      // Rotating projection follows the same oblique angles as the slice
      // view (draft step 2: axis-aligned rays still land on voxel planes).
      const mode = u.proj === 'minip' ? 'min' : u.proj === 'mean' ? 'mean' : 'max';
      out = mipRotate(vol, { plane: u.oblPlane, angleY: u.oblB, tiltX: u.oblA, mode, w: W, h: H, wl: session.wl, step: 2 });
      maybeInvert(out); applyLut(out);
      tag = `${idx} / ${max} · ${u.proj.toUpperCase()} obl ${Math.round(u.oblA * 57.3)}°/${Math.round(u.oblB * 57.3)}°`;
    } else if (oblique) {
      const { row, col } = obliqueBasis(u.oblPlane, u.oblA, u.oblB);
      // same center convention as obliqueFrame(): volume middle + slice
      // index along the tilt-plane normal
      const center: [number, number, number] = plane === 'axial'
        ? [nx / 2, ny / 2, idx] : plane === 'coronal' ? [nx / 2, idx, nz / 2] : [idx, ny / 2, nz / 2];
      out = resliceOblique(vol, center, row, col, W, H, session.wl);
      maybeInvert(out); applyLut(out);
      // nearest-mapped labels on the same oblique frame + center
      if (u.overlay && session.seg) labels = labelSliceOblique(session.seg.data, dims, center, row, col, W, H);
      tag = `${idx} / ${max} · obl ${Math.round(u.oblA * 57.3)}°/${Math.round(u.oblB * 57.3)}°`;
    } else if (u.proj !== 'slice') {
      out = slabProject(vol, plane, idx, u.slab, u.proj, session.wl);
      maybeInvert(out); applyLut(out);
      if (u.overlay && session.seg) labels = slabLabels(session.seg.data, dims, plane, idx, u.slab);
      tag = `${idx} / ${max} · ${u.proj.toUpperCase()} ${u.slab}`;
    } else {
      // Dual-volume compare rides on the orthogonal slice path only: tilt
      // or projection reverts to the single-volume paint above (loud tag).
      const cmp = u.compareMode !== 'off' && u.compareSeries && u.compareSeries !== u.series
        ? session.getVol(u.compareSeries) ?? null : null;
      const cmpWl = session.compareWl;
      const fused = cmp !== null && cmpWl !== null;
      out = fused
        ? fuseSlices(
          { dims, spacing: img.spacing ?? [1, 1, 1], origin: [0, 0, 0], dtype: 'float64', data },
          { dims: cmp.dims, spacing: cmp.spacing ?? [1, 1, 1], origin: [0, 0, 0], dtype: 'float64', data: cmp.data },
          plane, idx, session.wl, cmpWl,
          u.compareMode === 'subtract' ? 'subtract' : u.compareMode === 'alpha' ? 'alpha' : 'checker',
          u.compareAlpha,
        )
        : reslice(vol, plane, idx, session.wl);
      maybeInvert(out); applyLut(out);
      if (fused) {
        tag = `${idx} / ${max} · ${u.compareMode === 'subtract' ? 'Δ' : u.compareMode} ${u.compareSeries}`;
      } else if (cmp) {
        tag = `${idx} / ${max} · compare loading…`;
      }
      // the mask tint is the BASE series anatomy: skip it under a fused
      // overlay (mixed-series red would attribute to the wrong volume)
      if (u.overlay && session.seg && !fused) labels = labelSlice(session.seg.data, dims, plane, idx);
    }
    // a colour per label: outlines over a light fill, or the opaque fill
    const outline = u.maskLook === 'outline';
    if (labels) tintLabels(out, labels, LABEL_LUT, outline ? LABEL_FILL_ALPHA : 1);
    outlineRef.current[plane] = labels && outline ? labelOutlines(labels, W, H) : null;
    const off = sliceRef.current[plane]?.cv ?? document.createElement('canvas');
    if (off.width !== W) off.width = W;
    if (off.height !== H) off.height = H;
    off.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(out), W, H), 0, 0);
    sliceRef.current[plane] = { cv: off, W, H, idx };
    compose(plane);
    const ro = document.getElementById(`ro-${plane}`);
    if (ro) ro.textContent = tag;
    document.getElementById(`pane-${plane}`)?.classList.remove('loading');
    setAmbientStatus(`${fmtDims(dims)} · ${plane} ${idx} · ${session.img ? u.series : ''}`);
  };

  /**
   * Put the plane's last reslice on screen: size the canvas to its box at
   * device resolution, draw the slice through the pane mapping (true
   * aspect, zoom, pan, superior-up flip), then the overlays in screen px —
   * so text and line weights stay the same on a 64² and a 512² grid.
   */
  const compose = (plane: Plane): void => {
    const cv = canvasRefs.current[plane];
    const sl = sliceRef.current[plane];
    const img = session.img;
    if (!cv || !sl || !img) return;
    const bw = cv.clientWidth, bh = cv.clientHeight;
    // A hidden pane (fullscreen sibling, mobile single view) has no box;
    // the resize observer composes it when it gets one.
    if (bw < 2 || bh < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(bw * dpr), ph = Math.round(bh * dpr);
    if (cv.width !== pw) cv.width = pw;
    if (cv.height !== ph) cv.height = ph;
    const [su, sv] = planeSpacing(plane, img.spacing ?? [1, 1, 1]);
    const v = fitPane(sl.W, sl.H, su, sv, bw, bh, zoomRef.current[plane], panRef.current[plane],
      plane !== 'axial' && !!img.geometry);
    viewRef.current[plane] = v;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(v.ox, v.flipV ? v.oy + sl.H * v.sy : v.oy);
    ctx.scale(v.sx, v.flipV ? -v.sy : v.sy);
    ctx.drawImage(sl.cv, 0, 0);
    ctx.restore();
    const outlines = outlineRef.current[plane];
    if (outlines) drawLabelOutlines(ctx, outlines, v);
    if (getUi().tool === 'measure' || session.measurements.some((m) => m.plane === plane)) {
      drawMeasures(ctx, plane, v, sl.idx);
    }
    drawChrome(ctx, cv, plane, v, dpr);
    const zchip = document.querySelector(`[data-zoom="${plane}"]`);
    if (zchip) zchip.textContent = `${Math.round(zoomRef.current[plane] * 100)}%`;
  };

  const paintAll = (): void => { PLANES.forEach(paint); };

  // Register imperative repaint + undo APIs for docks/palette/keyboard.
  // Re-register every render (not mount-once): paintAll/paint close over
  // this render's refs, and a stale closure paints a dead canvas — the
  // leg-9 reset proved it (slice click updated state, tag never repainted
  // after a cells round-trip remounted the panes with a dropped handler).
  useEffect(() => {
    paintBus.mpr = paintAll;
    paintBus.mprPlane = paint;
    paintBus.jumpTo = jumpTo;
    // Presentation snapshot + restore: slices read the sliders, zoom/pan
    // read the transform refs (same contract as applyPanZoom).
    paintBus.getMprView = () => {
      const grab = (p: Plane): { zoom: number; x: number; y: number } => ({
        zoom: zoomRef.current[p], x: panRef.current[p]!.x, y: panRef.current[p]!.y,
      });
      return {
        slices: {
          axial: Number(sliderRefs.current.axial?.value ?? 0),
          coronal: Number(sliderRefs.current.coronal?.value ?? 0),
          sagittal: Number(sliderRefs.current.sagittal?.value ?? 0),
        },
        view: { axial: grab('axial'), coronal: grab('coronal'), sagittal: grab('sagittal') },
      };
    };
    paintBus.setMprView = (slices, view) => {
      for (const p of PLANES) {
        const s = sliderRefs.current[p];
        if (s) s.value = String(slices[p] ?? 0);
        zoomRef.current[p] = view[p]!.zoom;
        panRef.current[p] = { x: view[p]!.x, y: view[p]!.y };
      }
      session.slices = { ...slices };
      setZoomTick((t) => t + 1);
      paintAll();
    };
    undoBus.current = doUndo;
    // No cleanup: this effect re-runs every render, and the unmount wipe
    // would clear the just-registered handler on the very next render —
    // leaving paintBus.mpr a no-op (the leg-9 stuck-tag root cause). The
    // next mount overwrites the handlers anyway; a dead-canvas paint is
    // guarded inside paint() itself (missing cv/slider returns early).
  });

  // The canvas is the pane's own pixels now, so a box that changes size
  // (layout switch, fullscreen, window resize, the details panel opening)
  // must recompose — the browser no longer stretches a fixed bitmap for us.
  const composeRef = useRef(compose);
  composeRef.current = compose;
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    let queued = false;
    const ro = new ResizeObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        for (const p of PLANES) composeRef.current(p);
      });
    });
    for (const p of PLANES) {
      const cv = canvasRefs.current[p];
      if (cv) ro.observe(cv);
    }
    return () => ro.disconnect();
  }, []);

  // Apply slider ranges after load, then paint when visible.
  const ver = useVersion();
  useEffect(() => {
    // Uploads bypass App's sliceInit prop: consume the pending init once.
    const pending = session.pendingSliceInit;
    if (pending) session.pendingSliceInit = null;
    const init = pending ?? sliceInit;
    if (init) {
      for (const p of PLANES) {
        const s = sliderRefs.current[p];
        if (!s) continue;
        s.min = '0'; s.max = String(init.ranges[p]! - 1); s.value = String(init.values[p]);
      }
    } else {
      // No init (route remount, projection/tilt change): restore the CURRENT
      // volume's slider ranges. Positions come from session.slices (paint()
      // writes them every frame) — clamped defensively in case the volume
      // changed under a stale slice. A remount otherwise keeps the previous
      // volume's slider state (e.g. NRRD 2/3 → back on cardiac shows 111/3
      // with a stale max), and every later tag paints from the wrong index.
      // Skip the restore while tilted: the oblique paint reads the same
      // sliders, and resetting them mid-tilt would straighten the view out
      // from under the tilt the tag is describing (leg-9: the MEAN-obl tag
      // must survive the cells round-trip, not reset to a plain slice).
      const u = getUi();
      const tilted = u.oblA !== 0 || u.oblB !== 0;
      const img = session.img;
      if (img && !tilted) {
        const [nx, ny, nz] = img.dims;
        const ranges = { axial: nz, coronal: ny, sagittal: nx };
        for (const p of PLANES) {
          const s = sliderRefs.current[p];
          if (!s) continue;
          const max = ranges[p]! - 1;
          s.min = '0'; s.max = String(max);
          const want = Math.max(0, Math.min(max, session.slices[p] ?? 0));
          s.value = String(want);
        }
      }
    }
    paintAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver, sliceInit]);

  /** Client point → reslice coords through the mapping the pane was last
   *  composed with (exact at any size, zoom, pan or flip). Continuous; floor
   *  for the voxel. Off-image points fall outside [0, W) × [0, H). */
  const contentXY = (plane: Plane, clientX: number, clientY: number): [number, number] => {
    const cv = canvasRefs.current[plane];
    const v = viewRef.current[plane];
    if (!cv || !v) return [-1, -1];
    const r = cv.getBoundingClientRect();
    // r is the canvas box; a transformed ancestor can scale it from bw×bh
    const x = (clientX - r.left) * (v.bw / (r.width || 1));
    const y = (clientY - r.top) * (v.bh / (r.height || 1));
    return toBitmap(v, x, y);
  };

  /** Orthogonal lattice tap on any plane (floored reslice coords). */
  const planeVoxel = (plane: Plane, e: React.PointerEvent): [number, number] => {
    const [i, j] = contentXY(plane, e.clientX, e.clientY);
    return [Math.floor(i), Math.floor(j)];
  };

  // Host interface for the extracted tap/measure/paint module: closures
  // over this render's refs + paint pipeline, refreshed every render.
  hostRef.current = {
    contentXY,
    planeDims: (plane) => {
      const [nx, ny, nz] = session.img!.dims;
      return [plane === 'axial' ? nx : plane === 'coronal' ? nx : ny, plane === 'axial' ? ny : nz];
    },
    planeIdx: (plane) => Number(sliderRefs.current[plane]?.value ?? 0),
    paint, paintAll, fmtVal,
  };
  planeVoxelRef.current = (plane, clientX, clientY) => {
    const e = { clientX, clientY } as React.PointerEvent;
    return planeVoxel(plane, e);
  };

  /** Every plane to a voxel, the crosshair on it. */
  const jumpTo = (voxel: [number, number, number], with3d = true): void => {
    const img = session.img;
    if (!img) return;
    session.crosshair = voxel;
    const next = voxelSlices(voxel, img.dims);
    for (const p of PLANES) {
      const s = sliderRefs.current[p];
      if (s) s.value = String(next[p]);
    }
    paintAll();
    // V2 3D cursor follows the synced tap (NiiVue parity: crosshair
    // visible in 3D). Surface repaints from the same session.crosshair.
    if (with3d) paintBus.surface();
  };

  /** Crosshair sync: a Select-tap jumps every plane to the clicked voxel. */
  const syncToVoxel = (plane: Plane, e: React.PointerEvent): void => {
    const hit = planePoint(hostRef.current, e, plane);
    if (session.img && hit) jumpTo(hit.voxel);
  };

  /** Select-drag pans the plane; a tap (<3px) still crosshair-syncs. Mapping
   *  stays exact: planePoint reads the transformed bounding rect. */
  const onViewDown = (plane: Plane, e: React.PointerEvent): void => {
    // Shift-drag = window/level (Cornerstone WW/WC): right widens, up
    // raises the center. Select tool only; any pane drives all panes.
    if (e.shiftKey && getUi().tool === 'view' && session.wl) {
      wlDragRef.current = { lx: e.clientX, ly: e.clientY, w0: session.wl.width, c0: session.wl.center };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }
    dragRef.current = { plane, lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onViewMove = (e: React.PointerEvent): void => {
    const w = wlDragRef.current;
    if (w && getUi().tool === 'view' && session.wl && (e.buttons & 1)) {
      const step = Math.max(1, w.w0) / 250;
      session.wl = {
        width: Math.max(1, w.w0 + (e.clientX - w.lx) * step),
        center: w.c0 - (e.clientY - w.ly) * step,
      };
      setUi({ preset: 'custom' });
      paintAll();
      return;
    }
    const d = dragRef.current;
    if (!d || getUi().tool !== 'view' || !(e.buttons & 1)) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
    d.moved = true;
    const p = panRef.current[d.plane];
    p.x += e.clientX - d.lx; p.y += e.clientY - d.ly;
    d.lx = e.clientX; d.ly = e.clientY;
    applyPanZoom(d.plane);
  };
  const onViewUp = (plane: Plane, e: React.PointerEvent): void => {
    if (wlDragRef.current) {
      wlDragRef.current = null;
      const wl = session.wl;
      if (wl) setStatus(`window W ${Math.round(wl.width)} · C ${Math.round(wl.center)} (custom)`);
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.plane !== plane || d.moved) return;
    if (getUi().tool === 'view' && getUi().sync) syncToVoxel(plane, e);
  };

  /**
   * Touch gestures, so zoom and pan are fingers rather than buttons:
   * two fingers pinch to zoom and drag to pan, exactly as a map or a 3D
   * viewport behaves. Tracked per pane; a second finger cancels whatever
   * one-finger action was in progress so a pinch never paints a stroke.
   */
  const pinchRef = useRef<Record<Plane, { d: number; z: number; cx: number; cy: number; px: number; py: number } | null>>({
    axial: null, coronal: null, sagittal: null,
  });
  const touchesRef = useRef<Record<Plane, Map<number, { x: number; y: number }>>>({
    axial: new Map(), coronal: new Map(), sagittal: new Map(),
  });

  const spread = (pts: { x: number; y: number }[]): { d: number; cx: number; cy: number } => {
    const [a, b] = pts;
    return {
      d: Math.hypot(a!.x - b!.x, a!.y - b!.y),
      cx: (a!.x + b!.x) / 2,
      cy: (a!.y + b!.y) / 2,
    };
  };

  const onCanvasDown = (plane: Plane) => (e: React.PointerEvent): void => {
    if (e.pointerType === 'touch') {
      const m = touchesRef.current[plane];
      m.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (m.size === 2) {
        // Second finger: abandon any one-finger stroke and start a pinch.
        strokeState.current.stroke = null;
        strokeState.current.oblStroke = null;
        dragRef.current = null;
        const s = spread([...m.values()]);
        pinchRef.current[plane] = {
          d: s.d, z: zoomRef.current[plane], cx: s.cx, cy: s.cy,
          px: panRef.current[plane].x, py: panRef.current[plane].y,
        };
        return;
      }
      if (m.size > 2) return;
    }
    if (getUi().tool === 'measure') {
      measureClick(hostRef.current, plane, e);
      return;
    }
    if (getUi().tool === 'view') {
      onViewDown(plane, e);
      return;
    }
    paintDown(hostRef.current, strokeState.current, plane, e, planeVoxelRef.current);
  };

  const onCanvasTouchMove = (plane: Plane) => (e: React.PointerEvent): boolean => {
    if (e.pointerType !== 'touch') return false;
    const m = touchesRef.current[plane];
    if (!m.has(e.pointerId)) return false;
    m.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinchRef.current[plane];
    if (!p || m.size < 2) return false;
    const s = spread([...m.values()]);
    if (p.d > 0) {
      zoomRef.current[plane] = Math.min(8, Math.max(0.5, p.z * (s.d / p.d)));
      panRef.current[plane] = { x: p.px + (s.cx - p.cx), y: p.py + (s.cy - p.cy) };
      applyPanZoom(plane);
      setZoomTick((t) => t + 1);
    }
    return true;
  };

  const onCanvasTouchEnd = (plane: Plane) => (e: React.PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    const m = touchesRef.current[plane];
    m.delete(e.pointerId);
    if (m.size < 2) pinchRef.current[plane] = null;
  };

  const onAxialUp = (): void => {
    if (strokeState.current.stroke || strokeState.current.oblStroke) {
      strokeState.current.stroke = null;
      strokeState.current.oblStroke = null;
      session.maskVer++;
      paintAll();
      bump();
    }
  };

  /**
   * Wheel stack-scrolls the series; Ctrl/Cmd+wheel zooms.
   *
   * This is the binding every reading workstation uses (Sectra, Visage,
   * syngo, OHIF, Horos) and it is the most-used gesture in the job: a
   * radiologist scrolls a stack far more often than they zoom. Zoom keeps
   * the modifier, the ± buttons and the zoom chip.
   */
  const wheelZoom = (plane: Plane) => (e: React.WheelEvent): void => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomRef.current[plane] = Math.min(8, Math.max(0.5, zoomRef.current[plane] * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      setZoomTick((t) => t + 1);
      compose(plane);
      return;
    }
    const s = sliderRefs.current[plane];
    if (!s) return;
    // Trackpads emit many small deltas; one notch per event keeps the stack
    // controllable instead of flying past the anatomy.
    const step = e.deltaY > 0 ? 1 : -1;
    const next = Math.min(Number(s.max), Math.max(Number(s.min), Number(s.value) + step));
    if (next === Number(s.value)) return;
    s.value = String(next);
    paint(plane);
  };
  const zoomStep = (plane: Plane, f: number): void => {
    zoomRef.current[plane] = Math.min(8, Math.max(0.5, zoomRef.current[plane] * f));
    setZoomTick((t) => t + 1);
    paint(plane);
  };
  const resetZoom = (plane: Plane): void => {
    zoomRef.current[plane] = 1;
    panRef.current[plane] = { x: 0, y: 0 };
    setZoomTick((t) => t + 1);
    paint(plane);
  };

  return (
    <div id="view-mpr" className="panes panes-2d" data-layout={layout}>
      {PLANES.map((p) => (
        <div className="pane loading" id={`pane-${p}`} key={p}>
          <div className="pane-head">
            <span className="name">{TITLES[p]}</span>
            <Chip><span id={`ro-${p}`}>—</span></Chip>
            <div className="vptools">
              <IconBtn title={`Zoom out ${TITLES[p]}`} onClick={() => zoomStep(p, 1 / 1.25)}>−</IconBtn>
              <Chip className="zoom" title="Click or double-click canvas to reset zoom + pan" onClick={() => resetZoom(p)}>
                <span data-zoom={p}>100%</span>
              </Chip>
              <IconBtn title={`Zoom in ${TITLES[p]}`} onClick={() => zoomStep(p, 1.25)}>+</IconBtn>
              <button
                className={`iconbtn full${fullVp === p ? ' on' : ''}`} id={`full-${p}`}
                title={fullVp === p ? `Exit ${TITLES[p]} fullscreen (Esc)` : `${TITLES[p]} fullscreen`}
                aria-label={`${TITLES[p]} fullscreen`} aria-pressed={fullVp === p}
                onClick={() => setUi({ fullVp: fullVp === p ? null : p })}
              >
                {FULL_ICON}
              </button>
            </div>
          </div>
          <div className="stage">
            <div className="viewport-canvas">
              <canvas
                id={`c-${p}`}
                role="img" aria-label={`${TITLES[p]} slice${p === 'axial' ? '. Paint here with the paint tool.' : ''}`}
                ref={(cv) => {
                  canvasRefs.current[p] = cv;
                  if (p === 'axial' && axialCanvasRef && cv) {
                    (axialCanvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = cv;
                  }
                }}
                onWheel={wheelZoom(p)}
                onDoubleClick={() => resetZoom(p)}
                onPointerDown={onCanvasDown(p)}
                onPointerMove={(e) => {
                  // A pinch owns the gesture: no painting, no crosshair drag.
                  if (onCanvasTouchMove(p)(e)) return;
                  paintMove(hostRef.current, strokeState.current, p, e, planeVoxelRef.current);
                  onViewMove(e);
                }}
                onPointerUp={(e) => { onCanvasTouchEnd(p)(e); onAxialUp(); onViewUp(p, e); }}
                onPointerCancel={onCanvasTouchEnd(p)}
              />
              {/* Study identity in the corners, the way a reading workstation
                  shows it. Edge letters + scale bar stay on the canvas. */}
              <ViewportOverlay />
            </div>
            <div className="vrail" aria-label={`${TITLES[p]} slice slider`}>
              <input
                type="range" id={`s-${p}`} className="styled vert" aria-label={`${TITLES[p]} slice`}
                ref={(s) => { sliderRefs.current[p] = s; }}
                onInput={() => paint(p)}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
