import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { anonymizeMeta, anonymizeRecord, scrubNiftiDescrip } from '../anonymize.js';
import { renderThumbnail } from '../thumbnail.js';
import { DEFAULT_PROFILE } from '../types.js';
import type { DicomFileMeta } from '@carys/io';

function meta(): DicomFileMeta {
  return {
    transferSyntaxUID: '1.2.840.10008.1.2.1', rows: 4, cols: 4,
    bitsAllocated: 16, bitsStored: 12, pixelRepresentation: 0, samplesPerPixel: 1,
    numberOfFrames: 1, photometric: 'MONOCHROME2', slope: 1, intercept: 0,
    windowCenter: null, windowWidth: null, instanceNumber: 1, sliceLocation: 0,
    seriesUID: '1.2.3.4', sopClassUID: '1.2.840.10008.5.1.4.1.1.2', ipp: null, iop: null, pixelSpacing: [1, 1], sliceThickness: 1,
    patientName: 'DOE^JOHN', patientID: 'P123', studyUID: '9.9.9',
    seriesNumber: 2, modality: 'CT', studyDate: '20240101', seriesDescription: ' Chest ',
    frameTimeMs: null, cineFps: null,
    imagerPixelSpacing: null, spacingBetweenSlices: null,
    laterality: null, imageLaterality: null, viewPosition: null,
  };
}

describe('anonymize', () => {
  it('replaces identity, re-roots UIDs, drops dates', () => {
    const a = anonymizeMeta(meta(), DEFAULT_PROFILE);
    assert.equal(a.patientName, 'ANONYMIZED');
    assert.equal(a.patientID, 'ANON');
    assert.equal(a.studyDate, null);
    assert.notEqual(a.studyUID, '9.9.9');
    assert.ok(a.studyUID!.startsWith('1.2.826.0.1.999999.'));
    assert.equal(a.modality, 'CT'); // clinical tags preserved
    // deterministic: same input -> same UID
    assert.equal(anonymizeMeta(meta(), DEFAULT_PROFILE).studyUID, a.studyUID);
  });
  it('keeps dates when the profile says so', () => {
    const a = anonymizeMeta(meta(), { ...DEFAULT_PROFILE, keepDates: true });
    assert.equal(a.studyDate, '20240101');
  });
  it('anonymizeRecord flags the row', () => {
    const r = anonymizeRecord({
      key: 'k', patientName: 'X', patientID: 'Y', studyUID: '1.1',
      modality: 'MR', seriesDescription: null, studyDate: '2020',
      source: 'dicom', files: [], hasSeg: false,
      dims: null, spacing: null, voxels: null, bytes: null, anonymized: false,
    }, DEFAULT_PROFILE);
    assert.equal(r.anonymized, true);
    assert.equal(r.patientName, 'ANONYMIZED');
  });
  it('scrubNiftiDescrip zeroes bytes 148..227', () => {
    const buf = new ArrayBuffer(400);
    new Uint8Array(buf, 148, 80).fill(65);
    const out = scrubNiftiDescrip(buf);
    assert.ok(new Uint8Array(out, 148, 80).every((v) => v === 0));
    assert.throws(() => scrubNiftiDescrip(new ArrayBuffer(100)), /too small/);
  });
});

describe('thumbnail', () => {
  it('downsamples the middle axial slice', () => {
    const n = 8 * 8 * 8;
    const data = new Float64Array(n);
    for (let i = 0; i < n; i++) data[i] = i;
    const t = renderThumbnail({ dims: [8, 8, 8], data }, { center: n / 2, width: n }, 4);
    assert.equal(t.w, 4);
    assert.equal(t.h, 4);
    assert.equal(t.rgba.length, 4 * 4 * 4);
    assert.ok(t.rgba.some((v) => v > 0)); // ramp survives windowing
  });
});
