// RTPLAN / RTDOSE adapters (PS3.3 C.8.8.13–14): SOP gate + plan summary
// + dose-grid decode + DVH rows. Pure: tables/bytes in, tables out.
// Digest: Daikon dictionary.js (group 300A beam + group 3004 dose VRs)
// and the RTSTRUCT/SEG Dataset-reader idiom; the TPS/MU-verification
// layers cut, the CPU math kept. Implicit-VR stays absent (dcm-read is
// explicit-only by contract) — regions never throw, grids throw named
// `rtdose-*` errors instead of misdecoding.

export const RTPLAN_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.481.5';
export const RTDOSE_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.481.2';
export const RTIMAGE_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.481.1';

export function isRtPlanSopClass(uid: string | null): boolean {
  return uid === RTPLAN_SOP_CLASS;
}

export function isRtDoseSopClass(uid: string | null): boolean {
  return uid === RTDOSE_SOP_CLASS;
}

/** One beam row: the plan-table columns the viewer can fill from tags. */
export interface RtBeam {
  number: number | null;
  name: string | null;
  type: string | null;
  radiationType: string | null;
  energy: number | null;
  gantryAngle: number | null;
  meterset: number | null;
  ssd: number | null;
}

/** Plan summary: label + fraction groups + beams + dose references. */
export interface RtPlan {
  label: string | null;
  name: string | null;
  intent: string | null;
  fractionsPlanned: number | null;
  beams: RtBeam[];
  /** TargetPrescriptionDose values across DoseReferenceSequence items. */
  prescriptionDoses: number[];
}

/** One DVH row (cumulative): roi number + min/mean/max + bin count. */
export interface RtDvh {
  roiNumber: number | null;
  minDose: number | null;
  meanDose: number | null;
  maxDose: number | null;
  bins: number | null;
}

/** Minimal structural type the plan parser needs (Dataset satisfies it). */
export interface RtPlanDs {
  text: (t: string) => string | null;
  number: (t: string) => number | null;
  sequence: (t: string) => RtPlanDs[];
}

const num = (el: RtPlanDs, tag: string): number | null => el.number(tag);

const txt = (el: RtPlanDs, tag: string): string | null => el.text(tag);

/** Read beam rows from a FractionGroupSequence item's ReferencedBeam list. */
function beamsFromFractionItem(item: RtPlanDs): { number: number | null; meterset: number | null }[] {
  return item.sequence('300A0080').map((ref) => ({
    number: ref.number('300A00C0'),
    meterset: ref.number('300A0086'),
  }));
}

/**
 * Parse an RTPLAN dataset into the plan summary. Missing sequences yield
 * empty lists (a plan with no beams is data, not an error) — only a wrong
 * SOP class throws (`not an RTPLAN`).
 */
export function parseRtPlan(ds: RtPlanDs): RtPlan {
  if (txt(ds, '00080016') !== RTPLAN_SOP_CLASS) {
    throw new Error(`not an RTPLAN: ${txt(ds, '00080016')}`);
  }
  const fractionsPlanned = ds.sequence('300A0070')
    .map((fg) => fg.number('300A0078'))
    .find((v) => v != null) ?? null;
  // meterset per beam number (fraction-group refs may repeat beams; first wins)
  const metersetByBeam = new Map<number, number>();
  for (const fg of ds.sequence('300A0070')) {
    for (const b of beamsFromFractionItem(fg)) {
      if (b.number != null && b.meterset != null && !metersetByBeam.has(b.number)) {
        metersetByBeam.set(b.number, b.meterset);
      }
    }
  }
  const beams: RtBeam[] = ds.sequence('300A00B0').map((b) => {
    const cp0 = b.sequence('300A0111')[0];
    const number = num(b, '300A00C0');
    return {
      number,
      name: txt(b, '300A00C2'),
      type: txt(b, '300A00C4'),
      radiationType: txt(b, '300A00C6'),
      energy: cp0 ? num(cp0, '300A0114') : null,
      gantryAngle: cp0 ? num(cp0, '300A011E') : null,
      meterset: number != null ? metersetByBeam.get(number) ?? null : null,
      ssd: cp0 ? num(cp0, '300A0130') : null,
    };
  });
  const prescriptionDoses = ds.sequence('300A0010')
    .map((d) => d.number('300A0026'))
    .filter((v): v is number => v != null);
  return {
    label: txt(ds, '300A0002'),
    name: txt(ds, '300A0003'),
    intent: txt(ds, '300A000A'),
    fractionsPlanned,
    beams,
    prescriptionDoses,
  };
}

export interface RtDoseGrid {
  rows: number;
  cols: number;
  frames: number;
  /** Gy per voxel, IPP-anchored via imagePosition + offsets. */
  data: Float32Array;
  imagePosition: [number, number, number];
  pixelSpacing: [number, number];
  gridOffsets: number[];
  doseGridScaling: number;
  doseUnits: string | null;
  doseType: string | null;
  doseSummationType: string | null;
  dvhs: RtDvh[];
  roiDoses: { roiNumber: number | null; dose: number | null }[];
}

