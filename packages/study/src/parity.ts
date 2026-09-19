// Report JSON + HTML parity: the same StudyReport feeds both the HTML
// string and a canonical JSON document; byte-compare proves the figure
// regenerates identically. The JSON carries a fingerprint (FNV-1a over
// the canonical inputs — stdlib-free so the browser bundle keeps it) so
// a regenerated figure can be compared without storing the whole document.
import { studyReportHtml, type StudyReport } from './report.js';

/** Canonical JSON: fixed key order, rounded floats, trailing newline. */
export function reportToJSON(r: StudyReport): string {
  const canon = {
    series: r.series,
    note: r.note,
    dims: r.dims,
    spacing: r.spacing,
    maskVoxels: r.maskVoxels,
    maskCm3: r.maskCm3,
    measurements: r.measurements.map((m) => ({
      label: m.label, kind: m.kind,
      value: Math.round(m.value * 1000) / 1000, unit: m.unit,
      plane: m.plane, slice: m.slice,
    })),
    issues: r.issues.map((i) => ({ level: i.level, code: i.code, message: i.message })),
    generatedAt: r.generatedAt,
  };
  return JSON.stringify(canon, null, 2) + '\n';
}

/** Short fingerprint of the canonical JSON (FNV-1a, 8 hex chars). */
export function reportFingerprint(r: StudyReport): string {
  let h = 0x811c9dc5;
  const s = reportToJSON(r);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Regenerate check: the HTML must embed every canonical field (series,
 * dims, mask numbers, each measurement label + value, each issue code).
 * Returns the missing pieces (empty = parity holds).
 */
export function reportHtmlParity(r: StudyReport, html: string): string[] {
  const missing: string[] = [];
  const has = (s: string, name: string): void => {
    if (!html.includes(s)) missing.push(name);
  };
  has(r.series, 'series');
  has(r.dims.join(' × '), 'dims');
  has(String(r.maskVoxels), 'maskVoxels');
  has(String(r.maskCm3), 'maskCm3');
  for (const m of r.measurements) {
    has(m.label, `measurement:${m.label}`);
    has(String(m.value), `value:${m.label}`);
  }
  for (const i of r.issues) has(i.code, `issue:${i.code}`);
  for (const [k, v] of Object.entries(r.digestPins)) {
    has(k, `digest:${k}`);
    has(v, `pin:${k}`);
  }
  return missing;
}

/** Convenience: build both artifacts + fingerprint in one call. */
export function reportArtifacts(r: StudyReport): { html: string; json: string; fingerprint: string } {
  return { html: studyReportHtml(r), json: reportToJSON(r), fingerprint: reportFingerprint(r) };
}
