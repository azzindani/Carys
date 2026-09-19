// Q1–Q4 lab QC aggregations: phantom trending, dose registry, compression
// audit, de-identification report card. All pure over data the app already
// holds (per-series phantom means, dose summaries, transfer-syntax tags,
// de-id classifications) — no new fetch paths, no backend. Numbers in,
// table rows out; the app renders, the report exports.
//
// Prototype scope: screening aggregates for research/education labs, never
// validated QC claims and never diagnosis. A guessed dose is worse than a
// missing one (same rule as summarizeDose); unknown syntaxes stay
// 'unvalidated', never 'fine'.

import { compressionWarning, phantomCheck, summarizeDose } from './safety.js';

/** One phantom measurement: mean HU over a uniform region + scan date. */
export interface PhantomPoint {
  /** Series key (worklist/catalog key). */
  series: string;
  /** Scan date (YYYY-MM-DD free text; sorted lexicographically). */
  date: string;
  /** Mean HU over the uniform region. */
  meanHU: number;
  /** Expected HU for the phantom material. */
  expectedHU: number;
  /** Tolerance half-width in HU. */
  toleranceHU: number;
}

/** One trended phantom row: pass/fail + drift vs the first point. */
export interface PhantomTrendRow {
  series: string;
  date: string;
  meanHU: number;
  pass: boolean;
  /** meanHU − first-point meanHU (0 for the first point). */
  driftHU: number;
}

/**
 * Q1 phantom trending: per-point pass/fail via phantomCheck + drift vs
 * the earliest-date point. Points sort by date (stable); bad inputs throw
 * the safety lane's own named errors (never swallowed).
 */
export function phantomTrend(points: PhantomPoint[]): PhantomTrendRow[] {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const base = sorted.length > 0 ? sorted[0]!.meanHU : 0;
  return sorted.map((p) => ({
    series: p.series,
    date: p.date,
    meanHU: p.meanHU,
    pass: phantomCheck(p.meanHU, p.expectedHU, p.toleranceHU),
    driftHU: Math.round((p.meanHU - base) * 1000) / 1000,
  }));
}

/** One per-series dose surfacing input (header values, nullable). */
export interface DoseRow {
  series: string;
  ctdivol: unknown;
  dlp: unknown;
  kvp: unknown;
}

/** Q2 dose registry: per-series numbers-or-null + cohort "not recorded" rates. */
export interface DoseRegistry {
  rows: { series: string; ctdivol: number | null; dlp: number | null; kvp: number | null }[];
  /** Fraction of series with each field unrecorded (0..1, 1 when empty). */
  notRecorded: { ctdivol: number; dlp: number; kvp: number };
}

export function doseRegistry(rows: DoseRow[]): DoseRegistry {
  const out = rows.map((r) => ({ series: r.series, ...summarizeDose(r) }));
  const rate = (k: 'ctdivol' | 'dlp' | 'kvp'): number =>
    out.length === 0 ? 1 : out.filter((r) => r[k] === null).length / out.length;
  return { rows: out, notRecorded: { ctdivol: rate('ctdivol'), dlp: rate('dlp'), kvp: rate('kvp') } };
}

/** One per-series compression input (transfer syntax UID, nullable). */
export interface CompressionRow {
  series: string;
  transferSyntaxUID: string | null;
}

/** Q3 compression audit: per-series caution class + unvalidated rate. */
export interface CompressionAudit {
  rows: { series: string; verdict: string }[];
  /** Fraction starting with 'unknown' or 'lossy' (1 when empty). */
  unvalidatedRate: number;
}

export function compressionAudit(rows: CompressionRow[]): CompressionAudit {
  const out = rows.map((r) => ({ series: r.series, verdict: compressionWarning(r.transferSyntaxUID) }));
  const unvalidatedRate = out.length === 0
    ? 1
    : out.filter((r) => r.verdict.startsWith('unknown') || r.verdict.startsWith('lossy')).length / out.length;
  return { rows: out, unvalidatedRate: Math.round(unvalidatedRate * 1000) / 1000 };
}

/** One per-series de-id input: burned-pixel screen + PS3.15 action counts. */
export interface DeidRow {
  series: string;
  /** Fraction of frame pixels at the digitizer ceiling (0..1). */
  burnedFraction: number;
  /** PS3.15 classification counts (replace/remove/keep). */
  actions: { replace: number; remove: number; keep: number };
}

/** Q4 de-identification report card: per-series checklist rows. */
export interface DeidCard {
  rows: { series: string; burnedFlag: boolean; burnedFraction: number; replace: number; remove: number; keep: number; ready: boolean }[];
  /** Series count with zero flags (all ready). */
  readyCount: number;
}

export function deidReportCard(
  rows: DeidRow[], burnedThreshold = 0.001,
): DeidCard {
  if (!Number.isFinite(burnedThreshold) || burnedThreshold < 0) {
    throw new RangeError(`deid-bad-threshold: ${burnedThreshold}`);
  }
  const out = rows.map((r) => {
    if (!Number.isFinite(r.burnedFraction) || r.burnedFraction < 0 || r.burnedFraction > 1) {
      throw new RangeError(`deid-bad-fraction: ${r.series} ${r.burnedFraction}`);
    }
    const burnedFlag = r.burnedFraction >= burnedThreshold;
    const ready = !burnedFlag && r.actions.remove === 0 && r.actions.replace >= 0;
    return {
      series: r.series, burnedFlag,
      burnedFraction: Math.round(r.burnedFraction * 1000000) / 1000000,
      replace: r.actions.replace, remove: r.actions.remove, keep: r.actions.keep, ready,
    };
  });
  return { rows: out, readyCount: out.filter((r) => r.ready).length };
}