interface RtDoseDs {
  text: (t: string) => string | null;
  number: (t: string) => number | null;
  numbers: (t: string) => number[];
  bytes: (t: string) => Uint8Array | null;
  sequence: (t: string) => RtDoseDs[];
}

/**
 * Decode an RTDOSE dataset to a Gy grid + DVH rows. Throws `rtdose-*` on
 * wrong SOP class, missing geometry/scaling, or short pixel data —
 * never a silently rescaled grid.
 */
export function parseRtDose(ds: RtDoseDs): RtDoseGrid {
  if (ds.text('00080016') !== RTDOSE_SOP_CLASS) {
    throw new Error(`not an RTDOSE: ${ds.text('00080016')}`);
  }
  const rows = ds.number('00280010');
  const cols = ds.number('00280011');
  const frames = ds.number('00280008') ?? 1;
  const bits = ds.number('00280100');
  if (rows == null || cols == null) throw new Error('rtdose-no-geometry: missing rows/cols');
  if (bits !== 16 && bits !== 32) throw new Error(`rtdose-bits: BitsAllocated=${bits}, need 16 or 32`);
  const scaling = ds.number('3004000E');
  if (scaling == null) throw new Error('rtdose-no-scaling: missing DoseGridScaling');
  const ipp = ds.numbers('00200032');
  const ps = ds.numbers('00280030');
  const offsets = ds.numbers('3004000C');
  if (ipp.length < 3) throw new Error('rtdose-no-geometry: missing ImagePositionPatient');
  if (ps.length < 2) throw new Error('rtdose-no-geometry: missing PixelSpacing');
  if (offsets.length !== frames) {
    throw new Error(`rtdose-offsets: ${offsets.length} GridFrameOffsetVector for ${frames} frames`);
  }
  const raw = ds.bytes('7FE00010');
  if (!raw) throw new Error('rtdose-no-pixels: missing PixelData');
  const n = rows * cols * frames;
  const data = new Float32Array(n);
  if (bits === 16) {
    if (raw.length < n * 2) throw new Error(`rtdose-short: ${raw.length} < ${n * 2}`);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let i = 0; i < n; i++) data[i] = dv.getUint16(i * 2, true) * scaling;
  } else {
    if (raw.length < n * 4) throw new Error(`rtdose-short: ${raw.length} < ${n * 4}`);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let i = 0; i < n; i++) data[i] = dv.getUint32(i * 4, true) * scaling;
  }
  // rescale guard: a scaling that maps the raw max past 1e6 Gy is writer
  // junk, not a plan — fail loud instead of painting nonsense.
  let max = 0;
  for (let i = 0; i < n; i++) if (data[i]! > max) max = data[i]!;
  if (!(max < 1e6)) throw new Error(`rtdose-scaling: raw max maps to ${max} Gy`);
  const dvhs: RtDvh[] = ds.sequence('30040050').map((d) => ({
    roiNumber: d.sequence('30040060')[0]?.number('30060084') ?? null,
    minDose: d.number('30040070'),
    meanDose: d.number('30040074'),
    maxDose: d.number('30040072'),
    bins: d.number('30040056'),
  }));
  const roiDoses = ds.sequence('30040010').map((r) => ({
    roiNumber: r.number('30060084'),
    dose: r.number('30040012'),
  }));
  return {
    rows, cols, frames, data,
    imagePosition: [ipp[0]!, ipp[1]!, ipp[2]!],
    pixelSpacing: [ps[0]!, ps[1]!],
    gridOffsets: offsets,
    doseGridScaling: scaling,
    doseUnits: ds.text('30040002'),
    doseType: ds.text('30040004'),
    doseSummationType: ds.text('3004000A'),
    dvhs,
    roiDoses,
  };
}

/** DVH summary label: "2 ROI(s) · max 72.0 Gy" — null when no rows. */
export function dvhLabel(dvhs: RtDvh[]): string | null {
  if (dvhs.length === 0) return null;
  const max = Math.max(...dvhs.map((d) => d.maxDose ?? -Infinity));
  return `${dvhs.length} ROI(s)${Number.isFinite(max) ? ` · max ${max} Gy` : ''}`;
}

/** Grid statistics over in-grid voxels (Gy): min/max/mean + hot-spot xyz. */
export function doseStats(grid: RtDoseGrid): {
  min: number; max: number; mean: number; hotVoxel: number;
} {
  const n = grid.data.length;
  if (n === 0) throw new RangeError('rtdose-empty-grid');
  let min = Infinity, max = -Infinity, sum = 0, hot = 0;
  for (let i = 0; i < n; i++) {
    const v = grid.data[i]!;
    if (v < min) min = v;
    if (v > max) { max = v; hot = i; }
    sum += v;
  }
  return { min, max, mean: sum / n, hotVoxel: hot };
}
