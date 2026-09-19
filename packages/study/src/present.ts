// GSPS-flavored presentation state (medical/science lane, P0 read parity).
// Pure: snapshot in, canonical JSON out, loud parse back. The React shell
// gathers the snapshot (session + store + pane transforms via
// paintBus.getMprView) and applies an uploaded file back through
// paintBus.setMprView; this module never touches the DOM, so the
// engine/DOM separation gate holds.
//
// DICOM mapping (PS3.11, JSON shape — the Part-10 binary writer stays out):
// WL/preset → VOI LUT Sequence Window Center/Width (C.11.2); slices →
// Referenced Image Sequence (needs per-slice SOP Instance UIDs, which the
// loaders retain none of — the dims gate stands in); zoom/pan → Displayed
// Area Sequence (zoom + offset regenerate the transform); annotations →
// Graphic Annotations Sequence (LINE/POLYLINE/POINT per kind). LUT names +
// invert ride Presentation LUT; the stored name is never guessed.
import type { Measurement } from '@carys/measure';
import { REPRO_PRODUCER } from './repro.js';

/** Wire format id. Bump the suffix when the field set changes. */
export const PRESENT_FORMAT = 'carys-present/1';
/** Legacy format id, still accepted on read (files written before the Carys rename). */
export const PRESENT_FORMAT_LEGACY = 'omniviewer-present/1';
/** DICOM Grayscale Softcopy Presentation State Storage SOP Class: the
 *  binary object this JSON can become once per-slice UIDs are retained. */
export const GSPS_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.11.1';

export type PresentPlane = 'axial' | 'coronal' | 'sagittal';

export interface PresentSlices {
  axial: number;
  coronal: number;
  sagittal: number;
}

export interface PresentWindow {
  width: number;
  center: number;
}

/** One pane transform: CSS zoom with pixel pan (translate pre-scale,
 *  transform-origin center — the MprPanes applyPanZoom contract). */
export interface PresentView {
  zoom: number;
  x: number;
  y: number;
}

export interface PresentViews {
  axial: PresentView;
  coronal: PresentView;
  sagittal: PresentView;
}

/** Everything needed to restore the read: identity (series + DICOM UIDs),
 *  geometry (dims/spacing/slices), display (WL/preset/LUT/invert/proj/
 *  slab/obliquity), viewport (per-plane zoom/pan), annotations (full
 *  tracked measurements, all pinned to this series). */
export interface PresentState {
  format: string;
  producer: string;
  generatedAt: string;
  gspsSOPClass: string;
  series: string;
  studyUID: string | null;
  seriesUID: string | null;
  dims: [number, number, number];
  spacing: [number, number, number];
  slices: PresentSlices;
  wl: PresentWindow;
  preset: string;
  lut: string;
  invert: boolean;
  proj: string;
  slab: number;
  oblA: number;
  oblB: number;
  oblPlane: PresentPlane;
  view: PresentViews;
  annotations: Measurement[];
}

/** Builder input: every field but the envelope (generatedAt defaults to now). */
export type PresentInput = Omit<PresentState, 'format' | 'producer' | 'generatedAt' | 'gspsSOPClass'> & {
  generatedAt?: string;
};

