// Per-pane paint/measure/sync handlers, extracted from MprPanes when the
// double-oblique generalization pushed it past the 700-line gate. Owns the
// tilted-frame builders (obliqueFrame), tap geometry (planePoint), measure
// dispatch (measureClick), and the paint/erase/grow stroke handlers. The
// component keeps canvases, sliders, zoom/pan, and the paint() pipeline;
// this module is called with a small host interface so both sides compile
// without a React import. No DOM globals here beyond the passed events.
import {
  angle as angle3, cobbAngle, cobbAngle3, createMeasurement,
  ellipseArea, ellipseStats, length as length3, obliqueEllipseStats,
  obliquePixelArea, obliqueRectStats, obliqueTapVoxel, probePoint, roiStats,
} from '@carys/measure';
import type { ObliqueFrame } from '@carys/measure';
import { obliqueBasis } from '@carys/render-cpu';
import { audit } from '@carys/study';
import { session } from '../lib/session';
import { getUi } from '../lib/store';
import { toast } from '../lib/toasts';
import { bump } from '../lib/version';
import type { MeasureKind, Plane } from '../lib/types';
import { growFromSeed, pushUndo, stampAt, stampFrameAt, strokeFrameTo, strokeTo } from '../lib/sessionOps';
import type { Volume } from '@carys/volume-core';

export interface TapEvent {
  clientX: number;
  clientY: number;
  buttons?: number;
  pointerId?: number;
  shiftKey?: boolean;
  // React pointer events land here directly: structural (not nominal)
  // typing keeps the call sites free of casts.
  target?: { setPointerCapture?: (id: number) => void } | EventTarget | null;
}

export interface PaintHost {
  contentXY: (plane: Plane, clientX: number, clientY: number) => [number, number];
  planeDims: (plane: Plane) => [number, number];
  planeIdx: (plane: Plane) => number;
  paint: (plane: Plane) => void;
  paintAll: () => void;
  fmtVal: (kind: MeasureKind, v: number) => string;
}

/** Frame state the host component owns (stroke anchors). */
export interface StrokeState {
  stroke: [number, number, number] | null;
  oblStroke: [number, number] | null;
}

/**
 * The exact tilted sampling frame the tilt-plane paint used (null =
 * orthogonal). Double-oblique: the tilt rides oblPlane; the other two
 * planes stay orthogonal.
 */
export function obliqueFrame(
  host: PaintHost, plane: Plane = getUi().oblPlane,
): { key: string; frame: ObliqueFrame; W: number; H: number } | null {
  const img = session.img;
  if (!img) return null;
  const u = getUi();
  if (u.oblA === 0 && u.oblB === 0) return null;
  if (plane !== u.oblPlane) return null;
  const [nx, ny, nz] = img.dims;
  const [W, H] = host.planeDims(plane);
  const idx = host.planeIdx(plane);
  const { row, col } = obliqueBasis(plane, u.oblA, u.oblB);
  // paint centers the frame on the volume middle + slice index along the
  // plane normal (axial: [nx/2, ny/2, idx]; coronal: [nx/2, idx, nz/2]…)
  const center: [number, number, number] = plane === 'axial'
    ? [nx / 2, ny / 2, idx] : plane === 'coronal' ? [nx / 2, idx, nz / 2] : [idx, ny / 2, nz / 2];
  return {
    key: `${plane}:${u.oblA.toFixed(3)}/${u.oblB.toFixed(3)}@${idx}`,
    frame: { center, row, col },
    W, H,
  };
}

export interface PlaneHit {
  uv: [number, number]; w: number; su: number; sv: number;
  voxel: [number, number, number]; voxel3: [number, number, number];
  frame: { key: string; frame: ObliqueFrame; W: number; H: number } | null;
}

/** Plane click point: canvas uv, slice w, spacing, anchor voxel + true voxel3. */
export function planePoint(host: PaintHost, e: TapEvent, plane: Plane): PlaneHit | null {
  const img = session.img;
  if (!img) return null;
  const [nx, ny] = img.dims;
  const sp = img.spacing ?? [1, 1, 1];
  const framed = (u: number, v: number, w: number, su: number, sv: number,
    voxel: [number, number, number]): PlaneHit => {
    const fr = obliqueFrame(host, plane);
    if (!fr) return { uv: [u, v], w, su, sv, voxel, voxel3: voxel, frame: null };
    const [W, H] = host.planeDims(plane);
    const [ii, jj] = host.contentXY(plane, e.clientX, e.clientY);
    const [fx, fy, fz] = obliqueTapVoxel(fr.frame, W, H, ii, jj);
    const [nnx, nny, nnz] = img.dims;
    const v3: [number, number, number] = [
      Math.max(0, Math.min(nnx - 1, Math.round(fx))),
      Math.max(0, Math.min(nny - 1, Math.round(fy))),
      Math.max(0, Math.min(nnz - 1, Math.round(fz))),
    ];
    return { uv: [u, v], w, su, sv, voxel, voxel3: v3, frame: fr };
  };
  if (plane === 'axial') {
    const [i, j] = host.contentXY(plane, e.clientX, e.clientY);
    const x = Math.floor(i), y = Math.floor(j);
    const z = host.planeIdx(plane);
    void nx; void ny;
    return framed(x, y, z, sp[0], sp[1], [x, y, z]);
  }
  if (plane === 'coronal') {
    const [i, j] = host.contentXY(plane, e.clientX, e.clientY);
    const x = Math.floor(i), z = Math.floor(j);
    const y = host.planeIdx(plane);
    return framed(x, z, y, sp[0], sp[2], [x, y, z]);
  }
  const [i, j] = host.contentXY(plane, e.clientX, e.clientY);
  const y = Math.floor(i), z = Math.floor(j);
  const x = host.planeIdx(plane);
  return framed(y, z, x, sp[1], sp[2], [x, y, z]);
}

