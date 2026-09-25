// Reproducibility JSON sidecar (medical/science lane, ship-first item).
// Pure: snapshot in, canonical JSON out, loud parse back. The React shell
// assembles the snapshot from session + store (ReportView); this module
// never touches the DOM, so the engine/DOM separation gate holds.
import type { ReportMeasurement, StudyReport, ValidationIssue } from './report.js';

/** Wire format id. Bump the suffix when the field set changes. */
export const REPRO_FORMAT = 'carys-repro/1';
/** Legacy format id, still accepted on read (files written before the Carys rename). */
export const REPRO_FORMAT_LEGACY = 'omniviewer-repro/1';
/** Producer stamp. Bump alongside the root package.json version. */
export const REPRO_PRODUCER = 'carys-0.1.0';
/** Legacy producer stamp, still accepted on read (files written before the Carys rename). */
export const REPRO_PRODUCER_LEGACY = 'omniviewer-0.1.0';

export interface ReproSlices {
  axial: number;
  coronal: number;
  sagittal: number;
}

export interface ReproWindow {
  width: number;
  center: number;
}

/** Everything needed to regenerate the report figure: identity (series +
 *  DICOM UIDs), geometry (dims/spacing/slices), display (WL/preset/LUT/
 *  invert/proj/slab/obliquity), derivation (src/threshold/method/maskVer/
 *  meshKey + digest pins), results (mask + measurements + validation). */
export interface ReproSidecar {
  format: string;
  producer: string;
  generatedAt: string;
  series: string;
  studyUID: string | null;
  seriesUID: string | null;
  dims: [number, number, number];
  spacing: [number, number, number];
  slices: ReproSlices;
  wl: ReproWindow;
  preset: string;
  lut: string;
  invert: boolean;
  proj: string;
  slab: number;
  oblA: number;
  oblB: number;
  oblPlane: string;
  src: string;
  threshold: number;
  method: string;
  maskVer: number;
  meshKey: string;
  /**
   * Digest pins (digest id → version pin, e.g. { 'z-anatomy': 'v2.1' }):
   * empty when no digest contributed to the figure. Carries the
   * digest pins so a figure built over atlas/provenance data regenerates
   * against the same knowledge bytes.
   */
  digestPins: Record<string, string>;
  maskVoxels: number;
  maskCm3: number;
  measurements: ReportMeasurement[];
  validation: { ok: boolean; issues: ValidationIssue[] };
}

/** Builder input: every field but the envelope (generatedAt defaults to now). */
export type ReproInput = Omit<ReproSidecar, 'format' | 'producer' | 'generatedAt'> & {
  generatedAt?: string;
};

const isIntTrip = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n));

const isNumTrip = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Fail-loud input check: a sidecar that can't regenerate the figure is
 *  worse than none, so bad snapshots throw `bad-sidecar-input` here. */
export function buildReproSidecar(input: ReproInput): ReproSidecar {
  const bad = (why: string): Error => new Error(`bad-sidecar-input: ${why}`);
  if (!input.series || typeof input.series !== 'string') throw bad('series must be a non-empty string');
  if (!isIntTrip(input.dims)) throw bad(`dims must be 3 ints, got [${input.dims}]`);
  if (!isNumTrip(input.spacing) || input.spacing.some((s) => s <= 0)) throw bad('spacing must be 3 finite positives');
  for (const p of ['axial', 'coronal', 'sagittal'] as const) {
    const s = input.slices?.[p];
    if (!Number.isInteger(s) || (s as number) < 0) throw bad(`slices.${p} must be a non-negative int`);
  }
  if (!input.wl || !Number.isFinite(input.wl.width) || !Number.isFinite(input.wl.center)) {
    throw bad('wl width/center must be finite');
  }
  if (!Number.isInteger(input.slab) || input.slab < 1) throw bad('slab must be an int >= 1');
  if (!Number.isFinite(input.oblA) || !Number.isFinite(input.oblB)) throw bad('oblA/oblB must be finite');
  if (!['axial', 'coronal', 'sagittal'].includes(input.oblPlane)) throw bad(`oblPlane must be a plane, got ${input.oblPlane}`);
  if (!Number.isFinite(input.threshold)) throw bad('threshold must be finite');
  if (!input.meshKey || typeof input.meshKey !== 'string') throw bad('meshKey must be a non-empty string');
  if (!Number.isInteger(input.maskVer) || input.maskVer < 0) throw bad('maskVer must be a non-negative int');
  const pins = (input as { digestPins?: unknown }).digestPins ?? {};
  if (!pins || typeof pins !== 'object' || Array.isArray(pins)) throw bad('digestPins must be an object');
  for (const [k, v] of Object.entries(pins as Record<string, unknown>)) {
    if (!k || typeof v !== 'string' || !v) throw bad(`digestPins[${JSON.stringify(k)}] must be a non-empty string`);
  }
  if (!Number.isInteger(input.maskVoxels) || input.maskVoxels < 0) throw bad('maskVoxels must be a non-negative int');
  if (!Number.isFinite(input.maskCm3) || input.maskCm3 < 0) throw bad('maskCm3 must be finite and >= 0');
  if (!Array.isArray(input.measurements)) throw bad('measurements must be an array');
  // Fixed key order: the JSON is byte-stable for the same snapshot.
  return {
    format: REPRO_FORMAT,
    producer: REPRO_PRODUCER,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
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
    src: input.src,
    threshold: input.threshold,
    method: input.method,
    maskVer: input.maskVer,
    meshKey: input.meshKey,
    digestPins: { ...(pins as Record<string, string>) },
    maskVoxels: input.maskVoxels,
    maskCm3: input.maskCm3,
    measurements: input.measurements,
    validation: input.validation,
  };
}

