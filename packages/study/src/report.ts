// Validator + HTML report export (Week-4 hardening, minimal). Pure: data in,
// issues / standalone HTML out. The React shell only downloads the string.
export interface ValidationIssue {
  level: 'error' | 'warn';
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/**
 * Structural validation of a loaded volume. `length` is the sample count;
 * pass `scan` (or a head sample) to also check for NaN/Infinity payload.
 */
export function validateVolume(
  dims: [number, number, number],
  spacing: [number, number, number],
  length: number,
  scan?: ArrayLike<number>,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(dims) || dims.length !== 3 || dims.some((d) => !Number.isInteger(d) || d <= 0)) {
    issues.push({ level: 'error', code: 'bad-dims', message: `dims must be 3 positive ints, got [${dims}]` });
  }
  if (!Array.isArray(spacing) || spacing.length !== 3 || spacing.some((s) => !Number.isFinite(s) || s <= 0)) {
    issues.push({ level: 'error', code: 'bad-spacing', message: `spacing must be 3 finite positives, got [${spacing}]` });
  }
  const product = dims[0] * dims[1] * dims[2];
  if (Number.isInteger(product) && product > 0 && length !== product) {
    issues.push({ level: 'error', code: 'length-mismatch', message: `samples ${length} != dims product ${product}` });
  }
  if (spacing.every((s) => Number.isFinite(s) && s > 0)) {
    const ratio = Math.max(...spacing) / Math.min(...spacing);
    if (ratio > 5) issues.push({ level: 'warn', code: 'anisotropic', message: `spacing ratio ${ratio.toFixed(1)}x — reformats will stretch` });
  }
  if (scan && scan.length > 0) {
    let bad = 0;
    const n = Math.min(scan.length, length || scan.length);
    for (let i = 0; i < n; i++) if (!Number.isFinite(scan[i])) bad++;
    if (bad === n && n > 0) issues.push({ level: 'error', code: 'all-nonfinite', message: 'every sampled voxel is NaN/Infinity' });
    else if (bad > 0) issues.push({ level: 'warn', code: 'some-nonfinite', message: `${bad}/${n} sampled voxels are NaN/Infinity` });
  }
  return { ok: !issues.some((i) => i.level === 'error'), issues };
}

export interface ReportMeasurement {
  label: string;
  kind: string;
  value: number;
  unit: string;
  plane: string;
  slice: number;
}

export interface AttributionRow {
  id: string;
  license: string;
  lane: string;
  status: string;
  note: string;
}

/** X4 attribution table: hand-mirrored from DIGESTS.json (same ids +
 *  licenses the X1 gate validates). Static so the printable report needs
 *  no fetch; drift is caught by the X1 + digest tests, not here. */
export const ATTRIBUTION_ROWS: AttributionRow[] = [
  { id: 'bodyparts3d-longbones', license: 'CC-BY-4.0', lane: 'A1', status: 'shipped', note: 'BodyParts3D skeleton meshes (47 structures)' },
  { id: 'bodyparts3d-terms', license: 'CC-BY-4.0', lane: 'K1', status: 'shipped', note: 'FMA term table + IS-A/PART-OF tree' },
  { id: 'rcsb-pathogens', license: 'CC0-1.0', lane: 'M1', status: 'shipped', note: 'PDB pathogen structures (5 entries)' },
  { id: 'idr-catalog', license: 'CC0-1.0', lane: 'C1', status: 'shipped', note: 'Pinned IDR screens catalog (4 entries)' },
  { id: 'idr-screens', license: 'CC-BY-4.0', lane: 'M2', status: 'shipped', note: 'SARS-CoV-2 organoid screen facts (2 fields)' },
  { id: 'openanatomy-brain', license: 'UNVERIFIED (Slicer License B, human SPDX check owed)', lane: 'A3', status: 'proposed', note: 'SPL brain label table (335 rows)' },
  { id: 'openneuro-ds000001', license: 'CC0-1.0', lane: 'D1', status: 'shipped', note: 'Balloon-task T1 + BOLD crops (64³ / 64×64×33)' },
];

/** Attribution table rows for the standalone HTML report. */
export function attributionRowsHtml(): string {
  return ATTRIBUTION_ROWS.map((r) =>
    `<tr><td>${escHtml(r.id)}</td><td>${escHtml(r.license)}</td><td>${escHtml(r.lane)}</td><td>${escHtml(r.status)}</td><td>${escHtml(r.note)}</td></tr>`,
  ).join('');
}

export interface StudyReport {
  series: string;
  note: string;
  dims: [number, number, number];
  spacing: [number, number, number];
  maskVoxels: number;
  maskCm3: number;
  measurements: ReportMeasurement[];
  issues: ValidationIssue[];
  generatedAt: string;
  digestPins: Record<string, string>;
}

