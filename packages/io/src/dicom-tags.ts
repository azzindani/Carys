// Ported from Daikon src/tag.js (TAG_* table), src/parser.js (Transfer Syntax
// UIDs + VR state machine constants), src/series.js (sorting keys). BSD-3-Clause
// (notice in docs/THIRD-PARTY.md).
// Slim VR dict (~30 entries) instead of 3,712-line dictionary.js.

import type { Dataset } from './dcm-read.js';
import type { DicomFileMeta } from './dicom-parse.js';
import { RTDOSE_SOP_CLASS, RTPLAN_SOP_CLASS, doseStats, dvhLabel, parseRtDose, parseRtPlan } from './rt.js';
import {
  encapsulatedDocLabel, isEncapsulatedSopClass, isVlSopClass,
  parseEncapsulatedDoc, parseVlGrid, vlGridLabel,
} from './wsi.js';
import { stackPixelSpacing, stackZGap } from './tomo.js';
import {
  cineFields, usRegionsFromDataset, usRegionSpacingMm,
  type UsRegion,
} from './us.js';
import { regionDataTypeName } from './us-names.js';

export const TAG_ROWS = '00280010';
export const TAG_COLS = '00280011';
export const TAG_BITS_ALLOCATED = '00280100';
export const TAG_BITS_STORED = '00280101';
export const TAG_PIXEL_REPRESENTATION = '00280103';
export const TAG_SAMPLES_PER_PIXEL = '00280002';
export const TAG_PHOTOMETRIC = '00280004';
export const TAG_PLANAR_CONFIG = '00280006';
export const TAG_PIXEL_SPACING = '00280030';
export const TAG_SLICE_THICKNESS = '00180050';
export const TAG_SLICE_GAP = '00180088';
export const TAG_IMAGE_POSITION = '00200032';
export const TAG_IMAGE_ORIENTATION = '00200037';
export const TAG_IMAGE_NUMBER = '00200013';
export const TAG_SLICE_LOCATION = '00201041';
export const TAG_SERIES_UID = '0020000E';
export const TAG_SERIES_NUMBER = '00200011';
export const TAG_TRANSFER_SYNTAX = '00020010';
export const TAG_PIXEL_DATA = '7FE00010';
export const TAG_SLOPE = '00281053';
export const TAG_INTERCEPT = '00281052';
export const TAG_WINDOW_CENTER = '00281050';
export const TAG_WINDOW_WIDTH = '00281051';
export const TAG_NUMBER_OF_FRAMES = '00280008';

// Transfer Syntax UIDs (Daikon parser.js)
export const TS_IMPLICIT_LE = '1.2.840.10008.1.2';
export const TS_EXPLICIT_LE = '1.2.840.10008.1.2.1';
export const TS_EXPLICIT_BE = '1.2.840.10008.1.2.2';
export const TS_DEFLATED = '1.2.840.10008.1.2.1.99';
export const TS_RLE = '1.2.840.10008.1.2.5';
export const TS_JPEG_BASELINE_8 = '1.2.840.10008.1.2.4.50';
export const TS_JPEG_LOSSLESS_1 = '1.2.840.10008.1.2.4.70';
export const TS_JPEG_LS_LOSSLESS = '1.2.840.10008.1.2.4.80';
export const TS_JPEG_LS_NEARLOSSLESS = '1.2.840.10008.1.2.4.81';

/**
 * v3 policy: accept uncompressed + deflate + RLE lossless + JPEG Baseline
 * 8-bit + JPEG Lossless SOF3 + JPEG-LS lossless (CPU decoders in
 * dicom-rle.ts / jpeg-baseline.ts / jpeg-lossless.ts / jpeg-ls.ts).
 * Every other encapsulated syntax (JPEG-LS near-lossless, JPEG-2000,
 * hierarchical, 12-bit baseline) throws a named error.
 */
export function checkTransferSyntax(uid: string): void {
  if (
    uid === TS_IMPLICIT_LE || uid === TS_EXPLICIT_LE ||
    uid === TS_EXPLICIT_BE || uid === TS_DEFLATED ||
    uid === TS_RLE || uid === TS_JPEG_BASELINE_8 || uid === TS_JPEG_LOSSLESS_1 ||
    uid === TS_JPEG_LS_LOSSLESS
  ) {
    return;
  }
  if (uid.startsWith('1.2.840.10008.1.2.4')) {
    throw new Error(`UnsupportedTransferSyntax: JPEG ${uid} — only Baseline 8-bit decodes on CPU`);
  }
  if (uid === TS_RLE) {
    throw new Error(`UnsupportedTransferSyntax: RLE ${uid}`);
  }
  throw new Error(`UnsupportedTransferSyntax: ${uid}`);
}