const PLANES: PresentPlane[] = ['axial', 'coronal', 'sagittal'];
/** Annotation kinds the panes can redraw (tracking.ts MeasureKind). */
const KINDS = ['length', 'angle', 'probe', 'roi', 'ellipse', 'cobb'];
/** Pane zoom clamp, same bounds as the MprPanes wheel/step clamp. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 8;

const isIntTrip = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n));

const isNumTrip = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

const isView = (v: unknown): v is PresentView => {
  const r = v as Record<string, unknown>;
  return !!r && Number.isFinite(r.zoom) && (r.zoom as number) >= ZOOM_MIN && (r.zoom as number) <= ZOOM_MAX
    && Number.isFinite(r.x) && Number.isFinite(r.y);
};

function checkAnnotation(m: unknown, series: string): void {
  const bad = (why: string): Error => new Error(`bad-present-input: annotation ${why}`);
  const r = m as Record<string, unknown>;
  if (!r || typeof r !== 'object') throw bad('must be an object');
  if (!r.id || typeof r.id !== 'string') throw bad('id must be a non-empty string');
  if (!KINDS.includes(r.kind as string)) throw bad(`kind must be one of ${KINDS.join('/')}, got ${JSON.stringify(r.kind)}`);
  if (typeof r.label !== 'string' || r.label.length === 0) throw bad('label must be a non-empty string');
  if (!PLANES.includes(r.plane as PresentPlane)) throw bad(`plane must be a plane, got ${JSON.stringify(r.plane)}`);
  if (!Number.isInteger(r.slice) || (r.slice as number) < 0) throw bad('slice must be a non-negative int');
  if (!Array.isArray(r.points) || r.points.length === 0) throw bad('points must be a non-empty array');
  for (const p of r.points as unknown[]) {
    const q = p as unknown[];
    if (!Array.isArray(q) || q.length !== 2 || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) {
      throw bad('points must be [x, y] finite pairs');
    }
  }
  if (!Number.isFinite(r.value)) throw bad('value must be finite');
  if (typeof r.unit !== 'string') throw bad('unit must be a string');
  if (r.series !== series) throw bad(`series ${JSON.stringify(r.series)} != presentation ${JSON.stringify(series)}`);
  if (!r.createdAt || typeof r.createdAt !== 'string') throw bad('createdAt must be a non-empty string');
}

/** Fail-loud input check: a presentation that can't restore the read is
 *  worse than none, so bad snapshots throw `bad-present-input` here. */
export function buildPresentState(input: PresentInput): PresentState {
  const bad = (why: string): Error => new Error(`bad-present-input: ${why}`);
  if (!input.series || typeof input.series !== 'string') throw bad('series must be a non-empty string');
  if (!isIntTrip(input.dims)) throw bad(`dims must be 3 ints, got [${input.dims}]`);
  if (!isNumTrip(input.spacing) || input.spacing.some((s) => s <= 0)) throw bad('spacing must be 3 finite positives');
  for (const p of PLANES) {
    const s = input.slices?.[p];
    if (!Number.isInteger(s) || (s as number) < 0) throw bad(`slices.${p} must be a non-negative int`);
  }
  if (!input.wl || !Number.isFinite(input.wl.width) || !Number.isFinite(input.wl.center)) {
    throw bad('wl width/center must be finite');
  }
  for (const k of ['preset', 'lut', 'proj'] as const) {
    if (!input[k] || typeof input[k] !== 'string') throw bad(`${k} must be a non-empty string`);
  }
  if (typeof input.invert !== 'boolean') throw bad('invert must be a boolean');
  if (!Number.isInteger(input.slab) || input.slab < 1) throw bad('slab must be an int >= 1');
  if (!Number.isFinite(input.oblA) || !Number.isFinite(input.oblB)) throw bad('oblA/oblB must be finite');
  if (!PLANES.includes(input.oblPlane)) throw bad(`oblPlane must be a plane, got ${input.oblPlane}`);
  for (const p of PLANES) {
    if (!isView(input.view?.[p])) throw bad(`view.${p} must be { zoom ${ZOOM_MIN}..${ZOOM_MAX}, finite x/y }`);
  }
  if (!Array.isArray(input.annotations)) throw bad('annotations must be an array');
  for (const m of input.annotations) checkAnnotation(m, input.series);
  // Fixed key order: the JSON is byte-stable for the same snapshot.
  return {
    format: PRESENT_FORMAT,
    producer: REPRO_PRODUCER,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    gspsSOPClass: GSPS_SOP_CLASS,
    series: input.series,
    studyUID: input.studyUID ?? null,
    seriesUID: input.seriesUID ?? null,
    dims: input.dims,
    spacing: input.spacing,
    slices: { axial: input.slices.axial, coronal: input.slices.coronal, sagittal: input.slices.sagittal },
    wl: { width: input.wl.width, center: input.wl.center },
    preset: input.preset,
    lut: input.lut,
    invert: input.invert,
    proj: input.proj,
    slab: input.slab,
    oblA: input.oblA,
    oblB: input.oblB,
    oblPlane: input.oblPlane,
    view: {
      axial: { ...input.view.axial },
      coronal: { ...input.view.coronal },
      sagittal: { ...input.view.sagittal },
    },
    annotations: input.annotations,
  };
}

