import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPRO_FORMAT, REPRO_FORMAT_LEGACY, buildReproSidecar, parseReproSidecar, reproSidecarToJSON,
  sidecarReportDiff, type ReproInput,
} from '../repro.js';
import { studyReportHtml, type StudyReport } from '../report.js';

const snap = (): ReproInput => ({
  series: 'lung-ct-dicom',
  studyUID: '1.2.3',
  seriesUID: '1.2.3.4',
  dims: [4, 4, 4],
  spacing: [1, 1, 2],
  slices: { axial: 2, coronal: 1, sagittal: 3 },
  wl: { width: 400, center: 40 },
  preset: 'custom',
  lut: 'Grayscale',
  invert: false,
  proj: 'slice',
  slab: 9,
  oblA: 0,
  oblB: 0,
  oblPlane: 'axial',
  src: 'mask',
  threshold: 0,
  method: 'blocky',
  maskVer: 3,
  meshKey: 'lung-ct-dicom|m3|mask|0|blocky',
  digestPins: {},
  maskVoxels: 12,
  maskCm3: 0.024,
  measurements: [{ label: 'nodule', kind: 'length', value: 43.3, unit: 'mm', plane: 'axial', slice: 2 }],
  validation: { ok: true, issues: [] },
  generatedAt: '2026-09-15T00:00:00.000Z',
});

describe('repro sidecar', () => {
  it('round-trips every pinned field with byte-stable key order', () => {
    const json = reproSidecarToJSON(buildReproSidecar(snap()));
    assert.ok(json.indexOf('"format"') < json.indexOf('"series"'), 'envelope first');
    assert.ok(json.indexOf('"meshKey"') < json.indexOf('"measurements"'), 'derivation before results');
    const back = parseReproSidecar(json);
    assert.deepEqual(back, buildReproSidecar(snap()));
    assert.equal(back.format, REPRO_FORMAT);
    assert.deepEqual(back.slices, { axial: 2, coronal: 1, sagittal: 3 });
    assert.deepEqual(back.wl, { width: 400, center: 40 });
    assert.equal(back.meshKey, 'lung-ct-dicom|m3|mask|0|blocky');
    assert.deepEqual(back.digestPins, {});
    const pinned = buildReproSidecar({ ...snap(), digestPins: { 'z-anatomy': 'v2.1' } });
    assert.deepEqual(parseReproSidecar(reproSidecarToJSON(pinned)).digestPins, { 'z-anatomy': 'v2.1' });
    assert.throws(() => buildReproSidecar({ ...snap(), digestPins: { 'z-anatomy': '' } }), /bad-sidecar-input/);
    assert.equal(back.maskVer, 3);
  });
  it('hostile input fails loud with named errors', () => {
    const parses: Array<[string, RegExp]> = [
      ['{nope', /bad-json/],
      ['[1,2]', /bad-sidecar/],
      ['null', /bad-sidecar/],
      [JSON.stringify({ ...JSON.parse(reproSidecarToJSON(buildReproSidecar(snap()))), format: 'omniviewer-repro/9' }), /bad-sidecar/],
      [JSON.stringify({ format: REPRO_FORMAT_LEGACY }), /bad-sidecar: missing/],
      [JSON.stringify({ format: REPRO_FORMAT }), /bad-sidecar: missing/],
      [reproSidecarToJSON(buildReproSidecar(snap())).replace('"width": 400', '"width": "wide"'), /bad-sidecar/],
    ];
    for (const [text, re] of parses) assert.throws(() => parseReproSidecar(text), re, text.slice(0, 60));
    const builds: Array<[Partial<ReproInput>, RegExp]> = [
      [{ series: '' }, /bad-sidecar-input/],
      [{ dims: [4, 4] as unknown as [number, number, number] }, /bad-sidecar-input/],
      [{ slices: { axial: -1, coronal: 1, sagittal: 3 } }, /bad-sidecar-input/],
      [{ wl: { width: NaN, center: 40 } }, /bad-sidecar-input/],
      [{ meshKey: '' }, /bad-sidecar-input/],
      [{ maskVer: -1 }, /bad-sidecar-input/],
    ];
    for (const [patch, re] of builds) assert.throws(() => buildReproSidecar({ ...snap(), ...patch }), re);
  });
  it('sidecar matches the HTML report inputs, drift names itself', () => {
    const s = snap();
    const report: StudyReport = {
      series: s.series, note: '', dims: s.dims, spacing: s.spacing,
      maskVoxels: s.maskVoxels, maskCm3: s.maskCm3,
      measurements: s.measurements, issues: [], generatedAt: s.generatedAt!,
      digestPins: { ...s.digestPins },
    };
    const sidecar = buildReproSidecar(s);
    assert.deepEqual(sidecarReportDiff(sidecar, report), []);
    const html = studyReportHtml(report);
    assert.ok(html.includes('43.3') && html.includes('lung-ct-dicom'), 'HTML carries the same values');
    const drifted: StudyReport = { ...report, maskVoxels: 13, measurements: [] };
    const d = sidecarReportDiff(sidecar, drifted);
    assert.ok(d.some((m) => m.startsWith('maskVoxels')), `drift names maskVoxels: ${d}`);
    assert.ok(d.some((m) => m.startsWith('measurements.length')), `drift names measurements: ${d}`);
  });
});
