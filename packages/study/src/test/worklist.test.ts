import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord, enrichRecord, fmtBytes } from '../indexer.js';
import { EMPTY_QUERY, filterWorklist, matchesText, modalityFacets } from '../search.js';
import type { StudyRecord } from '../types.js';

function row(key: string, modality = 'CT', extra: Partial<StudyRecord> = {}): StudyRecord {
  return {
    key, patientName: 'DOE^JOHN', patientID: 'P1', studyUID: '1.2.3',
    modality, seriesDescription: null, studyDate: '20240101',
    source: 'nifti', files: [], hasSeg: false,
    dims: null, spacing: null, voxels: null, bytes: null, anonymized: false, ...extra,
  };
}

describe('study indexer', () => {
  it('builds records with modality guesses', () => {
    const r = buildRecord('brats-flair-seg', { img: ['a.nii'], seg: ['b.nii'] });
    assert.equal(r.modality, 'MR');
    assert.equal(r.hasSeg, true);
    assert.equal(r.source, 'nifti');
    const d = buildRecord('lung-ct-dicom', { dicom: ['x.dcm'] });
    assert.equal(d.modality, 'CT');
    assert.equal(d.source, 'dicom');
  });
  it('enrich fills geometry and identity', () => {
    const r = enrichRecord(row('k'), { dims: [4, 4, 4], spacing: [1, 2, 3] });
    assert.deepEqual(r.dims, [4, 4, 4]);
    assert.equal(r.voxels, 64);
    assert.deepEqual(r.spacing, [1, 2, 3]);
  });
  it('fmtBytes humanizes', () => {
    assert.equal(fmtBytes(null), '—');
    assert.equal(fmtBytes(512), '512 B');
    assert.equal(fmtBytes(2048), '2.0 KB');
    assert.equal(fmtBytes(3 * 1024 * 1024), '3.0 MB');
  });
});

describe('worklist search', () => {
  const rows = [row('brats-flair-seg', 'MR'), row('liver-ct-seg', 'CT'), row('lung-ct-dicom', 'CT')];
  it('multi-token AND matching', () => {
    assert.ok(matchesText(rows[0]!, 'brats MR'));
    assert.ok(!matchesText(rows[0]!, 'brats CT'));
    assert.ok(matchesText(rows[2]!, 'lung xyzzy') === false); // absent token fails AND
    assert.ok(matchesText(rows[2]!, ''));
  });
  it('filters by modality/source/seg and sorts', () => {
    const f = filterWorklist(rows, { ...EMPTY_QUERY, modalities: new Set(['CT']) });
    assert.deepEqual(f.map((r) => r.key), ['liver-ct-seg', 'lung-ct-dicom']);
    const s = filterWorklist(rows, { ...EMPTY_QUERY, sort: 'modality', dir: 'desc' });
    assert.equal(s[0]!.modality, 'MR');
  });
  it('facets count modalities', () => {
    assert.deepEqual(modalityFacets(rows), [
      { modality: 'CT', count: 2 },
      { modality: 'MR', count: 1 },
    ]);
  });
});
