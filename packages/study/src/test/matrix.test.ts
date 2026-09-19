import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { anonymizeRecord } from '../anonymize.js';
import { buildRecord, fmtBytes } from '../indexer.js';
import { EMPTY_QUERY, filterWorklist, modalityFacets } from '../search.js';
import { renderThumbnail } from '../thumbnail.js';
import { DEFAULT_PROFILE, type StudyRecord } from '../types.js';
import { mulberry32 } from './rng.js';

function row(key: string, modality = 'CT', extra: Partial<StudyRecord> = {}): StudyRecord {
  return {
    key, patientName: 'DOE^JOHN', patientID: 'P1', studyUID: '1.2.3',
    modality, seriesDescription: 'Routine', studyDate: '20240101',
    source: 'nifti', files: ['a.nii'], hasSeg: false,
    dims: null, spacing: null, voxels: null, bytes: null, anonymized: false, ...extra,
  };
}

const QUERIES = [
  '', 'ct', 'CT', 'mr', 'doe', 'p1', 'routine', 'brats liver', 'ct mr', 'zzz-no-match',
  '1.2.3', 'BRATS-FLAIR-SEG', 'seg', 'nifti', 'liver-ct', '  ct  ',
];

const ROWS = [
  row('brats-flair-seg', 'MR', { hasSeg: true, source: 'nifti' }),
  row('liver-ct-seg', 'CT', { hasSeg: true }),
  row('lung-ct-dicom', 'CT', { source: 'dicom', patientName: 'TCGA-17-Z043', patientID: 'TCGA-17-Z043' }),
  row('cardiac-frame01', 'MR', { source: 'upload' }),
];

const EXPECTED_KEYS: Record<string, string[]> = {
  '': ['brats-flair-seg', 'cardiac-frame01', 'liver-ct-seg', 'lung-ct-dicom'],
  'ct': ['liver-ct-seg', 'lung-ct-dicom'],
  'CT': ['liver-ct-seg', 'lung-ct-dicom'],
  'mr': ['brats-flair-seg', 'cardiac-frame01'],
  'doe': ['brats-flair-seg', 'cardiac-frame01', 'liver-ct-seg'],
  'p1': ['brats-flair-seg', 'cardiac-frame01', 'liver-ct-seg'],
  'routine': ['brats-flair-seg', 'cardiac-frame01', 'liver-ct-seg', 'lung-ct-dicom'],
  'brats liver': [],
  'ct mr': [],
  'zzz-no-match': [],
  '1.2.3': ['brats-flair-seg', 'cardiac-frame01', 'liver-ct-seg', 'lung-ct-dicom'],
  'BRATS-FLAIR-SEG': ['brats-flair-seg'],
  'seg': ['brats-flair-seg', 'liver-ct-seg'],
  'nifti': [],
  'liver-ct': ['liver-ct-seg'],
  '  ct  ': ['liver-ct-seg', 'lung-ct-dicom'],
};