export function escHtml(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Standalone HTML report (no external assets, printable). */
export interface TeachingSheet {
  /** Sheet title (structure / bundle / drill name). */
  title: string;
  /** Label lines: term · id · source (already resolved strings). */
  labels: string[];
  /** Teaching notes: story / rationale / tilt-note lines. */
  notes: string[];
  /** Quiz prompts with options (answers NOT embedded — print first, answer later). */
  quiz: { prompt: string; options: string[] }[];
  /** Provenance lines for the footer. */
  provenance: string[];
}

/** F2 print-ready teaching sheet: structure labels + notes + quiz as
 *  standalone printable HTML (no external assets, print CSS). Answers
 *  never ship on the sheet — the classroom answers from the viewer. */
export function teachingSheetHtml(sh: TeachingSheet): string {
  if (!sh.title) throw new Error('teaching-sheet: title must be a non-empty string');
  const lab = sh.labels.map((l) => `<tr><td>${escHtml(l)}</td></tr>`).join('');
  const nts = sh.notes.map((n) => `<p>${escHtml(n)}</p>`).join('');
  const qz = sh.quiz.map((q, i) => {
    if (!q.prompt || q.options.length < 2) throw new Error(`teaching-sheet: quiz ${i} needs a prompt + ≥2 options`);
    return `<h3>Q${i + 1}. ${escHtml(q.prompt)}</h3><ul>${q.options.map((o) => `<li>☐ ${escHtml(o)}</li>`).join('')}</ul>`;
  }).join('');
  const prov = sh.provenance.map((p) => escHtml(p)).join(' · ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Teaching sheet — ${escHtml(sh.title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 16px;color:#111}
table{border-collapse:collapse;width:100%;margin:12px 0}td{border:1px solid #ccc;padding:6px 8px;font-size:14px}
.muted{color:#666;font-size:13px}li{margin:4px 0}@media print{.noprint{display:none}}</style>
</head><body>
<h1>${escHtml(sh.title)}</h1>
<p class="muted">education overlay — not for diagnosis · print this sheet, answer in class</p>
<h2>Labels</h2>
<table>${lab || '<tr><td>none</td></tr>'}</table>
<h2>Notes</h2>
${nts || '<p>none</p>'}
<h2>Quiz</h2>
${qz || '<p>none</p>'}
<p class="muted">${prov}</p>
</body></html>
\n`;
}

export function studyReportHtml(r: StudyReport): string {
  const mrows = r.measurements.map((m) =>
    `<tr><td>${escHtml(m.label)}</td><td>${escHtml(m.kind)}</td><td>${escHtml(m.value)}</td><td>${escHtml(m.unit)}</td><td>${escHtml(m.plane)} ${escHtml(m.slice)}</td></tr>`,
  ).join('');
  const irows = r.issues.map((i) =>
    `<tr class="${i.level}"><td>${escHtml(i.level)}</td><td>${escHtml(i.code)}</td><td>${escHtml(i.message)}</td></tr>`,
  ).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Carys report — ${escHtml(r.series)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;color:#111}
table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:14px}
tr.error td{background:#fde8e8}tr.warn td{background:#fff4d6}.muted{color:#666;font-size:13px}</style>
</head><body>
<h1>${escHtml(r.series)}</h1>
<p class="muted">${escHtml(r.note)} · generated ${escHtml(r.generatedAt)}</p>
<h2>Volume</h2>
<table><tr><th>dims</th><th>spacing (mm)</th><th>mask voxels</th><th>mask cm³</th></tr>
<tr><td>${r.dims.join(' × ')}</td><td>${r.spacing.join(' × ')}</td><td>${r.maskVoxels}</td><td>${r.maskCm3}</td></tr></table>
<h2>Validation</h2>
<table><tr><th>level</th><th>code</th><th>message</th></tr>${irows || '<tr><td colspan="3">no issues</td></tr>'}</table>
<h2>Provenance</h2>
<table><tr><th>digest</th><th>pin</th></tr>${Object.entries(r.digestPins).map(([k, v]) => `<tr><td>${escHtml(k)}</td><td>${escHtml(v)}</td></tr>`).join('') || '<tr><td colspan="2">no digests pinned for this figure</td></tr>'}</table>
<h2>Attribution</h2>
<table><tr><th>digest</th><th>license</th><th>lane</th><th>status</th><th>what</th></tr>${attributionRowsHtml()}</table>
<h2>Measurements (${r.measurements.length})</h2>
<table><tr><th>label</th><th>kind</th><th>value</th><th>unit</th><th>where</th></tr>${mrows || '<tr><td colspan="5">none</td></tr>'}</table>
</body></html>\n`;
}
