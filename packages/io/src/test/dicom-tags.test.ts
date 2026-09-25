import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readDataset } from '../dcm-read.js';
import {
  fileMetaToSummary, fmtDicomDate, fmtDicomTime, summarizeDataset,
  type DicomTagSummary,
} from '../dicom-tags.js';
import { sopClassName } from '../sop-names.js';
import { writePart10, type DcmElement } from '../dcm-write.js';
import type { DicomFileMeta } from '../dicom-parse.js';

const CT_UID = '1.2.840.10008.5.1.4.1.1.2';

function ctDataset(): ArrayBuffer {
  const els: DcmElement[] = [
    { tag: [0x0008, 0x0016], vr: 'UI', value: CT_UID },
    { tag: [0x0008, 0x0060], vr: 'CS', value: 'CT' },
    { tag: [0x0008, 0x0020], vr: 'DA', value: '20260914' },
    { tag: [0x0008, 0x0030], vr: 'TM', value: '093015' },
    { tag: [0x0008, 0x0070], vr: 'LO', value: 'ACME' },
    { tag: [0x0008, 0x0080], vr: 'LO', value: 'General Hospital' },
    { tag: [0x0008, 0x1090], vr: 'LO', value: 'Scanner 1' },
    { tag: [0x0010, 0x0010], vr: 'PN', value: 'DOE^JOHN' },
    { tag: [0x0010, 0x0020], vr: 'LO', value: 'P123' },
    { tag: [0x0020, 0x000d], vr: 'UI', value: '1.2.3.4' },
    { tag: [0x0020, 0x000e], vr: 'UI', value: '1.2.3.4.5' },
    { tag: [0x0020, 0x0011], vr: 'IS', value: 3 },
    { tag: [0x0008, 0x103e], vr: 'LO', value: 'Axial lung' },
    { tag: [0x0028, 0x0010], vr: 'US', value: 512 },
    { tag: [0x0028, 0x0011], vr: 'US', value: 512 },
    { tag: [0x0028, 0x0101], vr: 'US', value: 12 },
    { tag: [0x0028, 0x0030], vr: 'DS', value: ['0.5', '0.5'] },
    { tag: [0x0018, 0x0050], vr: 'DS', value: 1.5 },
    { tag: [0x0020, 0x0037], vr: 'DS', value: ['1', '0', '0', '0', '1', '0'] },
    { tag: [0x0028, 0x1050], vr: 'DS', value: 40 },
    { tag: [0x0028, 0x1051], vr: 'DS', value: 400 },
  ];
  return writePart10(CT_UID, '1.2.3.4.5.6', els);
}

describe('dicom tag summary', () => {
  it('summarizeDataset reads identity + acquisition + geometry', () => {
    const s = summarizeDataset(readDataset(ctDataset()));
    assert.equal(s.sopClassUID, CT_UID);
    assert.equal(sopClassName(s.sopClassUID), 'CT Image');
    assert.equal(s.modality, 'CT');
    assert.equal(s.patientName, 'DOE^JOHN');
    assert.equal(s.patientID, 'P123');
    assert.equal(s.studyDate, '2026-09-14');
    assert.equal(s.studyTime, '09:30:15');
    assert.equal(s.manufacturer, 'ACME');
    assert.equal(s.model, 'Scanner 1');
    assert.equal(s.institution, 'General Hospital');
    assert.equal(s.studyUID, '1.2.3.4');
    assert.equal(s.seriesUID, '1.2.3.4.5');
    assert.equal(s.seriesNumber, 3);
    assert.equal(s.seriesDescription, 'Axial lung');
    assert.deepEqual([s.rows, s.cols, s.bitsStored], [512, 512, 12]);
    assert.deepEqual(s.pixelSpacing, [0.5, 0.5]);
    assert.equal(s.sliceThickness, 1.5);
    assert.deepEqual(s.iop, [1, 0, 0, 0, 1, 0]);
    assert.deepEqual([s.windowCenter, s.windowWidth], [40, 400]);
  });
  it('absent tags stay null with sane defaults (frames=1, slope=1, intercept=0)', () => {
    const s = summarizeDataset(readDataset(writePart10(CT_UID, '1.9', [])));
    assert.equal(s.modality, null);
    assert.equal(s.frames, 1);
    assert.equal(s.slope, 1);
    assert.equal(s.intercept, 0);
    assert.equal(s.iop, null);
    assert.equal(sopClassName('9.9.9'), 'Unknown SOP Class');
    assert.equal(sopClassName(null), 'Unknown SOP Class');
  });
  it('date/time formatters pass garbage through', () => {
    assert.equal(fmtDicomDate('2026-1-4'), '2026-1-4');
    assert.equal(fmtDicomDate(null), null);
    assert.equal(fmtDicomTime('0930'), '0930');
    assert.equal(fmtDicomTime(null), null);
  });
  it('fileMetaToSummary adapts the pixel-pipeline meta to the same model', () => {
    const meta: DicomFileMeta = {
      transferSyntaxUID: '1.2.840.10008.1.2.1', rows: 256, cols: 256,
      bitsAllocated: 16, bitsStored: 12, pixelRepresentation: 1, samplesPerPixel: 1,
      numberOfFrames: 1, photometric: 'MONOCHROME2', slope: 1, intercept: -1024,
      windowCenter: 40, windowWidth: 400, instanceNumber: 2, sliceLocation: -10,
      seriesUID: '1.2.9', sopClassUID: CT_UID, ipp: [0, 0, -10], iop: [1, 0, 0, 0, 1, 0],
      pixelSpacing: [0.7, 0.7], sliceThickness: 2, patientName: 'X', patientID: 'Y',
      studyUID: '1.2.8', seriesNumber: 5, modality: 'CT', studyDate: '20250102',
      seriesDescription: 'Head',
      frameTimeMs: null, cineFps: null,
      imagerPixelSpacing: null, spacingBetweenSlices: null,
      laterality: null, imageLaterality: null, viewPosition: null,
    };
    const s: DicomTagSummary = fileMetaToSummary(meta, meta.sopClassUID);
    assert.equal(sopClassName(s.sopClassUID), 'CT Image');
    assert.equal(s.studyTime, null);
    assert.equal(s.manufacturer, null);
    assert.deepEqual([s.rows, s.cols, s.frames], [256, 256, 1]);
    assert.equal(s.intercept, -1024);
    assert.deepEqual(s.iop, [1, 0, 0, 0, 1, 0]);
    assert.equal(s.studyDate, '2025-01-02');
  });
});
