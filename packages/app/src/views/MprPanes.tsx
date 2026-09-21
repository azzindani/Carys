import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { measureClick, paintDown, paintMove, planePoint } from './PanePaint';
import type { PaintHost, StrokeState, TapEvent } from './PanePaint';
import { ColorTable, iopEdgeLabels } from '@carys/volume-core';
import type { Volume } from '@carys/volume-core';
import { fuseSlices, mipRotate, obliqueBasis, reslice, resliceOblique, slabMask, slabProject, voxelSlices } from '@carys/render-cpu';
import { paintBus } from '../lib/paintBus';
import { ACCENT, ACCENT_DIM, ACCENT_DIM_FILL, ACCENT_HI, CHROME_TEXT, MASK_TINT, MONO_STACK, ON_ACCENT } from '../lib/palette';
import { fmtDims, session } from '../lib/session';

import { doUndo } from '../lib/sessionOps';
import { setStatus } from '../lib/status';
import { getUi, setUi, useUiPick } from '../lib/store';
import { toast } from '../lib/toasts';
import { bump, useVersion } from '../lib/version';
import { Chip, IconBtn } from '../ui/primitives';
import { undoBus } from '../lib/undoBus';
import type { FullVp, MeasureKind, Plane } from '../lib/types';
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

  const applyPanZoom = (plane: Plane): void => {
    const cv = canvasRefs.current[plane];
    if (!cv) return;
    const p = panRef.current[plane];
    cv.style.transform = `translate(${p.x}px, ${p.y}px) scale(${zoomRef.current[plane]})`;
  };

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
      if (u.overlay && session.seg) {
        // nearest-mapped mask tint on the same oblique frame + center
        const m = session.seg.data;
        for (let j = 0; j < H; j++) {
          for (let i = 0; i < W; i++) {
            const px = Math.round(center[0] + (i - W / 2) * row[0] + (j - H / 2) * col[0]);
            const py = Math.round(center[1] + (i - W / 2) * row[1] + (j - H / 2) * col[1]);
            const pz = Math.round(center[2] + (i - W / 2) * row[2] + (j - H / 2) * col[2]);
            if (px < 0 || py < 0 || pz < 0 || px >= nx || py >= ny || pz >= nz) continue;
            if (m[pz * nx * ny + py * nx + px]! > 0) {
              const o = (j * W + i) * 4;
              out[o] = MASK_TINT[0]; out[o + 1] = MASK_TINT[1]; out[o + 2] = MASK_TINT[2];
            }
          }
        }
      }
      tag = `${idx} / ${max} · obl ${Math.round(u.oblA * 57.3)}°/${Math.round(u.oblB * 57.3)}°`;
    } else if (u.proj !== 'slice') {
      out = slabProject(vol, plane, idx, u.slab, u.proj, session.wl);
      maybeInvert(out); applyLut(out);
      if (u.overlay && session.seg) {
        const pm = slabMask(session.seg.data, dims, plane, idx, u.slab);
        for (let p = 0; p < pm.length; p++) {
          if (pm[p]! > 0) { const o = p * 4; out[o] = MASK_TINT[0]; out[o + 1] = MASK_TINT[1]; out[o + 2] = MASK_TINT[2]; }
        }
      }
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
      if (u.overlay && session.seg && !fused) {
        const s = session.seg.data;
        for (let j = 0; j < out.length / 4 / W; j++) {
          for (let i = 0; i < W; i++) {
            const v = plane === 'axial' ? s[idx * nx * ny + j * nx + i]
              : plane === 'coronal' ? s[j * nx * ny + idx * nx + i]
              : s[j * nx * ny + i * nx + idx];
            if (v! > 0) { const o = (j * W + i) * 4; out[o] = MASK_TINT[0]; out[o + 1] = MASK_TINT[1]; out[o + 2] = MASK_TINT[2]; }
          }
        }
      }
    }
    cv.width = W; cv.height = H;
    applyPanZoom(plane);
    cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(out), W, H), 0, 0);
    // Measurement overlay lives in voxel space: unaffected by zoom transform.
    if (getUi().tool === 'measure' || session.measurements.some((m) => m.plane === plane)) {
      drawMeasures(cv, plane, W, idx);
    }
    drawChrome(cv, plane, W);
    const ro = document.getElementById(`ro-${plane}`);
    if (ro) ro.textContent = tag;
    const zchip = document.querySelector(`[data-zoom="${plane}"]`);
    if (zchip) zchip.textContent = `${Math.round(zoomRef.current[plane] * 100)}%`;
    document.getElementById(`pane-${plane}`)?.classList.remove('loading');
    setStatus(`${fmtDims(dims)} · ${plane} ${idx} · ${session.img ? u.series : ''}`);
  };

  /** Viewport chrome: anatomy edge letters (DICOM IOP only, hidden when
   *  unknown or oblique) + physical scale bar. Canvas-space like measures. */
  const drawChrome = (cv: HTMLCanvasElement, plane: Plane, W: number): void => {
    const ctx = cv.getContext('2d')!;
    const img = session.img;
    if (!img) return;
    const H = cv.height;
    const fs = Math.max(11, Math.round(W / 26));
    ctx.font = `${fs}px ${MONO_STACK}`;
    ctx.fillStyle = CHROME_TEXT;
    // crosshair reference lines (OHIF Reference Lines): the synced voxel
    // drawn on every pane, same axis convention as planePoint.
    const ch = session.crosshair;
    if (ch && getUi().sync) {
      const [cu, cvv] = plane === 'axial' ? [ch[0], ch[1]] : plane === 'coronal' ? [ch[0], ch[2]] : [ch[1], ch[2]];
      ctx.strokeStyle = ACCENT_DIM;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(cu + 0.5, 0);
      ctx.lineTo(cu + 0.5, H);
      ctx.moveTo(0, cvv + 0.5);
      ctx.lineTo(W, cvv + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const iop = session.dcmMeta?.iop ?? null;
    const oblique = plane === getUi().oblPlane && (getUi().oblA !== 0 || getUi().oblB !== 0);
    if (iop && !oblique) {      const lab = iopEdgeLabels(iop, plane);
      if (lab) {
        ctx.textAlign = 'left';
        ctx.fillText(lab.left, 6, H / 2);
        ctx.textAlign = 'right';
        ctx.fillText(lab.right, W - 6, H / 2);
        ctx.textAlign = 'center';
        ctx.fillText(lab.top, W / 2, fs + 2);
        ctx.fillText(lab.bottom, W / 2, H - 6);
        ctx.textAlign = 'left';
      }
    }
    // scale bar: nicest 1/2/5×10^n mm under ~1/6 of the pane width
    const sp = img.spacing ?? [1, 1, 1];
    const mmPerPx = (plane === 'sagittal' ? sp[1] : sp[0]) || 1;
    const target = (W / 6) * mmPerPx;
    const pow = 10 ** Math.floor(Math.log10(Math.max(target, 1e-9)));
    const mm = [5 * pow, 2 * pow, pow].find((c) => c <= target) ?? pow / 2;
    const px = mm / mmPerPx;
    if (px > 12) {
      const x0 = W - px - 10, y0 = H - 10;
      ctx.strokeStyle = CHROME_TEXT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + px, y0);
      ctx.moveTo(x0, y0 - 4);
      ctx.lineTo(x0, y0 + 4);
      ctx.moveTo(x0 + px, y0 - 4);
      ctx.lineTo(x0 + px, y0 + 4);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(`${mm >= 10 ? Math.round(mm) : mm} mm`, W - 10, y0 - 8);
      ctx.textAlign = 'left';
    }
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

  /** Client point → canvas pixels through object-fit:contain letterboxing.
   *  getBoundingClientRect already includes the pan/zoom transform, which
   *  cancels out (translate + uniform scale about the center) — what remains
   *  is layout-space letterbox, removed here. Keeps paint/measure/sync exact
   *  at any pane size. */
  const contentXY = (
    cv: HTMLCanvasElement, W: number, H: number, clientX: number, clientY: number,
  ): [number, number] => {
    const r = cv.getBoundingClientRect();
    const lw = cv.offsetWidth || 1, lh = cv.offsetHeight || 1;
    const s0 = Math.min(lw / W, lh / H) || 1;
    const ox = (lw - W * s0) / 2, oy = (lh - H * s0) / 2;
    const u = ((clientX - r.left) / (r.width || 1)) * lw;
    const v = ((clientY - r.top) / (r.height || 1)) * lh;
    return [(u - ox) / s0, (v - oy) / s0];
  };

  /** Orthogonal lattice tap on any plane (floored canvas pixels). */
  const planeVoxel = (plane: Plane, e: React.PointerEvent): [number, number] => {
    const cv = canvasRefs.current[plane]!;
    const [nx, ny, nz] = session.img!.dims;
    const W = plane === 'axial' ? nx : plane === 'coronal' ? nx : ny;
    const H = plane === 'axial' ? ny : nz;
    const [i, j] = contentXY(cv, W, H, e.clientX, e.clientY);
    return [Math.floor(i), Math.floor(j)];
  };
  const eventVoxel = (e: React.PointerEvent): [number, number] => planeVoxel('axial', e);
  const axialIdx = (): number => Number(sliderRefs.current.axial?.value ?? 0);
  /** Slice index of any plane's slider. */
  const planeIdx = (plane: Plane): number => Number(sliderRefs.current[plane]?.value ?? 0);

  /** The exact tilted sampling frame the tilt-plane paint used (null =
   *  orthogonal). Rebuilt here from the same basis + center so taps
   *  invert through the same frame: { key, frame, W, H }. Double-oblique:
   *  the tilt rides oblPlane; the other two planes stay orthogonal. */

  const fmtVal = (kind: MeasureKind, v: number): string =>
    kind === 'length' ? `${v.toFixed(1)} mm` : kind === 'angle' || kind === 'cobb' ? `${v.toFixed(0)}°`
      : kind === 'ellipse' || kind === 'roi' ? `${v.toFixed(1)} mm²` : `${Math.round(v)}`;

  // Host interface for the extracted tap/measure/paint module: closures
  // over this render's refs + paint pipeline, refreshed every render.
  hostRef.current = {
    contentXY: (plane, clientX, clientY) => {
      const cv = canvasRefs.current[plane]!;
      const [nx, ny, nz] = session.img!.dims;
      const W = plane === 'axial' ? nx : plane === 'coronal' ? nx : ny;
      const H = plane === 'axial' ? ny : nz;
      return contentXY(cv, W, H, clientX, clientY);
    },
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

  /** Overlay tracked measurements for this plane+slice on the 2D context. */
  const drawMeasures = (cv: HTMLCanvasElement, plane: Plane, W: number, idx: number): void => {
    const ctx = cv.getContext('2d')!;
    const rows = session.measurements.filter((m) => m.plane === plane && m.slice === idx);
    const pend = session.pendingPlane === plane ? session.pendingMeasure : [];
    const fs = Math.max(11, Math.round(W / 26));
    ctx.font = `${fs}px ${MONO_STACK}`;
    ctx.lineWidth = Math.max(1.5, W / 220);
    /** Label box top-left, shifted inside the canvas when past an edge. */
    const labelBox = (x: number, y: number, tw: number): [number, number] => {
      const bw = tw + 10, bh = fs + 8;
      return [Math.max(2, Math.min(x, W - bw - 2)), Math.max(2, Math.min(y, cv.height - bh - 2))];
    };
    const drawLabel = (x: number, y: number, label: string): void => {
      const tw = ctx.measureText(label).width;
      const [bx, by] = labelBox(x, y, tw);
      ctx.fillStyle = ON_ACCENT;
      ctx.fillRect(bx, by, tw + 10, fs + 8);
      ctx.fillStyle = ACCENT_HI;
      ctx.fillText(label, bx + 5, by + fs + 1);
    };
    const drawSet = (pts: [number, number][], label: string | null, dim: boolean): void => {
      if (pts.length === 0) return;
      ctx.strokeStyle = dim ? ACCENT_DIM : ACCENT;
      ctx.fillStyle = dim ? ACCENT_DIM_FILL : ACCENT_HI;
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
      for (const [x, y] of pts) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2.5, W / 110), 0, Math.PI * 2);
        ctx.fill();
      }
      if (label) {
        const [lx, ly] = pts[pts.length - 1]!;
        drawLabel(lx + 6, ly - fs - 8, label);
      }
    };
    /** Ellipse ROI: two corner taps → stroked ellipse + area label. */
    const drawEllipse = (pts: [number, number][], label: string | null, dim: boolean): void => {
      if (pts.length < 2) { drawSet(pts, label, dim); return; }
      const cu = (pts[0]![0] + pts[1]![0]) / 2, cv = (pts[0]![1] + pts[1]![1]) / 2;
      const ru = Math.abs(pts[1]![0] - pts[0]![0]) / 2, rv = Math.abs(pts[1]![1] - pts[0]![1]) / 2;
      ctx.strokeStyle = dim ? ACCENT_DIM : ACCENT;
      ctx.fillStyle = dim ? ACCENT_DIM_FILL : ACCENT_HI;
      ctx.beginPath();
      ctx.ellipse(cu, cv, Math.max(0.5, ru), Math.max(0.5, rv), 0, 0, Math.PI * 2);
      ctx.stroke();
      if (label) drawLabel(cu + ru + 6, cv - fs - 8, label);
    };
    /** Rectangle ROI: two corner taps → stroked rect + area label. */
    const drawRect = (pts: [number, number][], label: string | null, dim: boolean): void => {
      if (pts.length < 2) { drawSet(pts, label, dim); return; }
      const x = Math.min(pts[0]![0], pts[1]![0]), y = Math.min(pts[0]![1], pts[1]![1]);
      const w = Math.abs(pts[1]![0] - pts[0]![0]), h = Math.abs(pts[1]![1] - pts[0]![1]);
      ctx.strokeStyle = dim ? ACCENT_DIM : ACCENT;
      ctx.beginPath();
      ctx.strokeRect(x, y, Math.max(1, w), Math.max(1, h));
      if (label) drawLabel(x + w + 6, y - 8, label);
    };
    /** Cobb angle: four taps = two lines + angle label at the second line. */
    const drawCobb = (pts: [number, number][], label: string | null, dim: boolean): void => {
      if (pts.length < 4) { drawSet(pts, label, dim); return; }
      ctx.strokeStyle = dim ? ACCENT_DIM : ACCENT;
      ctx.fillStyle = dim ? ACCENT_DIM_FILL : ACCENT_HI;
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      ctx.lineTo(pts[1]![0], pts[1]![1]);
      ctx.moveTo(pts[2]![0], pts[2]![1]);
      ctx.lineTo(pts[3]![0], pts[3]![1]);
      ctx.stroke();
      for (const [x, y] of pts) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2.5, W / 110), 0, Math.PI * 2);
        ctx.fill();
      }
      if (label) {
        const [lx, ly] = pts[3]!;
        drawLabel(lx + 6, ly - fs - 8, label);
      }
    };
    for (const m of rows) {
      const label = m.kind === 'probe' ? `${Math.round(m.value)}` : fmtVal(m.kind as MeasureKind, m.value);
      if (m.kind === 'ellipse') drawEllipse(m.points, label, false);
      else if (m.kind === 'roi') drawRect(m.points, label, false);
      else if (m.kind === 'cobb') drawCobb(m.points, label, false);
      else drawSet(m.points, label, false);
    }
    if (pend.length > 0) {
      const pk = getUi().measureKind;
      if (pk === 'ellipse' && pend.length === 2) drawEllipse(pend, null, true);
      else if (pk === 'roi' && pend.length === 2) drawRect(pend, null, true);
      else drawSet(pend, null, true);
    }
  };

  /** Crosshair sync: a Select-tap jumps every plane to the clicked voxel. */
  const syncToVoxel = (plane: Plane, e: React.PointerEvent): void => {
    const img = session.img;
    const hit = planePoint(hostRef.current, e, plane);
    if (!img || !hit) return;
    session.crosshair = hit.voxel;
    const next = voxelSlices(hit.voxel, img.dims);
    for (const p of PLANES) {
      const s = sliderRefs.current[p];
      if (s) s.value = String(next[p]);
    }
    paintAll();
    // V2 3D cursor follows the synced tap (NiiVue parity: crosshair
    // visible in 3D). Surface repaints from the same session.crosshair.
    paintBus.surface();
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

  const onCanvasDown = (plane: Plane) => (e: React.PointerEvent): void => {
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

  const onAxialUp = (): void => {
    if (strokeState.current.stroke || strokeState.current.oblStroke) {
      strokeState.current.stroke = null;
      strokeState.current.oblStroke = null;
      session.maskVer++;
      paintAll();
      bump();
    }
  };

  const wheelZoom = (plane: Plane) => (e: React.WheelEvent): void => {
    e.preventDefault();
    zoomRef.current[plane] = Math.min(8, Math.max(0.5, zoomRef.current[plane] * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    setZoomTick((t) => t + 1);
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
                onPointerMove={(e) => { paintMove(hostRef.current, strokeState.current, p, e, planeVoxelRef.current); onViewMove(e); }}
                onPointerUp={(e) => { onAxialUp(); onViewUp(p, e); }}
              />
              {/* Framing brackets only. The anatomical edge letters are
                  rasterised onto the canvas from iopEdgeLabels — one
                  implementation, not two (§4). */}
              <div className="vp-hud" aria-hidden="true" />
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
