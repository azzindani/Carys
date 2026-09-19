import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DicomParseError, parseDicomFrames } from '../dicom-parse.js';
import { sortSlices, type DicomSlice } from '../dicom.js';
import { makeUID, writePart10, type DcmElement, type DcmItem } from '../dcm-write.js';

const ENH_MR = '1.2.840.10008.5.1.4.1.1.4.1';
const ROWS = 2;
const COLS = 3;

function frameItem(z: number, div: number): DcmItem {
  return {
    elements: [
      {
        tag: [0x0020, 0x9111], vr: 'SQ', value: [{
          elements: [{ tag: [0x0020, 0x9157], vr: 'UL', value: [div] }],
        }],
      },
      {
        tag: [0x0020, 0x9113], vr: 'SQ', value: [{
          elements: [{ tag: [0x0020, 0x0032], vr: 'DS', value: [0, 0, z] }],
        }],
      },
    ],
  };
}

/** Enhanced MR, 3 native frames, per-frame IPP z + DIV, shared IOP. */
function enhanced(zs: number[]): ArrayBuffer {
  const px = new Uint8Array(ROWS * COLS * zs.length);
  zs.forEach((_, f) => px.fill(10 * (f + 1), f * ROWS * COLS, (f + 1) * ROWS * COLS));
  const ds: DcmElement[] = [
    { tag: [0x0008, 0x0016], vr: 'UI', value: ENH_MR },
    { tag: [0x0008, 0x0018], vr: 'UI', value: makeUID() },
    { tag: [0x0008, 0x0060], vr: 'CS', value: 'MR' },
    { tag: [0x0028, 0x0002], vr: 'US', value: 1 },
    { tag: [0x0028, 0x0004], vr: 'CS', value: 'MONOCHROME2' },
    { tag: [0x0028, 0x0010], vr: 'US', value: ROWS },
    { tag: [0x0028, 0x0011], vr: 'US', value: COLS },
    { tag: [0x0028, 0x0008], vr: 'IS', value: zs.length },
    { tag: [0x0028, 0x0100], vr: 'US', value: 8 },
    { tag: [0x0028, 0x0101], vr: 'US', value: 8 },
    { tag: [0x0028, 0x0103], vr: 'US', value: 0 },
    // Decoy file-level SliceLocation: per-frame IPP must win.
    { tag: [0x0020, 0x1041], vr: 'DS', value: 999 },
    {
      tag: [0x5200, 0x9229], vr: 'SQ', value: [{
        elements: [{
          tag: [0x0020, 0x9116], vr: 'SQ', value: [{
            elements: [{ tag: [0x0020, 0x0037], vr: 'DS', value: [1, 0, 0, 0, 1, 0] }],
          }],
        }],
      }],
    },
    { tag: [0x5200, 0x9230], vr: 'SQ', value: zs.map((z, f) => frameItem(z, f + 1)) },
    { tag: [0x7fe0, 0x0010], vr: 'OB', value: px },
  ];
  return writePart10(ENH_MR, makeUID(), ds);
}