export function presentStateToJSON(state: PresentState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** Loud parse: bad JSON, wrong format/class, and missing/misshaped fields
 *  each name themselves (`bad-json` / `bad-present`). */
export function parsePresentState(text: string): PresentState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('bad-json: presentation is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('bad-present: top level must be an object');
  }
  const r = raw as Record<string, unknown>;
  if (r.format !== PRESENT_FORMAT && r.format !== PRESENT_FORMAT_LEGACY) {
    throw new Error(`bad-present: format ${JSON.stringify(r.format ?? null)} != ${PRESENT_FORMAT}`);
  }
  const missing = [
    'series', 'dims', 'spacing', 'slices', 'wl', 'preset', 'lut',
    'invert', 'proj', 'slab', 'oblA', 'oblB', 'oblPlane', 'view', 'annotations',
  ].filter((k) => r[k] === undefined);
  if (missing.length > 0) throw new Error(`bad-present: missing ${missing.join(', ')}`);
  if (r.gspsSOPClass !== GSPS_SOP_CLASS) {
    throw new Error(`bad-present: gspsSOPClass ${JSON.stringify(r.gspsSOPClass ?? null)} != ${GSPS_SOP_CLASS}`);
  }
  if (!isIntTrip(r.dims)) throw new Error('bad-present: dims must be 3 ints');
  const sl = r.slices as Record<string, unknown>;
  for (const p of PLANES) {
    if (!Number.isInteger(sl?.[p])) throw new Error(`bad-present: slices.${p} must be an int`);
  }
  const wl = r.wl as Record<string, unknown>;
  if (!Number.isFinite(wl?.width) || !Number.isFinite(wl?.center)) {
    throw new Error('bad-present: wl width/center must be finite');
  }
  const vw = r.view as Record<string, unknown>;
  for (const p of PLANES) {
    if (!isView(vw?.[p])) throw new Error(`bad-present: view.${p} must be { zoom ${ZOOM_MIN}..${ZOOM_MAX}, finite x/y }`);
  }
  if (!Array.isArray(r.annotations)) throw new Error('bad-present: annotations must be an array');
  const series = r.series as string;
  for (const m of r.annotations as unknown[]) {
    const row = m as Record<string, unknown>;
    const okKind = KINDS.includes(row?.kind as string);
    const okPlane = PLANES.includes(row?.plane as PresentPlane);
    const okPts = Array.isArray(row?.points) && (row.points as unknown[]).length > 0
      && (row.points as unknown[]).every((q) => Array.isArray(q) && (q as unknown[]).length === 2
        && Number.isFinite((q as unknown[])[0]) && Number.isFinite((q as unknown[])[1]));
    if (typeof row?.id !== 'string' || !row.id || !okKind || !okPlane
      || !Number.isInteger(row?.slice) || !okPts || !Number.isFinite(row?.value)) {
      throw new Error('bad-present: annotations must be tracked measurements for this series');
    }
    if (row.series !== series) throw new Error('bad-present: annotation series != presentation series');
  }
  return r as unknown as PresentState;
}

/** Fields a save→load roundtrip must preserve. [] = exact restore;
 *  anything else names the drifted field(s). */
export function presentStateDiff(a: PresentState, b: PresentState): string[] {
  const diff: string[] = [];
  const eq = (name: string, x: unknown, y: unknown): void => {
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      diff.push(`${name}: saved ${JSON.stringify(x)} != loaded ${JSON.stringify(y)}`);
    }
  };
  eq('series', a.series, b.series);
  eq('dims', a.dims, b.dims);
  eq('spacing', a.spacing, b.spacing);
  eq('slices', a.slices, b.slices);
  eq('wl', a.wl, b.wl);
  eq('preset', a.preset, b.preset);
  eq('lut', a.lut, b.lut);
  eq('invert', a.invert, b.invert);
  eq('proj', a.proj, b.proj);
  eq('slab', a.slab, b.slab);
  eq('oblA', a.oblA, b.oblA);
  eq('oblB', a.oblB, b.oblB);
  eq('oblPlane', a.oblPlane, b.oblPlane);
  eq('view', a.view, b.view);
  eq('annotations.length', a.annotations.length, b.annotations.length);
  const n = Math.min(a.annotations.length, b.annotations.length);
  for (let i = 0; i < n; i++) {
    const s = a.annotations[i]!;
    const t = b.annotations[i]!;
    for (const k of ['id', 'kind', 'label', 'plane', 'slice', 'value', 'unit'] as const) {
      eq(`annotations[${i}].${k}`, s[k], t[k]);
    }
    eq(`annotations[${i}].points`, s.points, t.points);
  }
  return diff;
}
