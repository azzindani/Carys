// DICOM files → spatially ordered stacks, with their geometry and the ways
// that geometry is not trustworthy said out loud.
//
// There used to be four copies of "sort by SliceLocation, stack, take the
// median gap" (catalog loader, DICOMDIR, PACS pull, single-file upload), and
// none of them asked whether the files belonged together. Handed five slices
// from five different CT exams, they built one "volume" out of them and the
// 3D view drew a surface through five patients. Handed a DCE series with two
// time points at one position, they stacked both as if they were adjacent
// anatomy. This module is the one place that decides what a stack is:
//
//   1. group by Series Instance UID + matrix + orientation + pixel spacing
//      (a series can legally mix these — localizers do — and a stack cannot);
//   2. order by Image Position (Patient) projected on the slice normal, the
//      only ordering the standard guarantees means "space" (Slice Location is
//      optional and vendor-defined; Instance Number is acquisition order);
//   3. split repeated positions into phases when every position repeats the
//      same number of times (DCE, cardiac cine), otherwise keep one per
//      position and say how many were dropped;
//   4. derive the slice interval from the positions, and flag a stack whose
//      gaps disagree (sparse picks, missing slices) or whose positions shear
//      off the normal (gantry tilt) — MPR and 3D on those are approximate.
//
// Pure: parsed slices in, stacks out. No DOM, no fetch — runs in a worker.
import type { DicomFileMeta, ParsedDicomSlice } from './dicom-parse.js';
import { stackPixelSpacing, stackZGap } from './tomo.js';

type Vec3 = [number, number, number];

export type StackWarningCode =
  | 'non-uniform-spacing'
  | 'duplicate-position'
  | 'gantry-tilt'
  | 'no-position';

export interface StackWarning {
  code: StackWarningCode;
  message: string;
}

export interface DicomStack {
  /** Unique within one grouping call; stable for the same input order. */
  id: string;
  seriesUID: string | null;
  /** Meta of the first slice in spatial order (identity, window, modality). */
  meta: DicomFileMeta;
  /** Slices in spatial order: ascending along +direction[2]. */
  slices: ParsedDicomSlice[];
  dims: Vec3;
  /** mm: column step, row step, slice interval. */
  spacing: Vec3;
  /** LPS mm of the first voxel's centre; null without Image Position. */
  origin: Vec3 | null;
  /** LPS unit vectors of +i (along a row), +j (down a column), +k (slice
   *  order); null without Image Orientation. */
  direction: [Vec3, Vec3, Vec3] | null;
  /** Temporal phase when a series repeats positions evenly (DCE, cine). */
  phase: { index: number; count: number } | null;
  warnings: StackWarning[];
}

/** Positions closer than this are the same slice (mm). */
const SAME_POSITION_MM = 0.01;
/** Gap disagreement tolerated before a stack is called non-uniform. */
const GAP_TOLERANCE_REL = 0.02;
const GAP_TOLERANCE_MM = 0.02;
/** Sideways drift of the stack (mm per slice) that counts as a tilt. */
const SHEAR_MM_PER_SLICE = 0.05;

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 | null => {
  const n = norm(a);
  return n > 1e-6 ? [a[0] / n, a[1] / n, a[2] / n] : null;
};
const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();

function sliceIop(p: ParsedDicomSlice): [number, number, number, number, number, number] | null {
  return p.slice.iop ?? p.meta.iop;
}

function sliceIpp(p: ParsedDicomSlice): Vec3 | null {
  return p.slice.ipp ?? p.meta.ipp;
}

function slicePixelSpacing(p: ParsedDicomSlice): [number, number] | null {
  return p.slice.pixelSpacing ?? stackPixelSpacing(p.meta);
}

/** Rows/cols/orientation/spacing signature: what must match to share a stack. */
function geometryKey(p: ParsedDicomSlice): string {
  const iop = sliceIop(p);
  const ps = slicePixelSpacing(p);
  const r3 = (v: number): string => v.toFixed(3);
  return [
    p.meta.seriesUID ?? 'no-series',
    `${p.slice.cols}x${p.slice.rows}`,
    iop ? iop.map(r3).join(',') : 'no-iop',
    ps ? ps.map(r3).join(',') : 'no-ps',
  ].join('|');
}