/** Measure dispatch: accumulates taps, computes on completion, tracks + toasts. */
export function measureClick(host: PaintHost, plane: Plane, e: TapEvent): void {
  const img = session.img;
  const u = getUi();
  if (!img) return;
  const hit = planePoint(host, e, plane);
  if (!hit) return;
  const kind = u.measureKind;
  const frameKey = hit.frame?.key ?? null;
  // a pending stroke belongs to one frame: a tilt change or a plane
  // switch mid-stroke restarts it (stale taps would corrupt the value)
  if (session.pendingPlane !== null
    && (session.pendingPlane !== plane || session.pendingFrame !== frameKey)) {
    session.pendingMeasure = [];
    session.pendingVoxel = [];
  }
  session.pendingPlane = plane;
  session.pendingFrame = frameKey;
  const pts = [...session.pendingMeasure, hit.uv];
  const pts3 = [...session.pendingVoxel, hit.voxel3];
  const need = kind === 'length' || kind === 'ellipse' || kind === 'roi' ? 2
    : kind === 'angle' ? 3 : kind === 'cobb' ? 4 : 1;
  if (pts.length < need) {
    session.pendingMeasure = pts;
    session.pendingVoxel = pts3;
    bump();
    host.paint(plane);
    return;
  }
  const sp: [number, number, number] = img.spacing ?? [1, 1, 1];
  const vol: Volume = {
    dims: img.dims, spacing: sp, origin: [0, 0, 0], dtype: 'float64', data: img.data,
  };
  const fr = hit.frame; // non-null only on the tilted plane
  let value = 0;
  let unit = kind === 'angle' || kind === 'cobb' ? 'deg' : kind === 'probe' ? ''
    : kind === 'ellipse' || kind === 'roi' ? 'mm²' : 'mm';
  let detail = fr ? ' · oblique' : '';
  if (kind === 'length') {
    value = fr ? length3(pts3[0]!, pts3[1]!, sp)
      : Math.hypot((pts[1]![0] - pts[0]![0]) * hit.su, (pts[1]![1] - pts[0]![1]) * hit.sv);
  } else if (kind === 'ellipse') {
    const cu = (pts[0]![0] + pts[1]![0]) / 2, cv = (pts[0]![1] + pts[1]![1]) / 2;
    const ru = Math.abs(pts[1]![0] - pts[0]![0]) / 2, rv = Math.abs(pts[1]![1] - pts[0]![1]) / 2;
    if (ru < 1 || rv < 1) {
      toast('ellipse needs two distinct corners — tap wider apart');
      return;
    }
    const st = fr
      ? obliqueEllipseStats(vol, fr.frame, fr.W, fr.H, cu, cv, ru, rv)
      : ellipseStats(vol, plane, hit.w, cu, cv, ru, rv);
    value = fr
      ? Math.PI * ru * rv * obliquePixelArea(fr.frame, sp)
      : ellipseArea(ru, rv, hit.su, hit.sv);
    detail = (fr ? detail : '') + (Number.isFinite(st.mean)
      ? ` · μ ${st.mean.toFixed(0)} σ ${st.std.toFixed(0)} [${Math.round(st.min)}..${Math.round(st.max)}] n=${st.count}`
      : ' · no voxels');
  } else if (kind === 'angle') {
    value = (() => {
      if (!fr) {
        return angle3(
          [pts[0]![0], pts[0]![1], 0], [pts[1]![0], pts[1]![1], 0], [pts[2]![0], pts[2]![1], 0],
        );
      }
      const phys = pts3.map((p): [number, number, number] =>
        [p[0] * sp[0], p[1] * sp[1], p[2] * sp[2]]);
      return angle3(phys[0]!, phys[1]!, phys[2]!);
    })();
  } else if (kind === 'roi') {
    const w = Math.abs(pts[1]![0] - pts[0]![0]), h = Math.abs(pts[1]![1] - pts[0]![1]);
    if (w < 1 || h < 1) {
      toast('rect needs two distinct corners — tap wider apart');
      return;
    }
    const st = fr
      ? obliqueRectStats(vol, fr.frame, fr.W, fr.H, pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1])
      : roiStats(vol, pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1], hit.w, plane);
    value = fr
      ? w * h * obliquePixelArea(fr.frame, sp)
      : w * hit.su * (h * hit.sv);
    detail = (fr ? detail : '') + (Number.isFinite(st.mean)
      ? ` · μ ${st.mean.toFixed(0)} σ ${st.std.toFixed(0)} [${Math.round(st.min)}..${Math.round(st.max)}] n=${st.count}`
      : ' · no voxels');
  } else if (kind === 'cobb') {
    value = fr ? cobbAngle3(pts3[0]!, pts3[1]!, pts3[2]!, pts3[3]!, sp)
      : cobbAngle(pts[0]!, pts[1]!, pts[2]!, pts[3]!);
  } else {
    value = probePoint(vol, hit.voxel3[0], hit.voxel3[1], hit.voxel3[2]) ?? NaN;
    unit = 'HU';
  }
  const created = createMeasurement(kind, plane, hit.w, pts, value, unit, u.series);
  session.measurements.push(created);
  audit('measure.create', u.series, `${created.label}: ${host.fmtVal(kind, value)}${unit ? ` ${unit}` : ''}`);
  session.pendingMeasure = [];
  session.pendingVoxel = [];
  session.pendingPlane = null;
  session.pendingFrame = null;
  bump();
  host.paint(plane);
  toast(`${kind}: ${host.fmtVal(kind, value)}${kind === 'probe' ? ` ${unit}` : ''}${detail}`);
}

