import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writePart10, type DcmElement } from '../dcm-write.js';
import { readDataset } from '../dcm-read.js';
import { summarizeDataset } from '../dicom-tags.js';
import {
  clipWsiRect, ENCAPSULATED_CDA_SOP_CLASS, ENCAPSULATED_PDF_SOP_CLASS,
  encapsulatedDocLabel, isEncapsulatedSopClass, isVlSopClass,
  parseEncapsulatedDoc, parseVlGrid, validateWsiAnnotation,
  validateWsiAnnotations, vlGridLabel, wsiAnnotationLabel,
  VL_MICROSCOPIC_SOP_CLASS, VL_SLIDE_COORD_SOP_CLASS,
} from '../wsi.js';

const item = (els: DcmElement[]): { elements: DcmElement[] } => ({ elements: els });

/** VL file: matrix + origin + 6 tile offsets + focus + 2 optical paths. */
function vlFile(): ArrayBuffer {
  const px = new Uint8Array(64 * 48);
  for (let i = 0; i < px.length; i++) px[i] = (i * 7) & 0xff;
  return writePart10(VL_MICROSCOPIC_SOP_CLASS, '1.2.9.1', [
    { tag: [0x0008, 0x0016], vr: 'UI', value: VL_MICROSCOPIC_SOP_CLASS },
    { tag: [0x0008, 0x0060], vr: 'CS', value: 'SM' },
    { tag: [0x0028, 0x0010], vr: 'US', value: 48 },
    { tag: [0x0028, 0x0011], vr: 'US', value: 64 },
    { tag: [0x0028, 0x0100], vr: 'US', value: 8 },
    { tag: [0x0028, 0x0101], vr: 'US', value: 8 },
    { tag: [0x0028, 0x0103], vr: 'US', value: 0 },
    { tag: [0x0028, 0x0002], vr: 'US', value: 1 },
    { tag: [0x0028, 0x0004], vr: 'CS', value: 'MONOCHROME2' },
    { tag: [0x0048, 0x0006], vr: 'UL', value: 192 },
    { tag: [0x0048, 0x0007], vr: 'UL', value: 96 },
    {
      tag: [0x0048, 0x0008], vr: 'SQ', value: [item([
        { tag: [0x0048, 0x021e], vr: 'SL', value: 0 },
        { tag: [0x0048, 0x021f], vr: 'SL', value: 0 },
      ])],
    },
    {
      tag: [0x0048, 0x021a], vr: 'SQ', value: [0, 1, 2, 3, 4, 5].map((k) => item([
        { tag: [0x0048, 0x021e], vr: 'SL', value: Math.floor(k / 3) * 48 },
        { tag: [0x0048, 0x021f], vr: 'SL', value: (k % 3) * 64 },
      ])),
    },
    { tag: [0x0048, 0x0013], vr: 'US', value: 1 },
    {
      tag: [0x0048, 0x0105], vr: 'SQ', value: [item([
        { tag: [0x0048, 0x0106], vr: 'SH', value: '1' },
      ]), item([
        { tag: [0x0048, 0x0106], vr: 'SH', value: '2' },
      ])],
    },
    { tag: [0x7fe0, 0x0010], vr: 'OB', value: px },
  ]);
}

/** Encapsulated PDF: title + MIME + 256 payload bytes. */
function pdfFile(): ArrayBuffer {
  const pdf = new Uint8Array(256);
  pdf.set([0x25, 0x50, 0x44, 0x46], 0); // %PDF
  return writePart10(ENCAPSULATED_PDF_SOP_CLASS, '1.2.9.2', [
    { tag: [0x0008, 0x0016], vr: 'UI', value: ENCAPSULATED_PDF_SOP_CLASS },
    { tag: [0x0008, 0x0060], vr: 'CS', value: 'DOC' },
    { tag: [0x0042, 0x0010], vr: 'ST', value: 'Pathology report' },
    { tag: [0x0042, 0x0012], vr: 'LO', value: 'application/pdf' },
    { tag: [0x0042, 0x0011], vr: 'OB', value: pdf },
  ]);
}

