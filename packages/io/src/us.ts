// Ultrasound helpers (PS3.3 C.8.5.5 US Image + C.8.6 Cine): region
// calibration rows (0018,6011), cine timing, native YBR→luma fold. Pure:
// bytes/tables in, tables out. Digest: cornerstone getCalibratedUnits
// (physical-units table + tissue/flow/spectral type set) and its
// YBR_FULL/YBR_FULL_422→RGB coefficients; the WADO/image-loader layers
// cut, the CPU math kept. Implicit-VR region rows stay absent (the
// dcm-read Dataset reader is explicit-only by contract) — never an
// exception, just [].
import { readDataset, type Dataset } from './dcm-read.js';

export const US_IMAGE_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.6.1';
export const US_MULTIFRAME_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.3.1';

/** One Sequence of Ultrasound Regions (0018,6011) item. Absent tags null. */
export interface UsRegion {
  spatialFormat: number | null;
  dataType: number | null;
  flags: number | null;
  x0: number | null;
  y0: number | null;
  x1: number | null;
  y1: number | null;
  refX: number | null;
  refY: number | null;
  unitsX: number | null;
  unitsY: number | null;
  refValX: number | null;
  refValY: number | null;
  deltaX: number | null;
  deltaY: number | null;
  transducerFreq: number | null;
}

export function isUsSopClass(uid: string | null): boolean {
  return uid === US_IMAGE_SOP_CLASS || uid === US_MULTIFRAME_SOP_CLASS;
}

/** Region Data Type (0018,6014): the tissue/flow/spectral set. */
export function regionDataTypeName(t: number | null): string {
  switch (t) {
    case 0: return 'None';
    case 1: return 'Tissue';
    case 2: return 'Color Flow';
    case 3: return 'PW Spectral Doppler';
    case 4: return 'CW Spectral Doppler';
    default: return t == null ? 'Unknown' : `type-${t}`;
  }
}

/** Region Spatial Format (0018,6012). */
export function regionSpatialFormatName(f: number | null): string {
  switch (f) {
    case 0: return 'None';
    case 1: return '2D';
    case 2: return 'M-Mode';
    case 3: return 'Spectral';
    case 4: return 'Waveform';
    default: return f == null ? 'Unknown' : `format-${f}`;
  }
}

/** Physical Units X/Y Direction (0018,6024/6026) table. */
export function physicalUnitsName(u: number | null): string {
  switch (u) {
    case 0: return 'px';
    case 1: return 'percent';
    case 2: return 'dB';
    case 3: return 'cm';
    case 4: return 'seconds';
    case 5: return 'hertz';
    case 6: return 'dB/seconds';
    case 7: return 'cm/sec';
    case 8: return 'cm²';
    case 9: return 'cm²/s';
    case 0x0c: return 'degrees';
    default: return u == null ? 'unknown' : `unit-${u}`;
  }
}

/** Read every region row of an already-parsed dataset. [] when absent. */
export function usRegionsFromDataset(ds: Dataset): UsRegion[] {
  return ds.sequence('00186011').map((item) => ({
    spatialFormat: item.number('00186012'),
    dataType: item.number('00186014'),
    flags: item.number('00186016'),
    x0: item.number('00186018'),
    y0: item.number('0018601A'),
    x1: item.number('0018601C'),
    y1: item.number('0018601E'),
    refX: item.number('00186020'),
    refY: item.number('00186022'),
    unitsX: item.number('00186024'),
    unitsY: item.number('00186026'),
    refValX: item.number('00186028'),
    refValY: item.number('0018602A'),
    deltaX: item.number('0018602C'),
    deltaY: item.number('0018602E'),
    transducerFreq: item.number('00186030'),
  }));
}

/** Read region rows straight from file bytes. [] when absent/unreadable —
 *  regions never fail the pixel path (same stance as functional groups). */
export function usRegionsFromBuffer(buffer: ArrayBuffer): UsRegion[] {
  try {
    return usRegionsFromDataset(readDataset(buffer));
  } catch {
    return [];
  }
}

