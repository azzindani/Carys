import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writePart10, type DcmElement } from '../dcm-write.js';
import { US_IMAGE_SOP_CLASS } from '../us.js';
import {
  cineFields, foldYbrFrame, isUsSopClass, physicalUnitsName,
  regionDataTypeName, regionSpatialFormatName, usRegionsFromBuffer,
  usRegionSpacingMm, ybrToLuma,
} from '../us.js';
import { parseDicomFrames } from '../dicom-parse.js';
import { fileMetaToSummary, summarizeDataset, usTypesLabel } from '../dicom-tags.js';
import { readDataset } from '../dcm-read.js';

const US_SOP = '1.2.840.10008.5.1.4.1.1.6.1';

const regionItem = (els: DcmElement[]): { elements: DcmElement[] } => ({ elements: els });

/** US file: 2 native YBR_FULL_422 frames + regions + FrameTime + FTV. */
function usFile(): ArrayBuffer {
  const n = 4 * 2; // 4x2 frame, 422 packs n*2 bytes per frame
  const frame = new Uint8Array(n * 2);
  for (let i = 0; i < frame.length; i++) frame[i] = (i * 37) & 0xff;
  const px = new Uint8Array(n * 2 * 2);
  px.set(frame, 0);
  px.set(frame, n * 2);
  return writePart10(US_SOP, '1.2.7.1', [
    { tag: [0x0008, 0x0016], vr: 'UI', value: US_SOP },
    { tag: [0x0008, 0x0060], vr: 'CS', value: 'US' },
    { tag: [0x0028, 0x0010], vr: 'US', value: 2 },
    { tag: [0x0028, 0x0011], vr: 'US', value: 4 },
    { tag: [0x0028, 0x0100], vr: 'US', value: 8 },
    { tag: [0x0028, 0x0101], vr: 'US', value: 8 },
    { tag: [0x0028, 0x0102], vr: 'US', value: 7 },
    { tag: [0x0028, 0x0103], vr: 'US', value: 0 },
    { tag: [0x0028, 0x0002], vr: 'US', value: 3 },
    { tag: [0x0028, 0x0004], vr: 'CS', value: 'YBR_FULL_422' },
    { tag: [0x0028, 0x0008], vr: 'IS', value: 2 },
    { tag: [0x0018, 0x1063], vr: 'DS', value: '38.714' },
    { tag: [0x0018, 0x1065], vr: 'DS', value: ['38.0', '39.0'] },
    { tag: [0x0008, 0x2144], vr: 'IS', value: 26 },
    {
      tag: [0x0018, 0x6011], vr: 'SQ', value: [regionItem([
        { tag: [0x0018, 0x6012], vr: 'US', value: 1 },
        { tag: [0x0018, 0x6014], vr: 'US', value: 1 },
        { tag: [0x0018, 0x6016], vr: 'UL', value: 0 },
        { tag: [0x0018, 0x6018], vr: 'UL', value: 11 },
        { tag: [0x0018, 0x601a], vr: 'UL', value: 30 },
        { tag: [0x0018, 0x601c], vr: 'UL', value: 788 },
        { tag: [0x0018, 0x601e], vr: 'UL', value: 592 },
        { tag: [0x0018, 0x6020], vr: 'SL', value: 0 },
        { tag: [0x0018, 0x6022], vr: 'SL', value: 0 },
        { tag: [0x0018, 0x6024], vr: 'US', value: 3 },
        { tag: [0x0018, 0x6026], vr: 'US', value: 3 },
        { tag: [0x0018, 0x6028], vr: 'FD', value: 0 },
        { tag: [0x0018, 0x602a], vr: 'FD', value: 0 },
        { tag: [0x0018, 0x602c], vr: 'FD', value: 0.0412587 },
        { tag: [0x0018, 0x602e], vr: 'FD', value: 0.0412587 },
        { tag: [0x0018, 0x6030], vr: 'UL', value: 3500000 },
      ]), regionItem([
        { tag: [0x0018, 0x6012], vr: 'US', value: 1 },
        { tag: [0x0018, 0x6014], vr: 'US', value: 2 },
        { tag: [0x0018, 0x6024], vr: 'US', value: 7 },
        { tag: [0x0018, 0x6026], vr: 'US', value: 7 },
        { tag: [0x0018, 0x602c], vr: 'FD', value: 0.1 },
        { tag: [0x0018, 0x602e], vr: 'FD', value: 0.2 },
      ])],
    },
    { tag: [0x7fe0, 0x0010], vr: 'OB', value: px },
  ]);
}