/** Orthogonal voxel of a plane tap (axial [x,y,z], coronal y = slice, sagittal x = slice). */
export function planeLattice(
  host: PaintHost, plane: Plane, e: TapEvent,
  planeVoxel: (plane: Plane, clientX: number, clientY: number) => [number, number],
): [number, number, number] {
  const [a, b] = planeVoxel(plane, e.clientX, e.clientY);
  const w = host.planeIdx(plane);
  return plane === 'axial' ? [a, b, w] : plane === 'coronal' ? [a, w, b] : [w, a, b];
}

/** Paint/erase/grow pointer-down on any plane (frame-aware). */
export function paintDown(
  host: PaintHost, st: StrokeState, plane: Plane, e: TapEvent,
  planeVoxel: (plane: Plane, clientX: number, clientY: number) => [number, number],
): void {
  const u = getUi();
  if (u.tool === 'view' || !session.editMask) return;
  const fr = obliqueFrame(host, plane);
  if (!fr && (u.proj !== 'slice')) {
    toast('Reset to orthogonal slice to edit');
    return;
  }
  if (u.tool === 'grow') {
    if (fr || plane !== getUi().oblPlane || getUi().oblA !== 0 || getUi().oblB !== 0) {
      if (fr || plane !== 'axial') {
        toast('Reset to orthogonal slice to grow');
        return;
      }
    }
    const [a, b] = planeVoxel('axial', e.clientX, e.clientY);
    const n = growFromSeed(a, b, host.planeIdx('axial'));
    pushUndo();
    host.paint('axial');
    toast(n > 0 ? `Grew ${n.toLocaleString()} voxels [${u.growLo}, ${u.growHi}]` : 'Seed outside window — adjust Lo/Hi');
    return;
  }
  (e.target as { setPointerCapture?: (id: number) => void } | null)
    ?.setPointerCapture?.(e.pointerId ?? 0);
  // the stroke's snapshot is taken when it ends (MprPanes' pointer up)
  const v = getUi().tool === 'paint' ? 1 : 0;
  if (fr) {
    const [i, j] = host.contentXY(plane, e.clientX, e.clientY);
    const n = stampFrameAt(fr.frame, fr.W, fr.H, i, j, v);
    st.stroke = null;
    st.oblStroke = [i, j];
    host.paint(plane);
    if (n === 0) toast('Oblique tap fell outside the volume');
    return;
  }
  const [x, y, z] = planeLattice(host, plane, e, planeVoxel);
  stampAt(x, y, z, v);
  st.stroke = [x, y, z];
  host.paint(plane);
}

/** Paint/erase pointer-move on any plane (frame-aware). */
export function paintMove(
  host: PaintHost, st: StrokeState, plane: Plane, e: TapEvent,
  planeVoxel: (plane: Plane, clientX: number, clientY: number) => [number, number],
): void {
  const t = getUi().tool;
  if ((t !== 'paint' && t !== 'erase') || !session.editMask || !(e.buttons! & 1)) return;
  const v = getUi().tool === 'paint' ? 1 : 0;
  const fr = obliqueFrame(host, plane);
  if (fr) {
    if (!st.oblStroke) return;
    const [i, j] = host.contentXY(plane, e.clientX, e.clientY);
    strokeFrameTo(fr.frame, fr.W, fr.H, st.oblStroke, [i, j], v);
    st.oblStroke = [i, j];
    host.paint(plane);
    return;
  }
  if (!st.stroke) return;
  const [x, y, z] = planeLattice(host, plane, e, planeVoxel);
  strokeTo(st.stroke, [x, y, z], v);
  stampAt(x, y, z, v);
  st.stroke = [x, y, z];
  host.paint(plane);
}
