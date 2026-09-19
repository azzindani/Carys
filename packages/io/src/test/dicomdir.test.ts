import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writePart10, type DcmElement } from '../dcm-write.js';
import {
  DICOMDIR_SOP_CLASS, parseDicomDir, resolveDicomDirFiles,
} from '../dicomdir.js';

// Hand-rolled DICOMDIR: STUDY → 2 SERIES (CT 3 imgs, MR 1 img) via the
// repo's own Part-10 writer (explicit VR LE, defined lengths — exactly
// what parseDicomDir consumes through readDataset).
function record(type: string, els: DcmElement[]): { elements: DcmElement[] } {
  return { elements: [{ tag: [0x0004, 0x1430], vr: 'CS', value: type }, ...els] };
}

function dirBuffer(): ArrayBuffer {
  const seq = [
    record('PATIENT', [{ tag: [0x0010, 0x0010], vr: 'PN', value: 'DOE^J' }]),
    record('STUDY', [
      { tag: [0x0020, 0x000d], vr: 'UI', value: '1.2.3' },
      { tag: [0x0008, 0x0020], vr: 'DA', value: '20240101' },
      { tag: [0x0008, 0x1030], vr: 'LO', value: 'Chest' },
    ]),
    record('SERIES', [
      { tag: [0x0008, 0x0060], vr: 'CS', value: 'CT' },
      { tag: [0x0020, 0x0011], vr: 'IS', value: 1 },
      { tag: [0x0020, 0x000e], vr: 'UI', value: '1.2.3.1' },
    ]),
    record('IMAGE', [
      { tag: [0x0004, 0x1500], vr: 'CS', value: ['CT1', 'IM1'] },
      { tag: [0x0020, 0x0013], vr: 'IS', value: 1 },
    ]),
    record('IMAGE', [
      { tag: [0x0004, 0x1500], vr: 'CS', value: ['CT1', 'IM2'] },
      { tag: [0x0020, 0x0013], vr: 'IS', value: 2 },
    ]),
    record('IMAGE', [
      { tag: [0x0004, 0x1500], vr: 'CS', value: ['CT1', 'IM3'] },
      { tag: [0x0020, 0x0013], vr: 'IS', value: 3 },
    ]),
    record('OVERLAY', []), // unknown types skip, never fail
    record('SERIES', [
      { tag: [0x0008, 0x0060], vr: 'CS', value: 'MR' },
      { tag: [0x0020, 0x0011], vr: 'IS', value: 2 },
      { tag: [0x0020, 0x000e], vr: 'UI', value: '1.2.3.2' },
    ]),
    record('IMAGE', [
      { tag: [0x0004, 0x1500], vr: 'CS', value: ['MR1', 'IM1'] },
      { tag: [0x0020, 0x0013], vr: 'IS', value: 1 },
    ]),
    record('IMAGE', [{ tag: [0x0020, 0x0013], vr: 'IS', value: 9 }]), // no file id: skipped
  ];
  return writePart10(DICOMDIR_SOP_CLASS, '1.2.3.0', [
    { tag: [0x0008, 0x0016], vr: 'UI', value: DICOMDIR_SOP_CLASS },
    { tag: [0x0004, 0x1220], vr: 'SQ', value: seq },
  ]);
}

describe('dicomdir', () => {
  it('parses the study/series/image tree, skips unknowns + dangling refs', () => {
    const dir = parseDicomDir(dirBuffer());
    assert.equal(dir.studies.length, 1);
    assert.equal(dir.studies[0]!.studyUID, '1.2.3');
    assert.equal(dir.studies[0]!.studyDescription, 'Chest');
    assert.equal(dir.studies[0]!.series.length, 2);
    const [ct, mr] = dir.studies[0]!.series;
    assert.equal(ct!.modality, 'CT');
    assert.equal(ct!.seriesNumber, 1);
    assert.deepEqual(ct!.images.map((i) => i.fileId), ['CT1/IM1', 'CT1/IM2', 'CT1/IM3']);
    assert.deepEqual(ct!.images.map((i) => i.instanceNumber), [1, 2, 3]);
    assert.equal(mr!.images.length, 1); // the file-id-less IMAGE skipped
    assert.equal(dir.imageCount, 4);
  });
  it('resolves file ids against selected files, names the missing', () => {
    const dir = parseDicomDir(dirBuffer());
    const ct = dir.studies[0]!.series[0]!;
    const files = [{ name: 'IM1' }, { name: 'IM3' }, { name: 'other.dcm' }];
    const { matched, missing } = resolveDicomDirFiles(ct, files);
    assert.deepEqual(matched.map((f) => f.name), ['IM1', 'IM3']);
    assert.deepEqual(missing, ['CT1/IM2']);
    // case-insensitive leaf match (DICOMDIR is uppercase by convention)
    const { missing: none } = resolveDicomDirFiles(ct, [{ name: 'im1' }, { name: 'im2' }, { name: 'im3' }]);
    assert.deepEqual(none, []);
  });
  it('hostile input fails loud with named errors', () => {
    assert.throws(() => parseDicomDir(writePart10('1.2.3.4', '1.2.3.5', [])), /dcmdata-not-dir/);
    assert.throws(
      () => parseDicomDir(writePart10(DICOMDIR_SOP_CLASS, '1.2.3.0', [
        { tag: [0x0008, 0x0016], vr: 'UI', value: DICOMDIR_SOP_CLASS },
      ])),
      /dcmdata-no-records/,
    );
  });
});