/** Slim VR dict for Implicit-VR fallback (Daikon getVR fallback OB). */
const SLIM_VR: Record<string, string> = {
  [TAG_ROWS]: 'US', [TAG_COLS]: 'US',
  [TAG_BITS_ALLOCATED]: 'US', [TAG_BITS_STORED]: 'US',
  [TAG_PIXEL_REPRESENTATION]: 'US', [TAG_SAMPLES_PER_PIXEL]: 'US',
  [TAG_IMAGE_NUMBER]: 'IS', [TAG_SLICE_LOCATION]: 'DS',
  [TAG_IMAGE_POSITION]: 'DS', [TAG_IMAGE_ORIENTATION]: 'DS',
  [TAG_PIXEL_SPACING]: 'DS', [TAG_SLICE_THICKNESS]: 'DS',
  [TAG_SLOPE]: 'DS', [TAG_INTERCEPT]: 'DS',
  [TAG_WINDOW_CENTER]: 'DS', [TAG_WINDOW_WIDTH]: 'DS',
  [TAG_SERIES_UID]: 'UI', [TAG_TRANSFER_SYNTAX]: 'UI',
  [TAG_PIXEL_DATA]: 'OB',
};

export function getVR(tagId: string): string {
  return SLIM_VR[tagId.toUpperCase()] ?? 'OB';
}

/** Papaya-compatible series grouping id (Daikon getSeriesId). */
export function seriesId(fields: {
  seriesDescription?: string;
  seriesUID?: string;
  seriesNumber?: string;
  orientation?: string;
  cols?: number;
  rows?: number;
}): string {
  return [
    fields.seriesDescription ?? '', fields.seriesUID ?? '',
    fields.seriesNumber ?? '', fields.orientation ?? '',
    `${fields.cols ?? 0}x${fields.rows ?? 0}`,
  ].join('|');
}

/** Pixel value formula (Daikon getInterpretedData): (raw & mask) * slope + inter. */
export function applySlopeIntercept(
  raw: number, bitsStored: number, signed: boolean, slope: number, intercept: number,
): number {
  const mask = bitsStored >= 32 ? 0xffffffff : (1 << bitsStored) - 1;
  let v = raw & mask;
  if (signed) {
    const signBit = 1 << (bitsStored - 1);
    if (v & signBit) v -= 1 << bitsStored;
  }
  return v * slope + intercept;
}

/** Display-oriented DICOM header summary: the tag browser's data model.
 *  Two sources feed it — a live Dataset (uploads) or a DicomFileMeta
 *  (catalog series, via fileMetaToSummary). Absent tags stay null. */
export interface DicomTagSummary {
  sopClassUID: string | null;
  modality: string | null;
  studyUID: string | null;
  seriesUID: string | null;
  seriesNumber: number | null;
  seriesDescription: string | null;
  patientName: string | null;
  patientID: string | null;
  studyDate: string | null;
  studyTime: string | null;
  manufacturer: string | null;
  model: string | null;
  institution: string | null;
  rows: number | null;
  cols: number | null;
  bitsStored: number | null;
  frames: number | null;
  windowCenter: number | null;
  windowWidth: number | null;
  slope: number | null;
  intercept: number | null;
  pixelSpacing: [number, number] | null;
  sliceThickness: number | null;
  iop: [number, number, number, number, number, number] | null;
  /** Mammo context: in-plane spacing incl. imager fallback, z interval. */
  tomoSpacingMm: [number, number] | null;
  tomoZGapMm: number | null;
  laterality: string | null;
  imageLaterality: string | null;
  viewPosition: string | null;
  /** RT summary: plan label + beam/fraction counts, dose max + DVH label. */
  rtPlanLabel: string | null;
  rtBeams: number | null;
  rtFractions: number | null;
  rtPrescriptionGy: number | null;
  rtDoseMaxGy: number | null;
  rtDvh: string | null;
  /** VL grid + encapsulated document rows (null when absent). */
  vlTiles: string | null;
  vlFocusPlanes: number | null;
  vlOpticalPaths: number | null;
  encapsulatedDoc: string | null;
  /** Cine timing (C.8.6) when the file carries it; US region readout. */
  frameTimeMs: number | null;
  cineFps: number | null;
  /** US region summary: count + the first 2D cm spacing — null when none. */
  usRegions: number | null;
  usSpacingMm: [number, number] | null;
  usTypes: string | null;
}

