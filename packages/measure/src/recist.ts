// RECIST 1.1 target-lesion response (Eisenhauer et al., Eur J Cancer 2009),
// prototype subset: sums of long axes, nadir tracking, CR/PR/SD/PD, plus
// volume-doubling time. Pure arithmetic, no DOM.
//
// Deferred (documented, not silent): nodal <10mm short-axis CR nuance,
// non-target lesions, overall visit response, unequivocal-progression
// judgment calls — those need radiologist input, not just arithmetic.
export interface TargetLesion {
  /** longest diameter in mm (short axis for nodes) */
  longAxis: number;
  /** nodes flagged for the <10mm CR rule (rule itself deferred) */
  nodal?: boolean;
}

export type RecistCategory = 'CR' | 'PR' | 'SD' | 'PD';

export interface RecistAssessment {
  baselineSum: number;
  nadirSum: number;
  currentSum: number;
  category: RecistCategory;
  /** % change vs baseline (negative = shrinkage) */
  pctFromBaseline: number;
  /** % change vs nadir (positive = regrowth) */
  pctFromNadir: number;
  /** absolute regrowth vs nadir in mm (the 5mm PD floor) */
  absFromNadir: number;
  newLesion: boolean;
}

/** Sum of longest diameters (mm). Empty set = 0 (no measurable disease). */
export function targetSum(lesions: TargetLesion[]): number {
  let s = 0;
  for (const l of lesions) {
    if (!Number.isFinite(l.longAxis) || l.longAxis < 0) {
      throw new RangeError(`recist-bad-axis: ${l.longAxis}`);
    }
    s += l.longAxis;
  }
  return s;
}

/**
 * RECIST 1.1 target response from baseline + nadir + current sums.
 * Thresholds: PR ≥30% drop from baseline; PD ≥20% rise from nadir AND
 * ≥5mm absolute rise, or any new lesion; CR = complete disappearance;
 * else SD. Zero-baseline/nadir sums degrade loudly to ±Infinity, never NaN.
 */
export function assessRecist(
  baseline: TargetLesion[],
  nadir: TargetLesion[],
  current: TargetLesion[],
  newLesion = false,
): RecistAssessment {
  const baselineSum = targetSum(baseline);
  const nadirSum = targetSum(nadir);
  const currentSum = targetSum(current);
  const pctFromBaseline = baselineSum > 0
    ? ((currentSum - baselineSum) / baselineSum) * 100
    : currentSum > 0 ? Infinity : 0;
  const pctFromNadir = nadirSum > 0
    ? ((currentSum - nadirSum) / nadirSum) * 100
    : currentSum > 0 ? Infinity : 0;
  const absFromNadir = currentSum - nadirSum;
  let category: RecistCategory;
  if (newLesion || (pctFromNadir >= 20 && absFromNadir >= 5)) category = 'PD';
  else if (currentSum === 0) category = 'CR';
  else if (pctFromBaseline <= -30) category = 'PR';
  else category = 'SD';
  return {
    baselineSum, nadirSum, currentSum, category,
    pctFromBaseline, pctFromNadir, absFromNadir, newLesion,
  };
}

/**
 * Volume-doubling time in days: dt · ln2 / ln(V2/V1). No observed growth
 * (V2 ≤ V1) returns Infinity — the lesion did not double in the interval.
 * Non-positive volumes or intervals throw (fail-loud named error).
 */
export function volumeDoublingTime(v1: number, v2: number, dtDays: number): number {
  if (!(v1 > 0) || !(v2 > 0)) throw new RangeError(`vdt-positive-volumes: ${v1}, ${v2}`);
  if (!(dtDays > 0)) throw new RangeError(`vdt-positive-interval: ${dtDays}`);
  if (v2 <= v1) return Infinity;
  return (dtDays * Math.LN2) / Math.log(v2 / v1);
}