/** Instance Number, then frame index: acquisition order within a position. */
function acquisitionOrder(a: ParsedDicomSlice, b: ParsedDicomSlice): number {
  const ia = a.slice.instanceNumber ?? 0, ib = b.slice.instanceNumber ?? 0;
  if (ia !== ib) return ia - ib;
  return (a.slice.frameIndex ?? 0) - (b.slice.frameIndex ?? 0);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/**
 * Group parsed slices into stacks. Groups come back largest first, so a
 * caller that opens "the" series gets the one with the most anatomy.
 */
export function groupDicomStacks(parts: ParsedDicomSlice[]): DicomStack[] {
  const groups = new Map<string, ParsedDicomSlice[]>();
  for (const p of parts) {
    const k = geometryKey(p);
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }
  const stacks: DicomStack[] = [];
  let gi = 0;
  for (const g of groups.values()) {
    for (const s of buildStacks(g, gi)) stacks.push(s);
    gi++;
  }
  return stacks.sort((a, b) => b.slices.length - a.slices.length);
}

function buildStacks(group: ParsedDicomSlice[], gi: number): DicomStack[] {
  const first = group[0]!;
  const iop = sliceIop(first);
  const rowCos = iop ? unit([iop[0], iop[1], iop[2]]) : null;
  const colCos = iop ? unit([iop[3], iop[4], iop[5]]) : null;
  const normal = rowCos && colCos ? unit(cross(rowCos, colCos)) : null;
  const positioned = normal !== null && group.every((p) => sliceIpp(p) !== null);

  if (!positioned) {
    // No geometry to order by: acquisition order is the honest fallback, and
    // the interval comes from the tags. Said once, not guessed silently.
    const ordered = [...group].sort(acquisitionOrder);
    const warnings: StackWarning[] = ordered.length > 1
      ? [{ code: 'no-position', message: 'files carry no Image Position/Orientation: ordered by Instance Number, spacing from Slice Thickness' }]
      : [];
    return [finish(`${gi}`, ordered, stackZGap(first.meta), null, warnings, null)];
  }

  // Cluster by position along the normal; each cluster is one location.
  const withPos = group
    .map((p) => ({ p, d: dot(sliceIpp(p)!, normal) }))
    .sort((a, b) => a.d - b.d || acquisitionOrder(a.p, b.p));
  const clusters: { d: number; ps: ParsedDicomSlice[] }[] = [];
  for (const e of withPos) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(e.d - last.d) < SAME_POSITION_MM) last.ps.push(e.p);
    else clusters.push({ d: e.d, ps: [e.p] });
  }
  for (const c of clusters) c.ps.sort(acquisitionOrder);

  const counts = new Set(clusters.map((c) => c.ps.length));
  const repeats = Math.max(...counts);
  const geo = { rowCos: rowCos!, colCos: colCos!, normal };
  if (repeats > 1 && counts.size === 1 && clusters.length > 1) {
    // Every position repeats k times: k time points of one volume.
    return Array.from({ length: repeats }, (_, t) =>
      spatialStack(`${gi}.${t}`, clusters.map((c) => c.ps[t]!), geo, [], { index: t, count: repeats }));
  }
  const warnings: StackWarning[] = [];
  if (repeats > 1) {
    const dropped = withPos.length - clusters.length;
    warnings.push({
      code: 'duplicate-position',
      message: `${dropped} slice(s) repeat a position unevenly (mixed phases or re-acquisitions): kept the first at each position`,
    });
  }
  return [spatialStack(`${gi}`, clusters.map((c) => c.ps[0]!), geo, warnings, null)];
}

function spatialStack(
  id: string, ordered: ParsedDicomSlice[],
  geo: { rowCos: Vec3; colCos: Vec3; normal: Vec3 },
  warnings: StackWarning[], phase: DicomStack['phase'],
): DicomStack {
  const pos = ordered.map((p) => sliceIpp(p)!);
  const d = pos.map((x) => dot(x, geo.normal));
  let dz: number;
  if (ordered.length > 1) {
    const gaps = d.slice(1).map((v, i) => v - d[i]!);
    dz = median(gaps);
    const lo = Math.min(...gaps), hi = Math.max(...gaps);
    if (hi - lo > Math.max(GAP_TOLERANCE_MM, GAP_TOLERANCE_REL * dz)) {
      warnings.push({
        code: 'non-uniform-spacing',
        message: `slice gaps range ${fmt(lo)}–${fmt(hi)} mm (median ${fmt(dz)}): slices are not contiguous, so reformats and 3D are approximate`,
      });
    }
    // Positions should march straight along the normal. Sideways drift is a
    // tilted gantry: the true grid is sheared, a box grid only approximates.
    const span = [pos[pos.length - 1]![0] - pos[0]![0], pos[pos.length - 1]![1] - pos[0]![1], pos[pos.length - 1]![2] - pos[0]![2]] as Vec3;
    const along = dot(span, geo.normal);
    const side = norm([span[0] - along * geo.normal[0], span[1] - along * geo.normal[1], span[2] - along * geo.normal[2]]);
    if (side > SHEAR_MM_PER_SLICE * (ordered.length - 1)) {
      warnings.push({
        code: 'gantry-tilt',
        message: `slice positions drift ${fmt(side)} mm off the slice normal (gantry tilt): displayed as an unsheared stack`,
      });
    }
  } else {
    dz = stackZGap(ordered[0]!.meta);
  }
  return finish(id, ordered, dz > 0 ? dz : stackZGap(ordered[0]!.meta), pos[0]!, warnings, phase,
    [geo.rowCos, geo.colCos, geo.normal]);
}

function finish(
  id: string, ordered: ParsedDicomSlice[], dz: number, origin: Vec3 | null,
  warnings: StackWarning[], phase: DicomStack['phase'],
  direction: [Vec3, Vec3, Vec3] | null = null,
): DicomStack {
  const first = ordered[0]!;
  const ps = slicePixelSpacing(first) ?? [1, 1];
  return {
    id,
    seriesUID: first.meta.seriesUID,
    meta: first.meta,
    slices: ordered,
    // PixelSpacing is (row spacing, column spacing) = (Δj, Δi).
    dims: [first.slice.cols, first.slice.rows, ordered.length],
    spacing: [ps[1], ps[0], dz],
    origin,
    direction,
    phase,
    warnings,
  };
}

/** Voxels of a stack, slice after slice in its spatial order. */
export function stackVoxels(stack: DicomStack): Float64Array {
  const [nx, ny, nz] = stack.dims;
  const n = nx * ny;
  const out = new Float64Array(n * nz);
  stack.slices.forEach((p, k) => out.set(p.slice.pixelData, k * n));
  return out;
}

/** One-line label for a stack: description, phase, slice count. */
export function stackLabel(stack: DicomStack): string {
  const m = stack.meta;
  const what = m.seriesDescription?.trim() || m.modality || 'series';
  const ph = stack.phase ? ` · phase ${stack.phase.index + 1}/${stack.phase.count}` : '';
  const n = stack.slices.length;
  return `${what}${m.seriesNumber != null ? ` #${m.seriesNumber}` : ''}${ph} · ${n} image${n === 1 ? '' : 's'}`;
}
