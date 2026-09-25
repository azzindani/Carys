import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writePart10 } from '../dcm-write.js';
import { parseDicomFrames } from '../dicom-parse.js';
import { fileMetaToSummary, summarizeDataset } from '../dicom-tags.js';
import { sopClassName } from '../sop-names.js';
import { readDataset } from '../dcm-read.js';
import {
  BTO_SOP_CLASS, BREAST_PROJ_PRESENTATION_SOP_CLASS, BREAST_PROJ_PROCESSING_SOP_CLASS,
  isTomoSopClass, stackPixelSpacing, stackZGap,
} from '../tomo.js';

const MG = 'MG';

/** BTO file: 3 MONOCHROME2 frames, imager spacing only, slice interval. */
function btoFile(): ArrayBuffer {
  const px = new Uint8Array(4 * 4 * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 13) & 0xff;
  return writePart10(BTO_SOP_CLASS, '1.2.9.1', [
    { tag: [0x0008, 0x0016], vr: 'UI', value: BTO_SOP_CLASS },
    { tag: [0x0008, 0x0060], vr: 'CS', value: MG },
    { tag: [0x0028, 0x0010], vr: 'US', value: 4 },
    { tag: [0x0028, 0x0011], vr: 'US', value: 4 },
    { tag: [0x0028, 0x0100], vr: 'US', value: 8 },
    { tag: [0x0028, 0x0101], vr: 'US', value: 8 },
    { tag: [0x0028, 0x0103], vr: 'US', value: 0 },
    { tag: [0x0028, 0x0002], vr: 'US', value: 1 },
    { tag: [0x0028, 0x0004], vr: 'CS', value: 'MONOCHROME2' },
    { tag: [0x0028, 0x0008], vr: 'IS', value: 3 },
    // no (0028,0030) Pixel Spacing: imager spacing is the fallback
    { tag: [0x0018, 0x1164], vr: 'DS', value: ['0.07', '0.07'] },
    { tag: [0x0018, 0x0088], vr: 'DS', value: '1.0' },
    { tag: [0x0018, 0x0050], vr: 'DS', value: '1.0' },
    { tag: [0x0020, 0x0060], vr: 'CS', value: 'L' },
    { tag: [0x0020, 0x0062], vr: 'CS', value: 'L' },
    { tag: [0x0018, 0x5101], vr: 'CS', value: 'CC' },
    { tag: [0x0018, 0x1495], vr: 'IS', value: 15 },
    { tag: [0x7fe0, 0x0010], vr: 'OB', value: px },
  ]);
}

describe('tomo', () => {
  it('SOP gate covers BTO + both breast-projection classes', () => {
    assert.ok(isTomoSopClass(BTO_SOP_CLASS));
    assert.ok(isTomoSopClass(BREAST_PROJ_PRESENTATION_SOP_CLASS));
    assert.ok(isTomoSopClass(BREAST_PROJ_PROCESSING_SOP_CLASS));
    assert.ok(!isTomoSopClass('1.2.840.10008.5.1.4.1.1.2'));
    assert.ok(!isTomoSopClass(null));
    assert.equal(sopClassName(BTO_SOP_CLASS), 'Breast Tomosynthesis');
  });
  it('spacing prefers pixel spacing, falls back to imager, nulls junk', () => {
    assert.deepEqual(
      stackPixelSpacing({ pixelSpacing: [0.1, 0.1], imagerPixelSpacing: [0.07, 0.07] }),
      [0.1, 0.1],
    );
    assert.deepEqual(
      stackPixelSpacing({ pixelSpacing: null, imagerPixelSpacing: [0.07, 0.07] }),
      [0.07, 0.07],
    );
    assert.equal(stackPixelSpacing({ pixelSpacing: null, imagerPixelSpacing: null }), null);
    // half pairs + zeros never leak through
    assert.equal(stackPixelSpacing({ pixelSpacing: [0, 0.1], imagerPixelSpacing: null }), null);
    assert.equal(stackPixelSpacing({ pixelSpacing: null, imagerPixelSpacing: [0.07, 0] }), null);
  });
  it('z gap prefers slice interval, then thickness, then 1 mm', () => {
    assert.equal(stackZGap({ sliceThickness: 2, spacingBetweenSlices: 1 }), 1);
    assert.equal(stackZGap({ sliceThickness: 2, spacingBetweenSlices: null }), 2);
    assert.equal(stackZGap({ sliceThickness: null, spacingBetweenSlices: null }), 1);
    assert.equal(stackZGap({ sliceThickness: 0, spacingBetweenSlices: -1 }), 1);
    assert.equal(stackZGap({ sliceThickness: NaN, spacingBetweenSlices: null }), 1);
  });
  it('BTO multiframe decodes to slices + laterality/view on the meta', () => {
    const parts = parseDicomFrames(btoFile());
    assert.equal(parts.length, 3);
    assert.equal(parts[0]!.slice.frameIndex, 0);
    assert.deepEqual([...parts[2]!.slice.pixelData.subarray(0, 4)], [160, 173, 186, 199]);
    const m = parts[0]!.meta;
    assert.equal(m.numberOfFrames, 3);
    assert.equal(m.pixelSpacing, null);
    assert.deepEqual(m.imagerPixelSpacing, [0.07, 0.07]);
    assert.equal(m.spacingBetweenSlices, 1);
    assert.equal(m.laterality, 'L');
    assert.equal(m.imageLaterality, 'L');
    assert.equal(m.viewPosition, 'CC');
  });
  it('summary carries tomo geometry + context on both sources', () => {
    const viaDataset = summarizeDataset(readDataset(btoFile()));
    assert.deepEqual(viaDataset.tomoSpacingMm, [0.07, 0.07]);
    assert.equal(viaDataset.tomoZGapMm, 1);
    assert.equal(viaDataset.laterality, 'L');
    assert.equal(viaDataset.imageLaterality, 'L');
    assert.equal(viaDataset.viewPosition, 'CC');
    const meta = parseDicomFrames(btoFile())[0]!.meta;
    const viaMeta = fileMetaToSummary(meta, meta.sopClassUID);
    assert.deepEqual(viaMeta.tomoSpacingMm, [0.07, 0.07]);
    assert.equal(viaMeta.tomoZGapMm, 1);
    assert.equal(viaMeta.laterality, 'L');
    assert.equal(viaMeta.viewPosition, 'CC');
  });
  it('hostile stacks fail loud, never guess geometry', () => {
    // zero frames-worth of pixels: pixel data short
    assert.throws(
      () => parseDicomFrames(writePart10(BTO_SOP_CLASS, '1.2.9.2', [
        { tag: [0x0008, 0x0016], vr: 'UI', value: BTO_SOP_CLASS },
        { tag: [0x0028, 0x0010], vr: 'US', value: 4 },
        { tag: [0x0028, 0x0011], vr: 'US', value: 4 },
        { tag: [0x0028, 0x0100], vr: 'US', value: 8 },
        { tag: [0x0028, 0x0101], vr: 'US', value: 8 },
        { tag: [0x0028, 0x0103], vr: 'US', value: 0 },
        { tag: [0x0028, 0x0002], vr: 'US', value: 1 },
        { tag: [0x0028, 0x0004], vr: 'CS', value: 'MONOCHROME2' },
        { tag: [0x0028, 0x0008], vr: 'IS', value: 2 },
        { tag: [0x7fe0, 0x0010], vr: 'OB', value: new Uint8Array(16) },
      ])),
      /pixel data short/,
    );
  });
});
