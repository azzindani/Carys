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

/** True when every value is a small non-negative integer — a label map. */
function looksLikeLabels(data: ArrayLike<number>, min: number, max: number): boolean {
  if (min < 0 || max > MAX_LABEL) return false;
  // a full scan is wasted here: a label map is uniform, so a stride samples it
  const step = Math.max(1, Math.floor(data.length / 4096));
  for (let i = 0; i < data.length; i += step) {
    const v = data[i]!;
    if (!Number.isInteger(v)) return false;
  }
  return true;
}

/**
 * Suggest an isosurface threshold and the range the control should span.
 *
 * - a label map cuts at 0, the mask boundary (unchanged behaviour);
 * - Hounsfield data cuts at bone, which is what a CT surface is for;
 * - anything else falls back to Otsu.
 */
export function autoThreshold(
  data: ArrayLike<number>, bins = 256,
  /** A histogram of `data` the caller already has (same bins): saves a pass. */
  pre?: { hist: Uint32Array; min: number; max: number },
): ThresholdSuggestion {
  const { hist, min, max } = pre && pre.hist.length === bins ? pre : histogram(data, bins);
  const lo = Math.floor(min);
  const hi = Math.ceil(max);
  if (looksLikeLabels(data, min, max)) return { value: 0, lo: 0, hi: Math.max(1, hi), kind: 'mask' };
  if (min <= AIR_HU && max >= BONE_HU) return { value: BONE_HU, lo, hi, kind: 'hounsfield' };
  return { value: Math.round(otsu(hist, min, max)), lo, hi, kind: 'otsu' };
}
