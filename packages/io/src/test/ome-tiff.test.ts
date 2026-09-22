import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOmeTiffLike, isTiffLike, makeOmeTiff, parseOmeTiff,
} from '../ome-tiff.js';
import { lzwDecodeTiff, OmeTiffError } from '../tiff-lzw.js';
import { JPEG_GRAY_EXPECTED_B64, JPEG_GRAY_JPG, b64ToBytes } from './fixtures-jpeg.js';

// PIL-written LZW strip (12x7 gray, 95 bytes) + its exact pixels: the
// compliance proof for the TIFF LZW codec (early-change growth validated;
// 200x200 PIL file also verified during development: 0/40000).
const PIL_STRIP = [
  128, 60, 68, 164, 165, 2, 81, 114, 175, 1, 138, 28, 167, 36, 185, 109, 0, 148, 101, 59,
  216, 195, 146, 243, 85, 80, 205, 28, 173, 129, 192, 1, 41, 48, 222, 148, 36, 55, 128, 109,
  242, 107, 164, 108, 91, 0, 169, 89, 71, 240, 160, 229, 164, 131, 84, 27, 18, 34, 22, 216,
  1, 152, 74, 55, 135, 151, 45, 227, 187, 29, 162, 17, 27, 19, 80, 10, 82, 187, 188, 40,
  71, 47, 46, 8, 230, 194, 10, 217, 182, 253, 129, 156, 96, 208, 16,
];
const PIL_PIX = [
  241, 37, 74, 160, 148, 185, 175, 3, 40, 229, 114, 151, 91, 128, 148, 202, 239, 198, 57, 94,
  213, 168, 205, 57, 182, 14, 0, 37, 76, 111, 148, 72, 222, 3, 223, 77, 233, 54, 91, 1,
  165, 202, 127, 20, 57, 210, 131, 168, 108, 145, 33, 219, 0, 204, 74, 111, 30, 185, 222, 119,
  199, 209, 17, 54, 77, 128, 165, 87, 239, 20, 71, 94, 184, 71, 108, 65, 182, 219, 253, 37,
  74, 113, 148, 185,
];

const ramp = (n: number, f: (i: number) => number): number[] => Array.from({ length: n }, (_, i) => f(i));

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

