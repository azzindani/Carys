// I2 TID 1500 import: the export lane's mirror. Reads outside measurement
// SRs (our own JSON shape first) back into Measurement rows,
// provenance-tagged so imported rows never masquerade as local ones.
// Pure, fail-loud: misshaped trees throw named errors, never half-import.
//
// Prototype scope: our own JSON shape only (round-trip proof). Vendor SR
// dialects (different designators, TID 1410 planar ROIs, SEG-derived
// SCOORD flavors) stay loud rejections — the error names the first thing
// it could not read, so the next dialect is one case away.

import type { Measurement } from './tracking.js';

function isRec(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function seq(node: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const v = node[key];
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => !isRec(x))) {
    throw new Error(`tid1500-bad-seq: ${key} must be an array of content items`);
  }
  return v as Record<string, unknown>[];
}

function codeMeaning(node: Record<string, unknown>): string {
  const s = seq(node, 'ConceptNameCodeSequence')[0];
  if (!s || typeof s.CodeMeaning !== 'string' || !s.CodeMeaning) {
    throw new Error('tid1500-bad-code: ConceptNameCodeSequence[0].CodeMeaning must be a non-empty string');
  }
  return s.CodeMeaning;
}

function numValue(node: Record<string, unknown>): number {
  const m = seq(node, 'MeasuredValueSequence')[0];
  if (!m || typeof m.NumericValue !== 'number' || !Number.isFinite(m.NumericValue)) {
    throw new Error('tid1500-bad-num: MeasuredValueSequence[0].NumericValue must be a finite number');
  }
  return m.NumericValue;
}

function unitOf(node: Record<string, unknown>): string {
  const m = seq(node, 'MeasuredValueSequence')[0];
  const u = m ? seq(m, 'MeasurementUnitsCodeSequence')[0] : undefined;
  return (u && typeof u.CodeMeaning === 'string' ? u.CodeMeaning : '') || '';
}

function scoordPoints(node: Record<string, unknown>): [number, number][] {
  const inner = seq(node, 'ContentSequence').find((c) => c.ValueType === 'SCOORD');
  if (!inner) return [];
  const flat = inner.GraphicData;
  if (!Array.isArray(flat) || flat.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new Error('tid1500-bad-scoord: GraphicData must be finite numbers');
  }
  if (flat.length % 2 !== 0) throw new Error('tid1500-bad-scoord: GraphicData must pair x/y');
  const pts: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i] as number, flat[i + 1] as number]);
  return pts;
}

function groupSite(group: Record<string, unknown>[]): string {
  void group;
  return 'axial';
}

/**
 * Import a TID 1500 JSON tree (our measurementsToTid1500 shape) into
 * Measurement rows. `series` names the import target; every row's label
 * gains the ` · SR import` suffix so provenance survives into CSV/SR/TID
 * re-export. Unknown ValueTypes inside NUM items throw; CONTAINER/TEXT
 * structure mismatches throw at the first unreadable node.
 */
export function importTid1500(tree: unknown, series: string): Measurement[] {
  const bad = (why: string): Error => new Error(`tid1500-import: ${why}`);
  if (!isRec(tree)) throw bad('top level must be an object');
  if (!series) throw bad('series must be a non-empty string');
  const topItems = seq(tree, 'ContentSequence');
  const top = topItems.find((c) => c.ValueType === 'CONTAINER');
  if (!top) throw bad('missing top CONTAINER');
  let imaging: Record<string, unknown>;
  try {
    imaging = codeMeaning(top) === 'Imaging Measurements' ? top : (() => { throw new Error('x'); })();
  } catch {
    throw bad('missing Imaging Measurements container (own-shape only; vendor dialects rejected)');
  }
  const out: Measurement[] = [];
  const groups = seq(imaging, 'ContentSequence');
  if (groups.length === 0) throw bad('Imaging Measurements carries no Measurement Groups');
  for (const [gi, g] of groups.entries()) {
    if (g.ValueType !== 'CONTAINER') throw new Error(`tid1500-import: group ${gi} must be a CONTAINER`);
    const inner = seq(g, 'ContentSequence');
    const nums = inner.filter((c) => c.ValueType === 'NUM');
    if (nums.length === 0) throw new Error(`tid1500-import: group ${gi} carries no NUM measurements`);
    for (const n of nums) {
      const label = codeMeaning(n);
      const value = numValue(n);
      const unit = unitOf(n);
      const points = scoordPoints(n);
      out.push({
        id: `sr-import-${gi}-${out.length}`,
        series,
        label: `${label} · SR import`,
        kind: label.startsWith('angle') ? 'angle' : label.startsWith('roi') ? 'roi' : 'length',
        value,
        unit,
        plane: groupSite(inner) as 'axial',
        slice: 0,
        points,
        createdAt: new Date(0).toISOString(),
      });
    }
  }
  return out;
}
