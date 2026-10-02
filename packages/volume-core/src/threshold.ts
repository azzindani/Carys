// Where to cut an isosurface, and how far the control may travel.
//
// The 3D view used a fixed slider, `min={0} max={1000}`, defaulting to 0. On
// anything carrying Hounsfield units that is the wrong answer twice over: a
// threshold of 0 HU keeps everything denser than water, so brain and skull
// fuse into one featureless shell, and a ceiling of 1000 cannot reach cortical
// bone at all (~1100 HU). The default view of a head CT was a blob, and the
// surface that makes the view worth having was off the end of the control.
//
// Both numbers belong to the data, not to the source file (§6). A CT and a
// label mask want different cuts, so the kind is inferred from the values.
import { histogram } from './histogram.js';

export type ThresholdKind = 'mask' | 'hounsfield' | 'otsu';

export interface ThresholdSuggestion {
  /** Where to start the isosurface. */
  value: number;
  /** Slider bounds: the data's own range, rounded outward. */
  lo: number;
  hi: number;
  /** Which rule produced `value` — surfaced in the UI and asserted in tests. */
  kind: ThresholdKind;
}

/** Bone. The conventional cut for a CT surface render, and what a radiologist
 *  means by "3D reconstruction" of a head or a skeleton. */
const BONE_HU = 300;
/** Skin: the air/soft-tissue boundary. Halfway between air (-1000) and fat
 *  (~-100), so partial-volume voxels at the surface fall on the right side. */
const SKIN_HU = -300;
/** Soft tissue: above fat and water, below enhanced vessels and bone, so the
 *  cut leaves muscle and organs and drops the fat between them. */
const SOFT_TISSUE_HU = 50;

export type CtSurfacePresetId = 'skin' | 'soft' | 'bone';

/** The three cuts a reader wants on a CT surface, in rising order; bone is
 *  also autoThreshold's Hounsfield default, so the default is a preset. */
export const CT_SURFACE_PRESETS: readonly { id: CtSurfacePresetId; label: string; hu: number }[] = [
  { id: 'skin', label: 'Skin', hu: SKIN_HU },
  { id: 'soft', label: 'Soft tissue', hu: SOFT_TISSUE_HU },
  { id: 'bone', label: 'Bone', hu: BONE_HU },
];

/** The preset a threshold sits on, or null after a drag off every preset. */
export function ctSurfacePresetAt(threshold: number): CtSurfacePresetId | null {
  return CT_SURFACE_PRESETS.find((p) => p.hu === threshold)?.id ?? null;
}
/** Below this the volume carries air, so the scale is Hounsfield, not stored. */
const AIR_HU = -500;
/** A label map: small non-negative integers and nothing else. */
const MAX_LABEL = 255;

/**
 * Otsu's method: the cut that minimises within-class variance, computed over
 * a 256-bin histogram. Classic, parameter-free, and the right fallback when
 * the data is neither a mask nor Hounsfield.
 */
function otsu(hist: ArrayLike<number>, min: number, max: number): number {
  const bins = hist.length;
  let total = 0;
  for (let i = 0; i < bins; i++) total += hist[i]!;
  if (total === 0) return min;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i]!;
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let i = 0; i < bins; i++) {
    wB += hist[i]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = i; }
  }
  return min + ((best + 0.5) / bins) * (max - min || 1);
}

/** Neighbouring foreground voxels that must match for a label map: a label
 *  is a region, so a voxel and the next one along x mostly agree, where an
 *  image's noise makes them differ. */
const LABEL_RUN = 0.6;
/** This few distinct values is a label map whatever its shape: a mask of
 *  vessels two voxels wide fails the run test and is still a mask. */
const FEW_LABELS = 16;

/** True when every value is a small non-negative integer and the values are
 *  few or come in flat regions — a label map. An 8-bit image (a uint8 T1)
 *  passes the first test and fails both of the others: as a "mask" it was
 *  cut at 0, a surface round every voxel above background. */
function looksLikeLabels(data: ArrayLike<number>, min: number, max: number): boolean {
  if (min < 0 || max > MAX_LABEL) return false;
  // a full scan is wasted here: a label map is uniform, so a stride samples it
  const step = Math.max(1, Math.floor(data.length / 4096));
  const seen = new Set<number>();
  let fg = 0, same = 0;
  for (let i = 0; i < data.length; i += step) {
    const v = data[i]!;
    if (!Number.isInteger(v)) return false;
    if (seen.size <= FEW_LABELS) seen.add(v);
    if (i + 1 >= data.length) continue;
    const w = data[i + 1]!;
    if (v === min && w === min) continue;
    fg++;
    if (v === w) same++;
  }
  return seen.size <= FEW_LABELS || same >= fg * LABEL_RUN;
}

/** The share of voxels Otsu may leave above its range: a few bright outliers
 *  (flow artefact, a vessel, a fiducial) must not stretch the histogram. */
const OTSU_TAIL = 0.005;

/**
 * Otsu over [min, p99.5] rather than [min, max]. On a cardiac cine MR the
 * full range ran to 4025 while 95% of the voxels sat under 270: the
 * anatomy filled the bottom 17 of 256 bins, the cut landed at 810, above
 * nearly all of it, and the default surface was a sliver.
 */
function robustOtsu(
  data: ArrayLike<number>, hist: ArrayLike<number>, min: number, max: number,
): number {
  const bins = hist.length;
  let total = 0;
  for (let i = 0; i < bins; i++) total += hist[i]!;
  let acc = 0, top = bins - 1;
  for (let i = 0; i < bins; i++) {
    acc += hist[i]!;
    if (acc >= total * (1 - OTSU_TAIL)) { top = i; break; }
  }
  const cap = min + ((top + 1) / bins) * (max - min);
  // the tail is already inside the histogram's own resolution
  if (!(cap < min + (max - min) / 2)) return otsu(hist, min, max);
  const h = new Float64Array(bins);
  const scale = bins / (cap - min);
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (!Number.isFinite(v)) continue;
    const b = Math.floor((Math.min(v, cap) - min) * scale);
    h[b < 0 ? 0 : b >= bins ? bins - 1 : b]++;
  }
  return otsu(h, min, cap);
}

/**
 * Suggest an isosurface threshold and the range the control should span.
 *
 * - a label map cuts at 0, the mask boundary (unchanged behaviour);
 * - Hounsfield data cuts at bone, which is what a CT surface is for;
 * - anything else falls back to Otsu over the bulk of the values.
 *
 * `modality`, when the series names one, rules Hounsfield out for anything
 * but CT: an MR padded with -1000 outside its field of view reaches below
 * air and above bone like a CT does, and was cut at 300 as if it were one.
 */
export function autoThreshold(
  data: ArrayLike<number>, bins = 256,
  /** A histogram of `data` the caller already has (same bins): saves a pass. */
  pre?: { hist: Uint32Array; min: number; max: number },
  modality?: string | null,
): ThresholdSuggestion {
  const { hist, min, max } = pre && pre.hist.length === bins ? pre : histogram(data, bins);
  const lo = Math.floor(min);
  const hi = Math.ceil(max);
  if (looksLikeLabels(data, min, max)) return { value: 0, lo: 0, hi: Math.max(1, hi), kind: 'mask' };
  const mod = (modality ?? '').toUpperCase();
  const maybeCt = mod === '' || mod === 'CT';
  if (maybeCt && min <= AIR_HU && max >= BONE_HU) return { value: BONE_HU, lo, hi, kind: 'hounsfield' };
  return { value: Math.round(robustOtsu(data, hist, min, max)), lo, hi, kind: 'otsu' };
}