describe('search matrix', () => {
  it('16 queries return exact key sets (case/trim/AND semantics)', () => {
    assert.equal(QUERIES.length, 16);
    for (const q of QUERIES) {
      const out = filterWorklist(ROWS, { ...EMPTY_QUERY, text: q }).map((r) => r.key);
      assert.deepEqual(out, EXPECTED_KEYS[q], JSON.stringify(q));
    }
  });
  it('source x seg facets filter exactly', () => {
    for (const src of ['all', 'nifti', 'dicom', 'upload'] as const) {
      for (const seg of [null, true, false] as const) {
        const out = filterWorklist(ROWS, { ...EMPTY_QUERY, source: src, hasSeg: seg });
        assert.ok(out.every((r) => (src === 'all' || r.source === src) && (seg === null || r.hasSeg === seg)), `${src}/${seg}`);
        const expect = ROWS.filter((r) => (src === 'all' || r.source === src) && (seg === null || r.hasSeg === seg)).length;
        assert.equal(out.length, expect, `${src}/${seg} count`);
      }
    }
  });
  it('sorts order fully (not just stable length)', () => {
    const shame = ROWS.map((r, i) => ({ ...r, voxels: (i + 1) * 100 }));
    for (const sort of ['name', 'modality', 'voxels'] as const) {
      for (const dir of ['asc', 'desc'] as const) {
        const out = filterWorklist(shame, { ...EMPTY_QUERY, sort, dir });
        const keys = out.map((r) => r.key);
        const keyOf = (r: StudyRecord): string | number =>
          sort === 'voxels' ? r.voxels ?? -1 : sort === 'modality' ? `${r.modality}/${r.key}` : r.key;
        const sorted = [...out].sort((a, b) => {
          const ka = keyOf(a), kb = keyOf(b);
          return (ka < kb ? -1 : ka > kb ? 1 : 0) * (dir === 'asc' ? 1 : -1);
        }).map((r) => r.key);
        assert.deepEqual(keys, sorted, `${sort} ${dir}`);
      }
    }
  });
  it('facets + buildRecord kinds', () => {
    assert.deepEqual(modalityFacets(ROWS).find((f) => f.modality === 'CT'), { modality: 'CT', count: 2 });
    assert.equal(buildRecord('x', { dicom: ['a.dcm'] }).source, 'dicom');
    assert.equal(buildRecord('y', {}).files.length, 0);
  });
});

describe('study formatting + privacy matrix', () => {
  it('fmtBytes exact table', () => {
    assert.deepEqual([
      [null, '—'], [0, '0 B'], [512, '512 B'], [1023, '1023 B'],
      [1024, '1.0 KB'], [2048, '2.0 KB'], [1048576, '1.0 MB'], [3145728, '3.0 MB'],
    ].map(([n, want]) => fmtBytes(n as number | null)), ['—', '0 B', '512 B', '1023 B', '1.0 KB', '2.0 KB', '1.0 MB', '3.0 MB']);
    const rng = mulberry32(11);
    for (let t = 0; t < 12; t++) {
      const n = Math.floor(rng() * 1e9);
      assert.ok(/B$|KB$|MB$/.test(fmtBytes(n)), `case ${t}: ${n}`);
    }
  });
  it('anonymize deterministic, flagged, unlinking (30 rows)', () => {
    for (let t = 0; t < 30; t++) {
      const r = row(`k${t}`, t % 2 ? 'CT' : 'MR', { patientName: `N${t}`, studyUID: `9.${t}` });
      const a = anonymizeRecord(r, DEFAULT_PROFILE);
      const b = anonymizeRecord(r, DEFAULT_PROFILE);
      assert.equal(a.studyUID, b.studyUID, `case ${t}`);
      assert.equal(a.anonymized, true, `case ${t}`);
      assert.notEqual(a.patientName, r.patientName, `case ${t}`);
      assert.notEqual(a.studyUID, r.studyUID, `case ${t}`);
    }
  });
});

describe('thumbnail sizes', () => {
  it('25 volumes bound correctly at 5 sizes', () => {
    const rng = mulberry32(12);
    for (const size of [24, 32, 64, 96, 160]) {
      for (let t = 0; t < 5; t++) {
        const nx = 8 + (t % 5), ny = 9, nz = 6;
        const data = new Float64Array(nx * ny * nz);
        for (let i = 0; i < data.length; i++) data[i] = rng() * 500;
        const th = renderThumbnail({ dims: [nx, ny, nz], data }, { center: 250, width: 500 }, size);
        assert.ok(th.w <= size && th.h <= size, `${size}px case ${t}`);
        assert.equal(th.rgba.length, th.w * th.h * 4, `${size}px case ${t}`);
      }
    }
  });
  it('uniform volume renders a uniform thumb', () => {
    const th = renderThumbnail({ dims: [8, 8, 8], data: new Float64Array(512).fill(300) }, { center: 250, width: 500 }, 32);
    const [r0, g0, b0] = [th.rgba[0], th.rgba[1], th.rgba[2]];
    for (let i = 0; i < th.rgba.length; i += 4) {
      assert.equal(th.rgba[i], r0);
      assert.equal(th.rgba[i + 1], g0);
      assert.equal(th.rgba[i + 2], b0);
      assert.equal(th.rgba[i + 3], 255);
    }
  });
});