export function reproSidecarToJSON(sidecar: ReproSidecar): string {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}

/** Loud parse: bad JSON, wrong format, and missing/misshaped fields each
 *  name themselves (`bad-json` / `bad-sidecar`). */
export function parseReproSidecar(text: string): ReproSidecar {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('bad-json: sidecar is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('bad-sidecar: top level must be an object');
  }
  const r = raw as Record<string, unknown>;
  if (r.format !== REPRO_FORMAT && r.format !== REPRO_FORMAT_LEGACY) {
    throw new Error(`bad-sidecar: format ${JSON.stringify(r.format ?? null)} != ${REPRO_FORMAT}`);
  }
  const missing = [
    'series', 'dims', 'spacing', 'slices', 'wl', 'preset', 'lut', 'proj',
    'src', 'threshold', 'method', 'maskVer', 'meshKey', 'digestPins', 'maskVoxels',
    'maskCm3', 'measurements', 'validation',
  ].filter((k) => r[k] === undefined);
  if (missing.length > 0) throw new Error(`bad-sidecar: missing ${missing.join(', ')}`);
  if (!isIntTrip(r.dims)) throw new Error('bad-sidecar: dims must be 3 ints');
  const sl = r.slices as Record<string, unknown>;
  for (const p of ['axial', 'coronal', 'sagittal']) {
    if (!Number.isInteger(sl?.[p])) throw new Error(`bad-sidecar: slices.${p} must be an int`);
  }
  const wl = r.wl as Record<string, unknown>;
  if (!Number.isFinite(wl?.width) || !Number.isFinite(wl?.center)) {
    throw new Error('bad-sidecar: wl width/center must be finite');
  }
  if (!Array.isArray(r.measurements)) throw new Error('bad-sidecar: measurements must be an array');
  return r as unknown as ReproSidecar;
}

/** Fields the HTML report and the sidecar must agree on. [] = parity;
 *  anything else names the drifted field(s). */
export function sidecarReportDiff(sidecar: ReproSidecar, report: StudyReport): string[] {
  const diff: string[] = [];
  const eq = (name: string, a: unknown, b: unknown): void => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diff.push(`${name}: sidecar ${JSON.stringify(a)} != report ${JSON.stringify(b)}`);
    }
  };
  eq('series', sidecar.series, report.series);
  eq('dims', sidecar.dims, report.dims);
  eq('spacing', sidecar.spacing, report.spacing);
  eq('maskVoxels', sidecar.maskVoxels, report.maskVoxels);
  eq('maskCm3', sidecar.maskCm3, report.maskCm3);
  eq('measurements.length', sidecar.measurements.length, report.measurements.length);
  const n = Math.min(sidecar.measurements.length, report.measurements.length);
  for (let i = 0; i < n; i++) {
    const s = sidecar.measurements[i]!;
    const r = report.measurements[i]!;
    for (const k of ['label', 'kind', 'value', 'unit', 'plane', 'slice'] as const) {
      eq(`measurements[${i}].${k}`, s[k], r[k]);
    }
  }
  return diff;
}