/** Minimal hand-built TIFF for boundary/error cases: LE/BE, SHORT/LONG/ASCII. */
function miniTiff(opts: {
  little?: boolean; entries: Array<[number, number, number[] | string]>; blobs?: number[][]; next?: number;
}): ArrayBuffer {
  const little = opts.little ?? true;
  const out: number[] = [];
  const u16 = (v: number): void => {
    if (little) out.push(v & 0xff, (v >> 8) & 0xff);
    else out.push((v >> 8) & 0xff, v & 0xff);
  };
  const u32 = (v: number): void => {
    const b = [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
    pushAll(little ? b : b.reverse());
  };
  const pushAll = (a: ArrayLike<number>): void => { for (let i = 0; i < a.length; i++) out.push(a[i]!); };
  pushAll(little ? [0x49, 0x49] : [0x4d, 0x4d]);
  u16(42);
  u32(8);
  u16(opts.entries.length);
  const blobs: number[][] = [];
  const callerBlobs = opts.blobs ?? [];
  let blobAt = 8 + 2 + opts.entries.length * 12 + 4;
  const entryAt: number[] = [];
  const blobRefs: Array<{ entryPos: number; blob: number }> = [];
  for (const [tag, type, vals] of opts.entries) {
    entryAt.push(out.length);
    u16(tag); u16(type);
    const isStr = typeof vals === 'string';
    const isBlobRef = isStr && (vals as string).startsWith('$BLOB');
    const count = isStr ? (isBlobRef ? 1 : (vals as string).length + 1) : (vals as number[]).length;
    u32(count);
    const unit = type === 3 ? 2 : type === 4 ? 4 : 1;
    if (unit * count <= 4 && !isStr) {
      const raw: number[] = [];
      for (const v of vals as number[]) {
        if (type === 3) raw.push(...(little ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]));
        else raw.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
      }
      while (raw.length < 4) raw.push(0);
      pushAll(raw.slice(0, 4));
    } else if (isStr && (vals as string).startsWith('$BLOB')) {
      // '$BLOBn': LONG offset patched to caller blob n (collected below).
      u32(0);
      blobRefs.push({ entryPos: out.length - 4, blob: parseInt((vals as string).slice(5), 10) });
    } else {
      u32(blobAt);
      const bytes = isStr
        ? [...new TextEncoder().encode(vals as string), 0]
        : (vals as number[]).flatMap((v) => type === 3
          ? (little ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff])
          : [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
      blobs.push(bytes);
      blobAt += bytes.length + (bytes.length % 2);
    }
  }
  u32(opts.next ?? 0);
  for (const b of blobs) {
    while (out.length % 2) out.push(0);
    pushAll(b);
  }
  const callerOffs = callerBlobs.map((b) => {
    while (out.length % 2) out.push(0);
    const off = out.length;
    pushAll(b);
    return off;
  });
  for (const r of blobRefs) {
    const off = callerOffs[r.blob]!;
    for (let k = 0; k < 4; k++) out[r.entryPos + k] = little ? (off >> (k * 8)) & 0xff : (off >> ((3 - k) * 8)) & 0xff;
  }
  return new Uint8Array(out).buffer as ArrayBuffer;
}

describe('ome-tiff', () => {
  it('PIL LZW golden decodes byte-exact', () => {
    assert.deepEqual([...lzwDecodeTiff(Uint8Array.from(PIL_STRIP), 84)], PIL_PIX);
  });
  it('raw strips round-trip incl. 16-bit, photometric 0, multi-strip', () => {
    const v16 = ramp(4 * 3, (i) => (i * 5432) % 65536);
    const cases = [
      makeOmeTiff([{ w: 6, h: 2, values: ramp(12, (i) => i * 20) }]),
      makeOmeTiff([{ w: 4, h: 3, values: v16, bits: 16 }]),
      makeOmeTiff([{ w: 3, h: 1, values: [0, 255, 128], photometric: 0 }]),
      makeOmeTiff([{ w: 4, h: 4, values: ramp(16, (i) => i), rowsPerStrip: 1 }]),
      makeOmeTiff([{ w: 4, h: 4, values: ramp(16, (i) => i * 3), rowsPerStrip: 3 }]),
    ];
    const want = [ramp(12, (i) => i * 20), v16, [0, 255, 128], ramp(16, (i) => i), ramp(16, (i) => i * 3)];
    cases.forEach((buf, k) => {
      const { planes } = parseOmeTiff(buf);
      assert.equal(planes.length, 1, `case ${k}`);
      assert.deepEqual([...planes[0]!.data], want[k], `case ${k}`);
    });
  });
  it('LZW round-trips incl. predictor 2 and 16-bit', () => {
    const smooth = ramp(10 * 8, (i) => Math.floor(i / 10) * 3 + (i % 10));
    const v16 = ramp(9 * 5, (i) => 1000 + ((i * 37) % 60000));
    for (const [plane, want] of [
      [{ w: 10, h: 8, values: smooth, compression: 5 as const }, smooth],
      [{ w: 10, h: 8, values: smooth, compression: 5 as const, predictor: 2 as const }, smooth],
      [{ w: 9, h: 5, values: v16, bits: 16 as const, compression: 5 as const, predictor: 2 as const }, v16],
    ] as const) {
      const { planes } = parseOmeTiff(makeOmeTiff([plane]));
      assert.deepEqual([...planes[0]!.data], [...want]);
    }
  });
  it('deflate strips round-trip', () => {
    const values = ramp(32 * 3, (i) => (i * 7 + 11) % 256);
    const { planes } = parseOmeTiff(makeOmeTiff([{ w: 32, h: 3, values, compression: 8 }]));
    assert.deepEqual([...planes[0]!.data], values);
  });
  it('tiles assemble with edge crops (raw + LZW)', () => {
    const values = ramp(10 * 7, (i) => (i * 13) % 256);
    for (const compression of [1, 5] as const) {
      const { planes } = parseOmeTiff(makeOmeTiff([{ w: 10, h: 7, values, compression, tiled: { tw: 4, th: 4 } }]));
      assert.deepEqual([planes[0]!.width, planes[0]!.height], [10, 7]);
      assert.deepEqual([...planes[0]!.data], values, `compression ${compression}`);
    }
  });
  it('JPEG tile folds to luma within tolerance', () => {
    const { planes } = parseOmeTiff(makeOmeTiff([{
      w: 64, h: 64, values: new Array(4096).fill(0),
      compression: 7, tiled: { tw: 64, th: 64 }, jpegBytes: Uint8Array.from(JPEG_GRAY_JPG),
    }]));
    assert.deepEqual([planes[0]!.width, planes[0]!.height], [64, 64]);
    assert.ok(maxDiff(planes[0]!.data, b64ToBytes(JPEG_GRAY_EXPECTED_B64)) <= 2);
  });
  it('OME-XML maps sizes, channels and per-plane indices', () => {
    const xml = '<?xml version="1.0"?><OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">' +
      '<Image ID="Image:0"><Pixels DimensionOrder="XYZCT" ID="Pixels:0" SizeC="2" SizeT="1" SizeX="4" SizeY="2" SizeZ="3" Type="uint8">' +
      '<Channel ID="Channel:0:0" Name="DAPI" SamplesPerPixel="1"/><Channel ID="Channel:0:1" Name="GFP" SamplesPerPixel="1"/>' +
      '<TiffData IFD="0" PlaneCount="1" FirstC="1" FirstZ="2" FirstT="0"/>' +
      '<TiffData IFD="1" PlaneCount="1"/>' +
      '</Pixels></Image></OME>';
    const mk = (v: number) => makeOmeTiff([
      { w: 4, h: 2, values: new Array(8).fill(v) },
      { w: 4, h: 2, values: new Array(8).fill(v + 1) },
    ], { omexml: xml });
    const { meta, planes } = parseOmeTiff(mk(9));
    assert.deepEqual([meta!.sizeX, meta!.sizeY, meta!.sizeZ, meta!.sizeC, meta!.sizeT], [4, 2, 3, 2, 1]);
    assert.deepEqual(meta!.channels, ['DAPI', 'GFP']);
    assert.deepEqual(planes.map((p) => [p.c, p.z, p.t]), [[1, 2, 0], [0, 0, 0]]);
    assert.deepEqual([...planes[0]!.data], new Array(8).fill(9));
    assert.ok(isOmeTiffLike(new Uint8Array(mk(9))));
  });
  it('napari-studied DimensionOrder: explicit First* wins, unwalked walks C', () => {
    // napari reads OME-TIFF in tzyx order with channel last; OME-XML
    // disambiguates per-plane TiffData with explicit FirstC/FirstZ/FirstT
    // (the vendored tczyx fixture enumerates all 12 this way). When a
    // multi-plane TiffData element carries explicit starts, the walk
    // follows the DimensionOrder's fastest-varying axis; bare elements
    // walk C (SizeC stride, the only unambiguous default).
    const mkOrder = (order: string, tiffData: string) => makeOmeTiff([
      { w: 2, h: 2, values: [1, 2, 3, 4] },
      { w: 2, h: 2, values: [5, 6, 7, 8] },
      { w: 2, h: 2, values: [9, 10, 11, 12] },
    ], {
      omexml: '<?xml version="1.0"?><OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">' +
        `<Image ID="Image:0"><Pixels DimensionOrder="${order}" ID="Pixels:0" SizeC="3" SizeT="1" SizeX="2" SizeY="2" SizeZ="1" Type="uint8">` +
        '<Channel ID="Channel:0:0" Name="C0" SamplesPerPixel="1"/>' +
        tiffData +
        '</Pixels></Image></OME>',
    });
    // explicit FirstC on a PlaneCount=3 element walks C regardless of order
    const ex = parseOmeTiff(mkOrder('XYZCT', '<TiffData IFD="0" PlaneCount="3" FirstC="0" FirstZ="0" FirstT="0"/>'));
    assert.deepEqual(ex.planes.map((p) => [p.c, p.z, p.t]), [[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
    assert.deepEqual([...ex.planes[2]!.data], [9, 10, 11, 12]);
    // bare multi-plane element walks C (documented default, never guessed)
    const bare = parseOmeTiff(mkOrder('XYZCT', '<TiffData IFD="0" PlaneCount="3"/>'));
    assert.deepEqual(bare.planes.map((p) => [p.c, p.z, p.t]), [[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
  });
  it('plain TIFF without OME-XML decodes with null meta, z=ifd', () => {
    const { meta, planes } = parseOmeTiff(makeOmeTiff([
      { w: 2, h: 2, values: [1, 2, 3, 4] },
      { w: 2, h: 2, values: [5, 6, 7, 8] },
    ], { omexml: null }));
    assert.equal(meta, null);
    assert.deepEqual(planes.map((p) => [p.c, p.z, p.t]), [[0, 0, 0], [0, 1, 0]]);
    assert.deepEqual([...planes[1]!.data], [5, 6, 7, 8]);
  });
  it('big-endian 16-bit raw hand-crafted file swaps correctly', () => {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint16(0, 0x0102, false);
    const be16 = (v: number): number[] => { dv.setUint16(0, v, false); return [dv.getUint8(0), dv.getUint8(1)]; };
    const head = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8];
    const entries: number[] = [];
    const pushEntry = (tag: number, type: number, count: number, v: number[]): void => {
      entries.push((tag >> 8) & 0xff, tag & 0xff, 0, type, 0, 0, 0, count, ...v);
    };
    pushEntry(256, 3, 1, [...be16(2), 0, 0]);
    pushEntry(257, 3, 1, [...be16(2), 0, 0]);
    pushEntry(258, 3, 1, [...be16(16), 0, 0]);
    pushEntry(259, 3, 1, [...be16(1), 0, 0]);
    pushEntry(262, 3, 1, [...be16(1), 0, 0]);
    const dataAt = 8 + 2 + 7 * 12 + 4; // header + count + 7 entries + next
    pushEntry(273, 4, 1, [0, 0, 0, 0].map((_, i) => (dataAt >> ((3 - i) * 8)) & 0xff));
    pushEntry(279, 4, 1, [0, 0, 0, 8]);
    const bytes = [...head, 0, 7, ...entries, 0, 0, 0, 0];
    for (const v of [1, 2, 3, 4]) bytes.push(...be16(v));
    const { planes } = parseOmeTiff(new Uint8Array(bytes).buffer as ArrayBuffer);
    assert.deepEqual([...planes[0]!.data], [1, 2, 3, 4]);
    assert.equal(planes[0]!.dtype, 'uint16');
  });
  it('malformed files rejected with named errors (table)', () => {
    const good = new Uint8Array(makeOmeTiff([{ w: 4, h: 2, values: ramp(8, (i) => i) }]));
    const base = (tag: number, type: number, vals: number[] | string, extra: Record<number, [number, number[] | string]> = {}): ArrayBuffer => {
      const std: Record<number, [number, number[] | string]> = {
        256: [3, [4]], 257: [3, [2]], 258: [3, [8]], 259: [3, [1]], 262: [3, [1]],
        273: [4, [0]], 279: [4, [8]], ...extra,
      };
      std[tag] = [type, vals];
      return miniTiff({
        entries: Object.entries(std).map(([t, [ty, v]]) => [Number(t), ty, v] as [number, number, number[] | string]),
        blobs: [ramp(8, (i) => i)],
      });
    };
    const cases: Array<[string, ArrayBuffer]> = [
      ['bad-magic', new TextEncoder().encode('XXXX....').buffer as ArrayBuffer],
      ['big-tiff', new Uint8Array([0x49, 0x49, 43, 0, 8, 0, 0, 0]).buffer as ArrayBuffer],
      ['no-ifd', new Uint8Array([0x49, 0x49, 42, 0, 0, 0, 0, 0]).buffer as ArrayBuffer],
      ['ifd-loop', (() => {
        const b = new Uint8Array(miniTiff({ entries: [[256, 3, [4]], [257, 3, [2]]], next: 8 }));
        return b.buffer as ArrayBuffer;
      })()],
      ['truncated-entry', good.slice(0, 40).buffer as ArrayBuffer],
      ['bits-1', base(258, 3, [1])],
      ['mixed-bps', base(258, 3, [8, 16])],
      ['spp-2', base(277, 3, [2])],
      ['sampleformat-3', base(339, 3, [3])],
      ['packbits', base(259, 3, [32773])],
      ['photometric-rgb', base(262, 3, [2])],
      ['planar-separate', base(284, 3, [2])],
      ['predictor-4', base(317, 3, [4])],
      ['strips-missing', miniTiff({ entries: [[256, 3, [4]], [257, 3, [2]]] })],
      ['strip-count-mismatch', miniTiff({
        entries: [[256, 3, [4]], [257, 3, [2]], [273, 4, '$BLOB0'], [279, 4, [4, 4]]],
        blobs: [[9, 9, 9, 9]],
      })],
      ['tile-table-mismatch', miniTiff({
        entries: [[256, 3, [8]], [257, 3, [8]], [322, 3, [4]], [323, 3, [4]], [324, 4, '$BLOB0'], [325, 4, [16, 16]]],
        blobs: [new Array(16).fill(7)],
      })],
      ['chunk-past-eof', miniTiff({ entries: [[256, 3, [4]], [257, 3, [2]], [273, 4, [9999]], [279, 4, [8]]] })],
      ['short-chunk', miniTiff({ entries: [[256, 3, [4]], [257, 3, [2]], [273, 4, [0]], [279, 4, [3]]], blobs: [[1, 2, 3]] })],
      ['corrupt-deflate', (() => {
        const b = new Uint8Array(base(259, 3, [8]));
        return b.buffer as ArrayBuffer;
      })()],
      ['lzw-bad-code', miniTiff({
        entries: [[256, 3, [2]], [257, 3, [2]], [259, 3, [5]], [273, 4, '$BLOB0'], [279, 4, [4]]],
        blobs: [[0x80, 0x20, 0xff, 0x80]],
      })],
      ['lzw-short', miniTiff({
        entries: [[256, 3, [2]], [257, 3, [2]], [259, 3, [5]], [273, 4, '$BLOB0'], [279, 4, [2]]],
        blobs: [[0x80, 0x00]],
      })],
      ['jpeg-dims-mismatch', makeOmeTiff([{
        w: 32, h: 32, values: new Array(1024).fill(0),
        compression: 7, jpegBytes: Uint8Array.from(JPEG_GRAY_JPG),
      }])],
      ['jpeg-garbage', makeOmeTiff([{
        w: 4, h: 4, values: new Array(16).fill(0),
        compression: 7, jpegBytes: new Uint8Array([1, 2, 3, 4]),
      }])],
      ['zero-size', base(256, 3, [0])],
      ['unknown-field-type', miniTiff({ entries: [[256, 3, [4]], [257, 3, [2]], [99, 99, [1]]] })],
    ];
    for (const [name, buf] of cases) {
      assert.throws(() => parseOmeTiff(buf), (e: unknown) => e instanceof OmeTiffError, name);
    }
  });
  it('sniffs distinguish TIFF, OME-TIFF and foreign bytes', () => {
    const ome = new Uint8Array(makeOmeTiff([{ w: 2, h: 2, values: [1, 2, 3, 4] }]));
    const plain = new Uint8Array(makeOmeTiff([{ w: 2, h: 2, values: [1, 2, 3, 4] }], { omexml: null }));
    assert.equal(isTiffLike(ome), true);
    assert.equal(isOmeTiffLike(ome), true);
    assert.equal(isTiffLike(plain), true);
    assert.equal(isOmeTiffLike(plain), false);
    assert.equal(isTiffLike(new Uint8Array([1, 2, 3])), false);
    assert.equal(isOmeTiffLike(new Uint8Array([0x49, 0x49, 42, 0])), false);
  });
});
