// Medical-grade workflow/safety helpers: burned-pixel (PHI) screening,
// orientation sanity, dose surfacing, and compression warnings. All pure,
// all fail-loud, all operating on data the app already holds — no new
// fetch paths, no backend.
//
// Prototype scope: these are screening heuristics for research/education,
// not validated safety claims. Clinical safety needs a QMS + validation
// the static prototype does not carry.
import type { Volume } from '@carys/volume-core';

/** Fraction of pixels in a 2D frame at/above the digitizer ceiling. */
export function burnedPixelFraction(frame: ArrayLike<number>, ceiling: number): number {
  if (frame.length === 0) throw new RangeError('burned-empty-frame');
  if (!Number.isFinite(ceiling)) throw new RangeError(`burned-bad-ceiling: ${ceiling}`);
  let n = 0;
  for (let i = 0; i < frame.length; i++) if (frame[i]! >= ceiling) n++;
  return n / frame.length;
}

/**
 * Burned-pixel verdict for US / secondary-capture frames: bright text
 * overlays (IDs, dates) sit at the digitizer ceiling. Over `threshold`
 * fraction at ceiling ⇒ flag for de-identification review. Returns the
 * fraction + the boolean so callers can log the number, not just the flag.
 */
export function screenBurnedPixels(
  frame: ArrayLike<number>, ceiling: number, threshold = 0.001,
): { fraction: number; flagged: boolean } {
  const fraction = burnedPixelFraction(frame, ceiling);
  return { fraction, flagged: fraction >= threshold };
}

export interface OrientationCheck {
  ok: boolean;
  /** human-readable reason (empty when ok) */
  reason: string;
}

/**
 * Orientation sanity: volume axes must be positive and finite, and the
 * axial extent must cover at least `minSlices` slices. Catches the classic
 * "loaded the wrong series / collapsed stack" before a read starts.
 */
export function checkOrientation(
  dims: [number, number, number], spacing: [number, number, number], minSlices = 2,
): OrientationCheck {
  for (let a = 0; a < 3; a++) {
    if (!Number.isFinite(dims[a]) || dims[a]! <= 0) {
      return { ok: false, reason: `bad dims[${a}]: ${dims[a]}` };
    }
    if (!Number.isFinite(spacing[a]) || spacing[a]! <= 0) {
      return { ok: false, reason: `bad spacing[${a}]: ${spacing[a]}` };
    }
  }
  if (dims[2]! < minSlices) return { ok: false, reason: `only ${dims[2]} axial slice(s)` };
  return { ok: true, reason: '' };
}

/**
 * Dose surfacing: pass through whatever the header carries (CTDIvol,
 * DLP, kVp — all nullable), normalized to numbers-or-null so the report
 * can print "not recorded" instead of guessing. No estimation: a guessed
 * dose is worse than a missing one.
 */
export interface DoseSummary {
  ctdivol: number | null;
  dlp: number | null;
  kvp: number | null;
}

export function summarizeDose(input: {
  ctdivol?: unknown; dlp?: unknown; kvp?: unknown;
}): DoseSummary {
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  return { ctdivol: num(input.ctdivol), dlp: num(input.dlp), kvp: num(input.kvp) };
}

/**
 * Lossy-compression warning: transfer syntaxes the viewer decodes (or
 * loudly rejects) mapped to a user-facing caution. Unknown syntaxes pass
 * through as 'unknown' — never silently 'fine'.
 */
export function compressionWarning(transferSyntaxUID: string | null): string {
  if (!transferSyntaxUID) return 'unknown: transfer syntax not surfaced to the report — treat as unvalidated';
  if (transferSyntaxUID === '1.2.840.10008.1.2.1') return 'none: implicit VR little endian';
  if (transferSyntaxUID === '1.2.840.10008.1.2') return 'none: explicit VR little endian';
  if (transferSyntaxUID.endsWith('.1.2.4.50') || transferSyntaxUID.endsWith('.1.2.4.51')) {
    return 'lossy: JPEG baseline — not for primary diagnosis without validation';
  }
  if (transferSyntaxUID.endsWith('.1.2.4.70') || transferSyntaxUID.endsWith('.1.2.4.80')) {
    return 'lossless: JPEG lossless / JPEG-LS — bit-exact on CPU in this build';
  }
  if (transferSyntaxUID.endsWith('.1.2.4.81') || transferSyntaxUID.endsWith('.1.2.4.90')
    || transferSyntaxUID.endsWith('.1.2.4.91')) {
    return 'lossy: JPEG-LS near-lossless / JPEG 2000 — decode unsupported in this build, series rejected at load';
  }
  return `unknown: ${transferSyntaxUID} — treat as unvalidated`;
}

/** Phantom QC: mean ± tolerance check over a uniform region (single number in, boolean out). */
export function phantomCheck(meanHU: number, expectedHU: number, toleranceHU: number): boolean {
  if (![meanHU, expectedHU, toleranceHU].every(Number.isFinite)) {
    throw new RangeError('phantom-nonfinite-input');
  }
  if (toleranceHU < 0) throw new RangeError(`phantom-negative-tolerance: ${toleranceHU}`);
  return Math.abs(meanHU - expectedHU) <= toleranceHU;
}

export type { Volume };
