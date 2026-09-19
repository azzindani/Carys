// Lesion delta table: pair baseline ↔ follow-up length measurements by
// label, reporting Δ long axis + % change. Volume deltas come from the
// mask stats the caller supplies (maskCm3 before/after) — this file owns
// the pairing + arithmetic, never data fetching. Pure, no DOM.
//
// Pairing rule: same label prefix before " — " (the follow-up suffix the
// compare view suggests) or exact label match; unpaired rows are listed
// with null deltas rather than dropped (a missing follow-up is signal).
import type { Measurement } from './tracking.js';

export interface LesionDelta {
  label: string;
  baseline: number | null;
  followup: number | null;
  unit: string;
  deltaMm: number | null;
  pctChange: number | null;
}

/** Strip a follow-up suffix (" — FU", " (FU)", " FU2") to the base label. */
export function baseLabel(label: string): string {
  return label.replace(/\s+(—|-|\(FU\)|FU\d*)\s*.*$/, '').trim() || label;
}

/**
 * Pair length/ellipse/roi measurements across two series snapshots.
 * `base` + `fu` are measurement lists (same labels expected); unmatched
 * rows appear with a null side.
 */
export function lesionDeltaTable(base: Measurement[], fu: Measurement[]): LesionDelta[] {
  const kinds = new Set(['length', 'ellipse', 'roi']);
  const bmap = new Map<string, Measurement>();
  for (const m of base) {
    if (!kinds.has(m.kind)) continue;
    const k = baseLabel(m.label);
    if (!bmap.has(k)) bmap.set(k, m);
  }
  const fmap = new Map<string, Measurement>();
  for (const m of fu) {
    if (!kinds.has(m.kind)) continue;
    const k = baseLabel(m.label);
    if (!fmap.has(k)) fmap.set(k, m);
  }
  const out: LesionDelta[] = [];
  for (const [k, b] of bmap) {
    const f = fmap.get(k) ?? null;
    out.push({
      label: k,
      baseline: b.value,
      followup: f?.value ?? null,
      unit: b.unit,
      deltaMm: f ? f.value - b.value : null,
      pctChange: f && b.value !== 0 ? ((f.value - b.value) / b.value) * 100 : null,
    });
  }
  for (const [k, f] of fmap) {
    if (bmap.has(k)) continue;
    out.push({
      label: k, baseline: null, followup: f.value, unit: f.unit,
      deltaMm: null, pctChange: null,
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/** Volume delta from two mask volumes (cm³): absolute + % change. */
export function volumeDelta(
  v0: number, v1: number,
): { deltaCm3: number; pctChange: number | null } {
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) {
    throw new RangeError(`delta-volumes: ${v0}, ${v1}`);
  }
  return {
    deltaCm3: v1 - v0,
    pctChange: v0 !== 0 ? ((v1 - v0) / v0) * 100 : v1 > 0 ? Infinity : 0,
  };
}

/** One-row-per-lesion CSV of the delta table. */
export function lesionDeltaTableToCSV(rows: LesionDelta[]): string {
  const cell = (v: string | number): string => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const fmt = (v: number | null): string =>
    v === null ? '' : Number.isFinite(v) ? String(Math.round(v * 100) / 100) : 'n/a';
  return [
    ['lesion', 'baseline', 'followup', 'unit', 'delta', 'pct_change'].join(','),
    ...rows.map((r) =>
      [r.label, fmt(r.baseline), fmt(r.followup), r.unit, fmt(r.deltaMm), fmt(r.pctChange)].map(cell).join(',')),
  ].join('\n') + '\n';
}
