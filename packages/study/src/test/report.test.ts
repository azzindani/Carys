import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ATTRIBUTION_ROWS, attributionRowsHtml, teachingSheetHtml, validateVolume, studyReportHtml, type StudyReport } from '../report.js';

describe('validator + report', () => {
  it('clean volume passes with no issues', () => {
    const r = validateVolume([64, 64, 32], [1, 1, 2], 64 * 64 * 32, new Float64Array([1, 2, 3]));
    assert.equal(r.ok, true);
    assert.deepEqual(r.issues, []);
  });
  it('bad dims, spacing, length and NaN payload each raise their code', () => {
    assert.ok(validateVolume([0, 64, 32], [1, 1, 1], 0).issues.some((i) => i.code === 'bad-dims'));
    assert.ok(validateVolume([4, 4, 4], [1, 0, 1], 64).issues.some((i) => i.code === 'bad-spacing'));
    assert.ok(validateVolume([4, 4, 4], [1, NaN, 1], 64).issues.some((i) => i.code === 'bad-spacing'));
    const len = validateVolume([4, 4, 4], [1, 1, 1], 63);
    assert.equal(len.ok, false);
    assert.ok(len.issues.some((i) => i.code === 'length-mismatch'));
    const all = validateVolume([2, 2, 1], [1, 1, 1], 4, new Float64Array([NaN, Infinity, NaN, -Infinity]));
    assert.equal(all.ok, false);
    assert.ok(all.issues.some((i) => i.code === 'all-nonfinite'));
    const some = validateVolume([2, 2, 1], [1, 1, 1], 4, new Float64Array([1, NaN, 3, 4]));
    assert.equal(some.ok, true);
    assert.ok(some.issues.some((i) => i.code === 'some-nonfinite'));
    const aniso = validateVolume([4, 4, 4], [0.5, 0.5, 5], 64);
    assert.equal(aniso.ok, true);
    assert.ok(aniso.issues.some((i) => i.code === 'anisotropic'));
  });
  it('report HTML carries values escaped, never raw markup', () => {
    const rep: StudyReport = {
      series: 'lung-ct <b>dicom</b>', note: 'a & b', dims: [4, 4, 4], spacing: [1, 1, 1],
      maskVoxels: 12, maskCm3: 0.012,
      measurements: [{ label: 'nodule <script>', kind: 'length', value: 43.3, unit: 'mm', plane: 'axial', slice: 7 }],
      issues: [{ level: 'warn', code: 'anisotropic', message: 'x < y' }],
      generatedAt: '2026-01-01',
      digestPins: { 'bodyparts3d-longbones': 'BP3D-4.0-partof-obj99' },
    };
    const html = studyReportHtml(rep);
    assert.ok(html.includes('lung-ct &lt;b&gt;dicom&lt;/b&gt;'));
    assert.ok(html.includes('nodule &lt;script&gt;'));
    assert.ok(!html.includes('<script>'), 'raw script tag leaked into report');
    assert.ok(html.includes('43.3') && html.includes('anisotropic') && html.includes('0.012'));
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('BP3D-4.0-partof-obj99'), 'digest pins render');
  });
  it('X4 attribution table mirrors the registry (7 rows, all licensed)', () => {
    assert.equal(ATTRIBUTION_ROWS.length, 7);
    assert.equal(new Set(ATTRIBUTION_ROWS.map((r) => r.id)).size, 7);
    for (const r of ATTRIBUTION_ROWS) {
      assert.ok(r.license.length > 0 && r.lane.length > 0, `${r.id} row thin`);
    }
    const html = attributionRowsHtml();
    assert.ok(html.includes('bodyparts3d-longbones') && html.includes('CC-BY-4.0'));
    assert.ok(html.includes('openanatomy-brain') && html.includes('UNVERIFIED'));
    assert.ok(html.includes('idr-screens') && html.includes('M2'));
  });
});

describe('F2 teaching sheets', () => {
  it('sheet renders labels + quiz without answers, loud on bad quiz', () => {
    const html = teachingSheetHtml({
      title: 'Left putamen',
      labels: ['left putamen · label 12 · RID21015'],
      notes: ['Mid axial third: basal ganglia.'],
      quiz: [{ prompt: 'Which plane?', options: ['Axial', 'Coronal'] }],
      provenance: ['SPL labels (Slicer B)'],
    });
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('Left putamen') && html.includes('RID21015'));
    assert.ok(html.includes('☐ Axial') && html.includes('Q1.'));
    assert.ok(!html.includes('Correct.') && !html.includes('data-answer'), 'answers must not ship on the sheet');
    assert.throws(() => teachingSheetHtml({ title: '', labels: [], notes: [], quiz: [], provenance: [] }), /teaching-sheet/);
    assert.throws(() => teachingSheetHtml({
      title: 't', labels: [], notes: [],
      quiz: [{ prompt: 'p', options: ['only'] }], provenance: [],
    }), /teaching-sheet/);
  });
});
