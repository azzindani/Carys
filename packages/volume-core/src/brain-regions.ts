// A3 brain-region service: the neuro companion to the tract-ROI lane.
// Vendored from the SPL brain atlas label table (335 rows, RadLex-backed;
// labels.json in digests/openanatomy-brain), this module answers the two
// questions the N2 waypoint picker needs: "what region is label v?" and
// "which labels belong to region X?". Teaching geometry only — the big
// SPL label volume is NOT vendored (200MB zip stays remote; the viewer
// frames its regions as linked waypoint names + fractional presets here).
//
// Ledger row: openanatomy-brain, 3D-Slicer-License-B (UNVERIFIED SPDX
// mapping — the atlas page names it, a human still owes the SPDX call),
// mode digest, lane A3, status proposed until the gate passes. Prototype
// scope: region names + RadLex ids for teaching; never diagnosis.
//
// Dependency-free by design (mirrors terms.ts): plain lookup tables,
// installed once via installBrainTable (tests + app bootstrap), never
// imported as JSON, so the module stays bundler-safe.

/** License line carried on every A3 answer (page-verified 2026-09-17). */
export const BRAIN_ATTRIBUTION =
  'SPL brain atlas labels © Surgical Planning Laboratory (3D Slicer License, section B — see digests/openanatomy-brain/SOURCES.json)';

/** Digest pin recorded when a brain region resolves (label table version). */
export const BRAIN_DIGEST_ID = 'openanatomy-brain';
export const BRAIN_DIGEST_PIN = 'spl-brain-atlas-labelinfo-335';

/** One vendored label row: value + English name + RadLex + display color. */
export interface BrainLabel {
  /** Label value in the SPL volume (e.g. 12 = left putamen). */
  v: number;
  /** English label, e.g. 'left putamen'. */
  label: string;
  /** RadLex id (RID…), or '' when the row carries none (muscles/sulci). */
  rid: string;
  /** Display color string from the LUT (rgb()/rgba() form). */
  color: string;
}

/** Slim row shape in the vendored labels.json. */
export interface BrainLabelRow {
  v: number;
  label: string;
  rid: string;
  color: string;
}

let TABLE: BrainLabelRow[] = [];
let BY_VALUE = new Map<number, BrainLabelRow>();

/**
 * Install the vendored label table (parsed labels.json). Called once by
 * tests + the app bootstrap before any lookup. Re-installs replace the
 * table wholesale — last write wins, no merging.
 */
export function installBrainTable(rows: BrainLabelRow[]): void {
  TABLE = rows;
  BY_VALUE = new Map(rows.map((r) => [r.v, r]));
}

/** Fail-loud row check: a corrupt vendored table throws, never half-loads. */
export function validateBrainTable(rows: unknown): BrainLabelRow[] {
  const bad = (why: string): Error => new Error(`bad-brain-input: ${why}`);
  if (!Array.isArray(rows)) throw bad('top level must be an array');
  if (rows.length === 0) throw bad('table must not be empty');
  const seen = new Set<number>();
  for (const [i, r] of rows.entries()) {
    const o = r as Record<string, unknown>;
    if (!o || typeof o !== 'object') throw bad(`row ${i} must be an object`);
    if (!Number.isInteger(o.v) || (o.v as number) < 0) throw bad(`row ${i}.v must be a non-negative int`);
    if (seen.has(o.v as number)) throw bad(`duplicate value ${o.v}`);
    seen.add(o.v as number);
    if (!o.label || typeof o.label !== 'string') throw bad(`row ${i}.label must be a non-empty string`);
    if (typeof o.rid !== 'string') throw bad(`row ${i}.rid must be a string (possibly empty)`);
    if (!o.color || typeof o.color !== 'string') throw bad(`row ${i}.color must be a non-empty string`);
  }
  return rows as BrainLabelRow[];
}

/** Resolve a label value to its row. Null when unknown (caller stays loud). */
export function brainLabelByValue(v: number): BrainLabel | null {
  const r = BY_VALUE.get(v);
  return r ? { ...r } : null;
}

/**
 * Case-insensitive substring search over labels + RadLex ids.
 * Empty/blank queries return [] (never the whole table). Bounded to
 * `limit` hits in label-value order for determinism.
 */
export function searchBrainLabels(query: string, limit = 25): BrainLabel[] {
  const q = query.trim().toLowerCase();
  if (!q || limit <= 0) return [];
  const hits: BrainLabel[] = [];
  for (const r of [...TABLE].sort((a, b) => a.v - b.v)) {
    if (r.label.toLowerCase().includes(q) || r.rid.toLowerCase().includes(q)) {
      hits.push({ ...r });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/** Labels carrying a RadLex id (the ontology-backed subset). Count, not rows. */
export function radlexCount(): number {
  return TABLE.filter((r) => r.rid.length > 0).length;
}