describe('enhanced functional groups', () => {
  it('per-frame IPP/DIV resolve onto slices and drive sort order', () => {
    // Stored feet-first (descending z): file order must survive, sort by IPP.
    const frames = parseDicomFrames(enhanced([30, 20, 10]));
    assert.equal(frames.length, 3);
    assert.deepEqual(frames.map((f) => f.slice.sliceLocation), [30, 20, 10]);
    assert.deepEqual(frames.map((f) => f.slice.ipp), [[0, 0, 30], [0, 0, 20], [0, 0, 10]]);
    assert.deepEqual(frames.map((f) => f.slice.dimensionIndexValues), [[1], [2], [3]]);
    assert.deepEqual(frames.map((f) => f.slice.frameIndex), [0, 1, 2]);
    for (const f of frames) assert.deepEqual(f.slice.iop, [1, 0, 0, 0, 1, 0]); // shared
    // Pixels follow file order, not z order.
    assert.ok((frames[0]!.slice.pixelData as Int16Array).every((v) => v === 10));
    assert.ok((frames[2]!.slice.pixelData as Int16Array).every((v) => v === 30));
    // sortSlices (stackToVolume order) now sorts Enhanced stacks by IPP z.
    const sorted: DicomSlice[] = sortSlices(frames.map((f) => f.slice));
    assert.deepEqual(sorted.map((s) => s.sliceLocation), [10, 20, 30]);
    assert.ok((sorted[0]!.pixelData as Int16Array).every((v) => v === 30));
  });
  it('shared-only geometry applies to every frame', () => {
    const px = new Uint8Array(ROWS * COLS * 2).fill(7);
    const ds: DcmElement[] = [
      { tag: [0x0008, 0x0016], vr: 'UI', value: ENH_MR },
      { tag: [0x0008, 0x0018], vr: 'UI', value: makeUID() },
      { tag: [0x0028, 0x0002], vr: 'US', value: 1 },
      { tag: [0x0028, 0x0004], vr: 'CS', value: 'MONOCHROME2' },
      { tag: [0x0028, 0x0010], vr: 'US', value: ROWS },
      { tag: [0x0028, 0x0011], vr: 'US', value: COLS },
      { tag: [0x0028, 0x0008], vr: 'IS', value: 2 },
      { tag: [0x0028, 0x0100], vr: 'US', value: 8 },
      { tag: [0x0028, 0x0101], vr: 'US', value: 8 },
      { tag: [0x0028, 0x0103], vr: 'US', value: 0 },
      {
        tag: [0x5200, 0x9229], vr: 'SQ', value: [{
          elements: [{
            tag: [0x0020, 0x9113], vr: 'SQ', value: [{
              elements: [{ tag: [0x0020, 0x0032], vr: 'DS', value: [1, 2, 42] }],
            }],
          }],
        }],
      },
      { tag: [0x7fe0, 0x0010], vr: 'OB', value: px },
    ];
    const frames = parseDicomFrames(writePart10(ENH_MR, makeUID(), ds));
    assert.equal(frames.length, 2);
    for (const f of frames) {
      assert.deepEqual(f.slice.ipp, [1, 2, 42]);
      assert.equal(f.slice.sliceLocation, 42);
    }
  });
  it('pixel measures resolve per-frame, else shared, else absent', () => {
    const measures = (st: number, ps: [number, number]): DcmElement => ({
      tag: [0x0028, 0x9110], vr: 'SQ', value: [{
        elements: [
          { tag: [0x0018, 0x0050], vr: 'DS', value: st },
          { tag: [0x0028, 0x0030], vr: 'DS', value: [...ps] },
        ],
      }],
    });
    const shared: DcmItem = {
      elements: [
        {
          tag: [0x0020, 0x9116], vr: 'SQ', value: [{
            elements: [{ tag: [0x0020, 0x0037], vr: 'DS', value: [1, 0, 0, 0, 1, 0] }],
          }],
        },
        measures(2, [0.5, 0.5]),
      ],
    };
    // Frame 2 overrides spacing/thickness; others inherit shared.
    const perFrame = [frameItem(10, 1), {
      elements: [frameItem(20, 2).elements[0]!, frameItem(20, 2).elements[1]!, measures(5, [1, 1])],
    }, frameItem(30, 3)];
    const px = new Uint8Array(ROWS * COLS * 3).fill(4);
    const buf = writePart10(ENH_MR, makeUID(), [
      { tag: [0x0008, 0x0016], vr: 'UI', value: ENH_MR },
      { tag: [0x0008, 0x0018], vr: 'UI', value: makeUID() },
      { tag: [0x0028, 0x0002], vr: 'US', value: 1 },
      { tag: [0x0028, 0x0004], vr: 'CS', value: 'MONOCHROME2' },
      { tag: [0x0028, 0x0010], vr: 'US', value: ROWS },
      { tag: [0x0028, 0x0011], vr: 'US', value: COLS },
      { tag: [0x0028, 0x0008], vr: 'IS', value: 3 },
      { tag: [0x0028, 0x0100], vr: 'US', value: 8 },
      { tag: [0x0028, 0x0101], vr: 'US', value: 8 },
      { tag: [0x0028, 0x0103], vr: 'US', value: 0 },
      { tag: [0x5200, 0x9229], vr: 'SQ', value: [shared] },
      { tag: [0x5200, 0x9230], vr: 'SQ', value: perFrame },
      { tag: [0x7fe0, 0x0010], vr: 'OB', value: px },
    ]);
    const frames = parseDicomFrames(buf);
    assert.deepEqual(frames.map((f) => f.slice.pixelSpacing), [[0.5, 0.5], [1, 1], [0.5, 0.5]]);
    assert.deepEqual(frames.map((f) => f.slice.sliceThickness), [2, 5, 2]);
    // File-level meta keeps no spacing (none was given): slices carry it.
    assert.equal(frames[0]!.meta.pixelSpacing, null);
  });
  it('group/frame count mismatch is loud; classic files keep file-level behavior', () => {
    const bad = enhanced([10, 20, 30]);
    // Patch NumberOfFrames 3 -> 2 in place (IS '3' single byte at known tag).
    const bytes = new Uint8Array(bad);
    const dv = new DataView(bad);
    let patched = false;
    for (let o = 132; o < bytes.length - 12; o++) {
      if (dv.getUint16(o, true) === 0x0028 && dv.getUint16(o + 2, true) === 0x0008) {
        const vr = String.fromCharCode(bytes[o + 4]!, bytes[o + 5]!);
        if (vr === 'IS') {
          const len = dv.getUint16(o + 6, true);
          const s = new TextDecoder().decode(bytes.slice(o + 8, o + 8 + len));
          if (s.trim() === '3') {
            bytes[o + 8] = '2'.charCodeAt(0);
            patched = true;
            break;
          }
        }
      }
    }
    assert.ok(patched, 'builder changed: NumberOfFrames tag not found');
    assert.throws(
      () => parseDicomFrames(bad),
      (e: unknown) => e instanceof DicomParseError && e.kind === 'truncated',
    );
    // Classic 2-frame file, no groups: file-level SliceLocation stands, no ipp.
    const px = new Uint8Array(ROWS * COLS * 2).fill(5);
    const classic = writePart10('1.2.3', makeUID(), [
      { tag: [0x0008, 0x0016], vr: 'UI', value: '1.2.3' },
      { tag: [0x0028, 0x0002], vr: 'US', value: 1 },
      { tag: [0x0028, 0x0004], vr: 'CS', value: 'MONOCHROME2' },
      { tag: [0x0028, 0x0010], vr: 'US', value: ROWS },
      { tag: [0x0028, 0x0011], vr: 'US', value: COLS },
      { tag: [0x0028, 0x0008], vr: 'IS', value: 2 },
      { tag: [0x0028, 0x0100], vr: 'US', value: 8 },
      { tag: [0x0028, 0x0101], vr: 'US', value: 8 },
      { tag: [0x0028, 0x0103], vr: 'US', value: 0 },
      { tag: [0x0020, 0x1041], vr: 'DS', value: 5 },
      { tag: [0x7fe0, 0x0010], vr: 'OB', value: px },
    ]);
    const frames = parseDicomFrames(classic);
    assert.equal(frames.length, 2);
    assert.deepEqual(frames.map((f) => f.slice.sliceLocation), [5, 5]);
    assert.deepEqual(frames.map((f) => f.slice.frameIndex), [0, 1]);
    assert.ok(frames.every((f) => f.slice.ipp === undefined));
  });
});