/** YYYYMMDD → YYYY-MM-DD; anything else passes through untouched. */
export function fmtDicomDate(raw: string | null): string | null {
  if (!raw || !/^\d{8}$/.test(raw)) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/** HHMMSS[.frac] → HH:MM:SS; anything else passes through untouched. */
export function fmtDicomTime(raw: string | null): string | null {
  if (!raw || !/^\d{6}/.test(raw)) return raw;
  return `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}`;
}

const num6 = (ds: Dataset, tag: string): [number, number, number, number, number, number] | null => {
  const n = ds.numbers(tag);
  return n.length >= 6 ? [n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!] : null;
};

/** Summarize a parsed dataset (single-file uploads: SEG/RTSTRUCT/anything). */
export function summarizeDataset(ds: Dataset): DicomTagSummary {
  const ps = ds.numbers('00280030');
  const ftv = ds.numbers('00181065');
  const cine = cineFields(ds.number('00181063'), ftv, ds.number('00180040'), ds.number('00082144'));
  const regions = usRegionsFromDataset(ds);
  const im = ds.numbers('00181164');
  const imager = im.length >= 2 ? [im[0]!, im[1]!] as [number, number] : null;
  const tomoSp = stackPixelSpacing({
    pixelSpacing: ps.length >= 2 ? [ps[0]!, ps[1]!] : null, imagerPixelSpacing: imager,
  });
  return {
    sopClassUID: ds.text('00080016'),
    modality: ds.text('00080060'),
    studyUID: ds.text('0020000D'),
    seriesUID: ds.text('0020000E'),
    seriesNumber: ds.number('00200011'),
    seriesDescription: ds.text('0008103E'),
    patientName: ds.text('00100010'),
    patientID: ds.text('00100020'),
    studyDate: fmtDicomDate(ds.text('00080020')),
    studyTime: fmtDicomTime(ds.text('00080030')),
    manufacturer: ds.text('00080070'),
    model: ds.text('00081090'),
    institution: ds.text('00080080'),
    rows: ds.number('00280010'),
    cols: ds.number('00280011'),
    bitsStored: ds.number('00280101'),
    frames: ds.number('00280008') ?? 1,
    windowCenter: ds.number('00281050'),
    windowWidth: ds.number('00281051'),
    slope: ds.number('00281053') ?? 1,
    intercept: ds.number('00281052') ?? 0,
    pixelSpacing: ps.length >= 2 ? [ps[0]!, ps[1]!] : null,
    sliceThickness: ds.number('00180050'),
    iop: num6(ds, '00200037'),
    tomoSpacingMm: tomoSp,
    tomoZGapMm: stackZGap({ sliceThickness: ds.number('00180050'), spacingBetweenSlices: ds.number('00180088') }),
    laterality: ds.text('00200060'),
    imageLaterality: ds.text('00200062'),
    viewPosition: ds.text('00185101'),
    ...rtSummaryFields(ds),
    ...vlSummaryFields(ds),
    frameTimeMs: cine.frameTimeMs,
    cineFps: cine.cineFps,
    usRegions: regions.length > 0 ? regions.length : null,
    usSpacingMm: usRegionSpacingMm(regions),
    usTypes: usTypesLabel(regions),
  };
}

/**
 * RT rows for the summary: plan identity + dose max + DVH label, read
 * through the rt.js parsers (never raw sequence walks here). Non-RT
 * datasets yield all-null; undecodable RT files yield all-null too —
 * the tag browser never fails, the import path reports loudly.
 */
function rtSummaryFields(ds: Dataset): Pick<DicomTagSummary,
  'rtPlanLabel' | 'rtBeams' | 'rtFractions' | 'rtPrescriptionGy' | 'rtDoseMaxGy' | 'rtDvh'> {
  const none = {
    rtPlanLabel: null, rtBeams: null, rtFractions: null,
    rtPrescriptionGy: null, rtDoseMaxGy: null, rtDvh: null,
  };
  const sop = ds.text('00080016');
  try {
    if (sop === RTPLAN_SOP_CLASS) {
      const plan = parseRtPlan(ds);
      return {
        ...none,
        rtPlanLabel: plan.label ?? plan.name,
        rtBeams: plan.beams.length > 0 ? plan.beams.length : null,
        rtFractions: plan.fractionsPlanned,
        rtPrescriptionGy: plan.prescriptionDoses[0] ?? null,
      };
    }
    if (sop === RTDOSE_SOP_CLASS) {
      const grid = parseRtDose(ds);
      const st = doseStats(grid);
      return { ...none, rtDoseMaxGy: st.max, rtDvh: dvhLabel(grid.dvhs) };
    }
  } catch { /* undecodable RT: nulls, the importer reports */ }
  return none;
}

/**
 * VL + document rows: grid label + focus/paths for slide files, doc
 * label for encapsulated files. Anything else (or undecodable) yields
 * nulls — the tag browser never fails, the importer reports loudly.
 */
function vlSummaryFields(ds: Dataset): Pick<DicomTagSummary,
  'vlTiles' | 'vlFocusPlanes' | 'vlOpticalPaths' | 'encapsulatedDoc'> {
  const none = { vlTiles: null, vlFocusPlanes: null, vlOpticalPaths: null, encapsulatedDoc: null };
  const sop = ds.text('00080016');
  try {
    if (isVlSopClass(sop)) {
      const grid = parseVlGrid(ds);
      return {
        ...none,
        vlTiles: vlGridLabel(grid),
        vlFocusPlanes: grid.focusPlanes,
        vlOpticalPaths: grid.opticalPaths,
      };
    }
    if (isEncapsulatedSopClass(sop)) {
      const doc = parseEncapsulatedDoc(ds);
      return { ...none, encapsulatedDoc: encapsulatedDocLabel(doc, sop) };
    }
  } catch { /* undecodable VL/doc: nulls, the importer reports */ }
  return none;
}

/** Adapt a pixel-pipeline file meta (catalog DICOM series) to the same model. */
export function fileMetaToSummary(
  m: DicomFileMeta, sopClassUID: string | null, regions: UsRegion[] = [],
): DicomTagSummary {
  return {
    sopClassUID,
    modality: m.modality,
    studyUID: m.studyUID,
    seriesUID: m.seriesUID,
    seriesNumber: m.seriesNumber,
    seriesDescription: m.seriesDescription,
    patientName: m.patientName,
    patientID: m.patientID,
    studyDate: fmtDicomDate(m.studyDate),
    studyTime: null,
    manufacturer: null,
    model: null,
    institution: null,
    rows: m.rows,
    cols: m.cols,
    bitsStored: m.bitsStored,
    frames: m.numberOfFrames,
    windowCenter: m.windowCenter,
    windowWidth: m.windowWidth,
    slope: m.slope,
    intercept: m.intercept,
    pixelSpacing: m.pixelSpacing,
    sliceThickness: m.sliceThickness,
    iop: m.iop,
    tomoSpacingMm: stackPixelSpacing(m),
    tomoZGapMm: stackZGap(m),
    laterality: m.laterality,
    imageLaterality: m.imageLaterality,
    viewPosition: m.viewPosition,
    // pixel-pipeline files are image stacks, never RT/VL/doc: nulls by contract
    rtPlanLabel: null, rtBeams: null, rtFractions: null,
    rtPrescriptionGy: null, rtDoseMaxGy: null, rtDvh: null,
    vlTiles: null, vlFocusPlanes: null, vlOpticalPaths: null, encapsulatedDoc: null,
    frameTimeMs: m.frameTimeMs,
    cineFps: m.cineFps,
    usRegions: regions.length > 0 ? regions.length : null,
    usSpacingMm: usRegionSpacingMm(regions),
    usTypes: usTypesLabel(regions),
  };
}

/** Compact distinct region-type names ("Tissue + Color Flow"). */
export function usTypesLabel(regions: UsRegion[]): string | null {
  if (regions.length === 0) return null;
  const seen: string[] = [];
  for (const r of regions) {
    const name = regionDataTypeName(r.dataType);
    if (!seen.includes(name)) seen.push(name);
  }
  return seen.join(' + ');
}
