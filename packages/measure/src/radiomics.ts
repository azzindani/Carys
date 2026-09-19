// G3 radiomics CSV import: pyradiomics-defined features computed offline,
// imported as Measurement rows with full provenance. The viewer never
// computes radiomics — it shows imported features, exactly like the TID1500
// import lane shows outside SRs. Pure, fail-loud: misshaped CSV throws
// named errors, never half-imports.
//
// REFERENCE: pyradiomics feature definitions (BSD-3-Clause, © 2017 Harvard
// Medical School, pasted back 2026-09-18): first-order (mean/std/min/max),
// shape (volume_mm3, area_mm2), texture placeholders stay OUT —
// computation happens offline in pyradiomics; this lane only imports the
// resulting CSV. Feature-name allowlist mirrors pyradiomics' canonical
// names so a typo'd column fails loud instead of landing as a mystery row.

import type { Measurement } from './tracking.js';

/** pyradiomics canonical feature names we accept (first-order + shape). */
export const RADIOMICS_FEATURES = [
  'original_firstorder_Mean',
  'original_firstorder_StandardDeviation',
  'original_firstorder_Minimum',
  'original_firstorder_Maximum',
  'original_shape_Volume_mm3',
  'original_shape_Area_mm2',
] as const;

export type RadiomicsFeature = (typeof RADIOMICS_FEATURES)[number];

const UNITS: Record<RadiomicsFeature, string> = {
  original_firstorder_Mean: 'HU',
  original_firstorder_StandardDeviation: 'HU',
  original_firstorder_Minimum: 'HU',
  original_firstorder_Maximum: 'HU',
  original_shape_Volume_mm3: 'mm3',
  original_shape_Area_mm2: 'mm2',
};

function isRec(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Split one CSV line on commas, honoring double-quoted fields. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Import a pyradiomics CSV (header + one row per lesion) into Measurement
 * rows. Expected columns: label + any subset of RADIOMICS_FEATURES.
 * Every row's label gains the ` · radiomics import` suffix so provenance
 * survives into CSV/SR/TID re-export (same contract as ` · SR import`).
 * Unknown feature columns throw (typo guard); non-finite values throw.
 */
export function importRadiomicsCsv(text: string, series: string): Measurement[] {
  const bad = (why: string): Error => new Error(`radiomics-import: ${why}`);
  if (!series) throw bad('series must be a non-empty string');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw bad('need a header row plus at least one data row');
  const header = splitCsv(lines[0]!).map((h) => h.trim());
  const labelIdx = header.indexOf('label');
  if (labelIdx < 0) throw bad('header needs a label column');
  const featCols: { name: RadiomicsFeature; idx: number }[] = [];
  for (const [i, h] of header.entries()) {
    if (h === 'label') continue;
    if (!(RADIOMICS_FEATURES as readonly string[]).includes(h)) {
      throw bad(`unknown feature column ${JSON.stringify(h)} (want ${RADIOMICS_FEATURES.join('|')})`);
    }
    featCols.push({ name: h as RadiomicsFeature, idx: i });
  }
  if (featCols.length === 0) throw bad('no feature columns (want at least one of ' + RADIOMICS_FEATURES.join(', ') + ')');
  const out: Measurement[] = [];
  for (const [ri, line] of lines.slice(1).entries()) {
    const cells = splitCsv(line);
    const label = (cells[labelIdx] ?? '').trim();
    if (!label) throw bad(`row ${ri + 1}: empty label`);
    for (const { name, idx } of featCols) {
      const raw = (cells[idx] ?? '').trim();
      const value = Number(raw);
      if (!Number.isFinite(value)) throw bad(`row ${ri + 1} ${name}: ${JSON.stringify(raw)} not finite`);
      out.push({
        id: `radiomics-import-${ri}-${out.length}`,
        series,
        label: `${label} ${name} · radiomics import`,
        kind: name.includes('Volume_mm3') || name.includes('Area_mm2') ? 'roi' : 'probe',
        value,
        unit: UNITS[name],
        plane: 'axial',
        slice: 0,
        points: [],
        createdAt: new Date(0).toISOString(),
      });
    }
  }
  return out;
}

/** Shape guard for JSON-embedded imports (same contract, object rows). */
export function importRadiomicsRows(rows: unknown, series: string): Measurement[] {
  if (!Array.isArray(rows)) throw new Error('radiomics-import: rows must be an array');
  return rows.flatMap((r, i) => {
    if (!isRec(r) || typeof r.label !== 'string' || !r.label) {
      throw new Error(`radiomics-import: row ${i} needs a label`);
    }
    return (Object.keys(r) as string[])
      .filter((k) => k !== 'label')
      .map((k) => {
        if (!(RADIOMICS_FEATURES as readonly string[]).includes(k)) {
          throw new Error(`radiomics-import: unknown feature column ${JSON.stringify(k)}`);
        }
        const value = r[k];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(`radiomics-import: row ${i} ${k} not finite`);
        }
        const name = k as RadiomicsFeature;
        return {
          id: `radiomics-import-${i}-${k}`,
          series,
          label: `${r.label} ${name} · radiomics import`,
          kind: (name.includes('Volume_mm3') || name.includes('Area_mm2') ? 'roi' : 'probe') as Measurement['kind'],
          value,
          unit: UNITS[name],
          plane: 'axial' as const,
          slice: 0,
          points: [] as [number, number][],
          createdAt: new Date(0).toISOString(),
        };
      });
  });
}