describe('wsi + encapsulated', () => {
  it('SOP gates accept VL slide + PDF/CDA, reject everything else', () => {
    assert.ok(isVlSopClass(VL_MICROSCOPIC_SOP_CLASS));
    assert.ok(isVlSopClass(VL_SLIDE_COORD_SOP_CLASS));
    assert.ok(!isVlSopClass(ENCAPSULATED_PDF_SOP_CLASS));
    assert.ok(!isVlSopClass(null));
    assert.ok(isEncapsulatedSopClass(ENCAPSULATED_PDF_SOP_CLASS));
    assert.ok(isEncapsulatedSopClass(ENCAPSULATED_CDA_SOP_CLASS));
    assert.ok(!isEncapsulatedSopClass(VL_MICROSCOPIC_SOP_CLASS));
    assert.ok(!isEncapsulatedSopClass(null));
    assert.throws(() => parseVlGrid(readDataset(pdfFile())), /not a VL whole-slide/);
    assert.throws(() => parseEncapsulatedDoc(readDataset(vlFile())), /not an encapsulated document/);
  });
  it('tile grid reads matrix + origin + offsets + focus + paths', () => {
    const grid = parseVlGrid(readDataset(vlFile()));
    assert.equal(grid.totalCols, 192);
    assert.equal(grid.totalRows, 96);
    assert.equal(grid.originX, 0);
    assert.equal(grid.originY, 0);
    assert.deepEqual(grid.tileOffsets, [[0, 0], [0, 64], [0, 128], [48, 0], [48, 64], [48, 128]]);
    assert.equal(grid.focusPlanes, 1);
    assert.equal(grid.opticalPaths, 2);
    assert.equal(vlGridLabel(grid), '192×96 total · 6 located');
  });
  it('document summary reads title + MIME + length, never bytes', () => {
    const doc = parseEncapsulatedDoc(readDataset(pdfFile()));
    assert.equal(doc.title, 'Pathology report');
    assert.equal(doc.mimeType, 'application/pdf');
    assert.equal(doc.byteLength, 256);
    assert.equal(
      encapsulatedDocLabel(doc, ENCAPSULATED_PDF_SOP_CLASS),
      'PDF · Pathology report · 256 bytes · application/pdf',
    );
    assert.equal(
      encapsulatedDocLabel({ title: null, mimeType: null, byteLength: 0 }, ENCAPSULATED_CDA_SOP_CLASS),
      'CDA · 0 bytes',
    );
  });
  it('summary carries VL grid + document rows', () => {
    const vl = summarizeDataset(readDataset(vlFile()));
    assert.equal(vl.vlTiles, '192×96 total · 6 located');
    assert.equal(vl.vlFocusPlanes, 1);
    assert.equal(vl.vlOpticalPaths, 2);
    assert.equal(vl.encapsulatedDoc, null);
    const pdf = summarizeDataset(readDataset(pdfFile()));
    assert.ok(pdf.encapsulatedDoc?.includes('PDF'));
    assert.ok(pdf.encapsulatedDoc?.includes('256 bytes'));
    assert.equal(pdf.vlTiles, null);
  });
  it('C2 annotations validate, clip, label — hostile input loud', () => {
    const good = {
      id: 'crypts', region: 'Colonic crypts', stain: 'H&E',
      rect: [0, 0, 31, 23], note: 'Practice field.',
    };
    const v = validateWsiAnnotation(good);
    assert.equal(v.region, 'Colonic crypts');
    assert.equal(wsiAnnotationLabel(v), 'Colonic crypts · H&E');
    assert.equal(wsiAnnotationLabel({ ...v, stain: '' }), 'Colonic crypts');
    assert.deepEqual(validateWsiAnnotations([good, { ...good, id: 'b' }]).length, 2);
    assert.deepEqual(validateWsiAnnotations([]), []);
    // clipping: inside passes, partial truncates, outside is null
    assert.deepEqual(clipWsiRect([0, 0, 31, 23], 64, 48), [0, 0, 31, 23]);
    assert.deepEqual(clipWsiRect([60, 40, 100, 100], 64, 48), [60, 40, 63, 47]);
    assert.equal(clipWsiRect([100, 100, 200, 200], 64, 48), null);
    const bads: Array<[unknown, RegExp]> = [
      [null, /bad-wsi-annotation/],
      [{ ...good, id: '' }, /id/],
      [{ ...good, stain: 3 }, /stain/],
      [{ ...good, rect: [0, 0, 31] }, /rect/],
      [{ ...good, rect: [0, 0, -1, 5] }, /rect/],
      [{ ...good, rect: [5, 5, 2, 2] }, /inverted/],
    ];
    for (const [raw, re] of bads) assert.throws(() => validateWsiAnnotation(raw), re);
    assert.throws(() => validateWsiAnnotations({}), /must be an array/);
    assert.throws(
      () => validateWsiAnnotations([good, { ...good }]),
      /duplicate id/,
    );
  });
  it('C2 demo set validates + fits the 64×48 tile', () => {
    // Hand-authored set lives in volume-core (wsi-demo.ts); the shape is
    // pinned here through io's own validator so drift fails loudly.
    const demo = [
      { id: 'gradient-field', region: 'Gradient field', stain: 'H&E', rect: [0, 0, 31, 23], note: 'Practice field: smooth intensity ramp.' },
      { id: 'banding-band', region: 'Banding band', stain: 'H&E', rect: [32, 24, 63, 47], note: 'Practice field: repeating bands.' },
      { id: 'full-frame', region: 'Whole-tile context', stain: '', rect: [0, 0, 63, 47], note: 'Whole-tile frame: orientation reference only.' },
    ];
    const back = validateWsiAnnotations(JSON.parse(JSON.stringify(demo)));
    assert.equal(back.length, 3);
    assert.equal(new Set(back.map((a) => a.id)).size, 3);
    for (const a of back) assert.ok(clipWsiRect(a.rect, 64, 48) !== null, `${a.id} escapes the demo tile`);
  });
  it('missing matrix/docs degrade to nulls, never throw', () => {
    const bare = writePart10(VL_MICROSCOPIC_SOP_CLASS, '1.2.9.3', [
      { tag: [0x0008, 0x0016], vr: 'UI', value: VL_MICROSCOPIC_SOP_CLASS },
    ]);
    const grid = parseVlGrid(readDataset(bare));
    assert.equal(grid.totalCols, null);
    assert.equal(grid.tileOffsets.length, 0);
    assert.equal(vlGridLabel(grid), null);
    const noDoc = writePart10(ENCAPSULATED_PDF_SOP_CLASS, '1.2.9.4', [
      { tag: [0x0008, 0x0016], vr: 'UI', value: ENCAPSULATED_PDF_SOP_CLASS },
    ]);
    const doc = parseEncapsulatedDoc(readDataset(noDoc));
    assert.equal(doc.title, null);
    assert.equal(doc.byteLength, 0);
  });
});