describe('us regions + cine', () => {
  it('reads region rows, SOP gate, mm spacing from the cm 2D row', () => {
    const regions = usRegionsFromBuffer(usFile());
    assert.equal(regions.length, 2);
    assert.equal(regions[0]!.dataType, 1);
    assert.equal(regions[0]!.x0, 11);
    assert.equal(regions[0]!.y1, 592);
    assert.equal(regions[0]!.unitsX, 3);
    assert.equal(regions[0]!.transducerFreq, 3500000);
    assert.ok(isUsSopClass(US_SOP));
    assert.ok(isUsSopClass('1.2.840.10008.5.1.4.1.1.3.1'));
    assert.ok(!isUsSopClass('1.2.840.10008.5.1.4.1.1.2'));
    assert.ok(!isUsSopClass(null));
    // first 2D cm row wins; the cm/sec row is skipped
    assert.deepEqual(usRegionSpacingMm(regions), [0.0412587 * 10, 0.0412587 * 10]);
    assert.equal(usTypesLabel(regions), 'Tissue + Color Flow');
  });
  it('names tables cover the cornerstone + fixture values', () => {
    const types = ['None', 'Tissue', 'Color Flow', 'PW Spectral Doppler', 'CW Spectral Doppler'];
    for (let i = 0; i < types.length; i++) assert.equal(regionDataTypeName(i), types[i]);
    const formats = ['None', '2D', 'M-Mode', 'Spectral', 'Waveform'];
    for (let i = 0; i < formats.length; i++) assert.equal(regionSpatialFormatName(i), formats[i]);
    const units: [number, string][] = [
      [0, 'px'], [1, 'percent'], [2, 'dB'], [3, 'cm'], [4, 'seconds'],
      [5, 'hertz'], [6, 'dB/seconds'], [7, 'cm/sec'], [8, 'cm²'], [9, 'cm²/s'], [0x0c, 'degrees'],
    ];
    for (const [v, name] of units) assert.equal(physicalUnitsName(v), name);
    assert.equal(physicalUnitsName(99), 'unit-99');
    assert.equal(regionDataTypeName(9), 'type-9');
  });
  it('cine timing: rec rate first, then cine rate, then frame interval', () => {
    assert.deepEqual(cineFields(38.714, [38, 39], null, 26), { frameTimeMs: 38.714, cineFps: 26 });
    assert.deepEqual(cineFields(38.714, [38, 39], 30, null), { frameTimeMs: 38.714, cineFps: 30 });
    // no rate tags: derived from the scalar
    const d = cineFields(40, [], null, null);
    assert.equal(d.frameTimeMs, 40);
    assert.ok(Math.abs(d.cineFps! - 25) < 1e-9);
    // scalar absent: the vector mean carries it
    const v = cineFields(null, [38, 39], null, null);
    assert.ok(Math.abs(v.frameTimeMs! - 38.5) < 1e-9);
    assert.ok(Math.abs(v.cineFps! - 1000 / 38.5) < 1e-9);
    // nothing: both null — the caller shows frames only
    assert.deepEqual(cineFields(null, [], null, null), { frameTimeMs: null, cineFps: null });
    // junk never leaks through: zeros, negatives, NaN all null
    assert.deepEqual(cineFields(0, [-1], 0, NaN), { frameTimeMs: null, cineFps: null });
  });
  it('native YBR_FULL_422 cine decodes to two luma frames + cine meta', () => {
    const parts = parseDicomFrames(usFile());
    assert.equal(parts.length, 2);
    assert.equal(parts[0]!.slice.frameIndex, 0);
    assert.equal(parts[1]!.slice.frameIndex, 1);
    const luma = (y: number, cb: number, cr: number): number => ybrToLuma(y & 0xff, cb & 0xff, cr & 0xff);
    assert.deepEqual([...parts[0]!.slice.pixelData.subarray(0, 4)], [
      luma(0, 74, 111), luma(37, 74, 111), luma(148, 222, 259 & 0xff), luma(185, 222, 3),
    ]);
    // frame 1 repeats frame 0 byte-identical (same synthetic frame twice)
    assert.deepEqual(
      [...parts[1]!.slice.pixelData], [...parts[0]!.slice.pixelData]);
    const m = parts[0]!.meta;
    assert.equal(m.numberOfFrames, 2);
    assert.equal(m.samplesPerPixel, 3);
    assert.equal(m.photometric, 'YBR_FULL_422');
    assert.equal(m.bitsAllocated, 8);
    assert.equal(m.frameTimeMs, 38.714);
    assert.equal(m.cineFps, 26);
  });
  it('summary carries regions + cine on both sources', () => {
    const buf = usFile();
    const viaDataset = summarizeDataset(readDataset(buf));
    assert.equal(viaDataset.usRegions, 2);
    assert.deepEqual(viaDataset.usSpacingMm, [0.0412587 * 10, 0.0412587 * 10]);
    assert.equal(viaDataset.usTypes, 'Tissue + Color Flow');
    assert.equal(viaDataset.frameTimeMs, 38.714);
    assert.equal(viaDataset.cineFps, 26);
    const meta = parseDicomFrames(buf)[0]!.meta;
    const viaMeta = fileMetaToSummary(meta, meta.sopClassUID);
    assert.equal(viaMeta.frameTimeMs, 38.714);
    assert.equal(viaMeta.cineFps, 26);
    // pixel path passes no regions: its fields stay null, never crash
    assert.equal(viaMeta.usRegions, null);
    const regions = usRegionsFromBuffer(buf);
    const withRegions = fileMetaToSummary(meta, meta.sopClassUID, regions);
    assert.equal(withRegions.usRegions, 2);
    assert.deepEqual(withRegions.usSpacingMm, [0.0412587 * 10, 0.0412587 * 10]);
  });
  it('fold boundaries are loud, never guess', () => {
    assert.throws(() => foldYbrFrame(new Uint8Array(8), 2, 2, 'PALETTE COLOR'), /us-ybr-photometric/);
    assert.throws(() => foldYbrFrame(new Uint8Array(8), 3, 3, 'YBR_FULL_422'), /us-ybr-odd-width/);
    assert.throws(() => foldYbrFrame(new Uint8Array(3), 2, 2, 'YBR_FULL'), /us-ybr-short/);
    assert.throws(() => foldYbrFrame(new Uint8Array(7), 2, 2, 'YBR_FULL_422'), /us-ybr-short/);
    // absent regions never fail the pixel path
    assert.deepEqual(usRegionsFromBuffer(new Uint8Array(4).buffer as ArrayBuffer), []);
    assert.equal(usRegionSpacingMm([]), null);
    assert.equal(usTypesLabel([]), null);
    // no 2D cm row: no spacing, even with rows present
    assert.equal(usRegionSpacingMm([{
      spatialFormat: 3, dataType: 3, flags: null, x0: null, y0: null, x1: null, y1: null,
      refX: null, refY: null, unitsX: 4, unitsY: 7, refValX: null, refValY: null,
      deltaX: 1, deltaY: 2, transducerFreq: null,
    }]), null);
  });
});