/**
 * Calibrated in-plane spacing from the first 2D cm region, as
 * [row, col] mm (PhysicalDelta is cm/pixel). Null unless one region
 * carries matching cm units on both axes with positive deltas — the
 * caller keeps file Pixel Spacing otherwise.
 */
export function usRegionSpacingMm(regions: UsRegion[]): [number, number] | null {
  for (const r of regions) {
    if (r.spatialFormat !== 1 || r.unitsX !== 3 || r.unitsY !== 3) continue;
    if (r.deltaX == null || r.deltaY == null || r.deltaX <= 0 || r.deltaY <= 0) continue;
    return [r.deltaY * 10, r.deltaX * 10];
  }
  return null;
}

export interface CineFields {
  /** effective frame interval (FrameTime, else FrameTimeVector mean) */
  frameTimeMs: number | null;
  /** playback rate: RecommendedDisplayFrameRate, else CineRate, else 1000/interval */
  cineFps: number | null;
}

const positive = (v: number | null | undefined): number | null =>
  v != null && Number.isFinite(v) && v > 0 ? v : null;

/** Cine timing (C.8.6): one derivation shared by both summary sources. */
export function cineFields(
  frameTime: number | null | undefined,
  frameTimeVector: number[] | null | undefined,
  cineRate: number | null | undefined,
  recRate: number | null | undefined,
): CineFields {
  const vec = (frameTimeVector ?? []).filter((v) => Number.isFinite(v) && v > 0);
  const frameTimeMs = positive(frameTime)
    ?? (vec.length > 0 ? vec.reduce((a, b) => a + b, 0) / vec.length : null);
  const cineFps = positive(recRate) ?? positive(cineRate)
    ?? (frameTimeMs != null ? 1000 / frameTimeMs : null);
  return { frameTimeMs, cineFps };
}

const clamp8 = (a: number): number => (a <= 0 ? 0 : a >= 255 ? 255 : a | 0);

/** One YCbCr triple → Rec.601 luma (same coefficients as jpeg-baseline). */
export function ybrToLuma(y: number, cb: number, cr: number): number {
  const r = clamp8(y - 179.456 + 1.402 * cr);
  const g = clamp8(y + 135.459 - 0.344 * cb - 0.714 * cr);
  const bl = clamp8(y - 226.816 + 1.772 * cb);
  return (0.299 * r + 0.587 * g + 0.114 * bl) | 0;
}

/**
 * Fold a native (uncompressed) 3-sample US frame to luma. YBR_FULL/RGB
 * carry full-resolution triples; YBR_FULL_422 packs pairs sharing one
 * chroma (Y1 Y2 Cb Cr, the cornerstone 422 layout). Anything else —
 * PALETTE COLOR included — throws `us-ybr-*`, never guesses.
 */
export function foldYbrFrame(
  bytes: Uint8Array, rows: number, cols: number, photometric: string,
): Uint8Array {
  const n = rows * cols;
  if (photometric === 'YBR_FULL_422') {
    if (cols % 2 !== 0) throw new Error(`us-ybr-odd-width: cols=${cols}`);
    if (bytes.length < n * 2) throw new Error(`us-ybr-short: ${bytes.length} < ${n * 2}`);
    const out = new Uint8Array(n);
    let p = 0;
    for (let i = 0; i < n; i += 2) {
      const y1 = bytes[p++]!, y2 = bytes[p++]!, cb = bytes[p++]!, cr = bytes[p++]!;
      out[i] = ybrToLuma(y1, cb, cr);
      out[i + 1] = ybrToLuma(y2, cb, cr);
    }
    return out;
  }
  if (photometric === 'YBR_FULL' || photometric === 'RGB') {
    if (bytes.length < n * 3) throw new Error(`us-ybr-short: ${bytes.length} < ${n * 3}`);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = ybrToLuma(bytes[i * 3]!, bytes[i * 3 + 1]!, bytes[i * 3 + 2]!);
    }
    return out;
  }
  throw new Error(`us-ybr-photometric: ${photometric}`);
}
