// Structured oncology reporting templates: Lung-RADS (v2022) + BI-RADS
// (5th ed) category assignment as pure lookup tables over finding features.
// Prototype scope is explicit: these encode the published category shapes
// (size thresholds, suspicious morphology flags) for research/education —
// they are NOT a medical device and never replace radiologist judgment.
//
// What stays out (documented, not silent): Lung-RADS growth-rate and
// prior-comparison logic, BI-RADS density/questionnaire integration, and
// any management recommendation text — those need product + clinical
// authorship, not just thresholds.
export interface LungRadsFinding {
  /** solid nodule long axis in mm (0 = none / ground-glass only) */
  solidMm: number;
  /** part-solid total size in mm (0 = not part-solid) */
  partSolidMm: number;
  /** ground-glass (non-solid) nodule size in mm (0 = none) */
  groundGlassMm: number;
  /** suspicious morphology (spiculation, suspicious nodes, etc.) */
  suspicious: boolean;
}

export interface BiRadsFinding {
  /** mass present (shape/margin/density handled as suspicious below) */
  mass: boolean;
  /** suspicious mass features (spiculated/irregular/high-density) */
  suspiciousMass: boolean;
  /** suspicious calcifications (fine pleomorphic/linear/fine-linear) */
  suspiciousCalcs: boolean;
  /** architectural distortion or asymmetry requiring workup */
  distortion: boolean;
}

export type LungRadsCategory = '0' | '1' | '2' | '3' | '4A' | '4B' | '4X';
export type BiRadsCategory = '0' | '1' | '2' | '3' | '4A' | '4B' | '4C' | '5' | '6';

/** Lung-RADS category from the dominant finding (highest category wins). */
export function lungRads(f: LungRadsFinding): LungRadsCategory {
  if (f.suspicious) return '4X';
  const { solidMm, partSolidMm, groundGlassMm } = f;
  if (partSolidMm >= 6) return '4B';
  if (solidMm >= 8 || partSolidMm >= 6) return '4A';
  if (solidMm >= 6 || partSolidMm >= 6 || groundGlassMm >= 30) return '3';
  if (solidMm >= 4 || partSolidMm >= 4 || groundGlassMm >= 20) return '2';
  return '1';
}

/** BI-RADS assessment category from imaging findings (no history input). */
export function biRads(f: BiRadsFinding): BiRadsCategory {
  if (f.suspiciousMass && (f.suspiciousCalcs || f.distortion)) return '5';
  if (f.suspiciousMass || f.suspiciousCalcs) return '4C';
  if (f.mass || f.distortion) return '4A';
  return '2';
}
