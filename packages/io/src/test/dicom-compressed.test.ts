import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { zlibSync } from 'fflate';
import { DicomParseError, parseDicomSlice, parseDicomFrames } from '../dicom-parse.js';
import { stackToVolume } from '../dicom.js';
import { readDataset } from '../dcm-read.js';
import { readEncapsulated } from '../dicom-encap.js';
import { inflateDeflatedDataset } from '../dicom-deflate.js';
import { decodeRLEFrame } from '../dicom-rle.js';
import { decodeJpegBaseline } from '../jpeg-baseline.js';
import { decodeJpegLossless } from '../jpeg-lossless.js';
import { TS_RLE, TS_JPEG_BASELINE_8, TS_JPEG_LOSSLESS_1, TS_DEFLATED } from '../dicom-tags.js';
import {
  JPEG_GRAY_JPG, JPEG_RGB_JPG, JPEG_PROG_JPG,
  JPEG_GRAY_EXPECTED_B64, JPEG_RGB_EXPECTED_B64, b64ToBytes,
} from './fixtures-jpeg.js';

// ---- builders -----------------------------------------------------------

/** Minimal PackBits RLE encoder (test oracle inverse of decodeRLEFrame). */
function rleEncodePlane(plane: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < plane.length) {
    let run = 1;
    while (i + run < plane.length && plane[i + run] === plane[i] && run < 128) run++;
    if (run > 1) {
      out.push(257 - run, plane[i]!);
      i += run;
      continue;
    }
    let lit = 1;
    while (i + lit < plane.length && lit < 128) {
      if (i + lit + 1 < plane.length && plane[i + lit] === plane[i + lit + 1]) break;
      lit++;
    }
    out.push(lit - 1, ...plane.subarray(i, i + lit));
    i += lit;
  }
  return Uint8Array.from(out);
}

/** One RLE frame: 64-byte header + PackBits segments (MSB, LSB). */
function rleEncodeFrame(pixels: Uint8Array, bytesPerPixel: 1 | 2): Uint8Array {
  const n = pixels.length / bytesPerPixel;
  const planes: Uint8Array[] = [];
  if (bytesPerPixel === 1) {
    planes.push(rleEncodePlane(pixels));
  } else {
    const msb = new Uint8Array(n);
    const lsb = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      // input pixels are LE bytes; plane 0 = MSB per DICOM RLE
      lsb[i] = pixels[i * 2]!;
      msb[i] = pixels[i * 2 + 1]!;
    }
    planes.push(rleEncodePlane(msb), rleEncodePlane(lsb));
  }
  const hdr = new Uint8Array(64);
  const dv = new DataView(hdr.buffer);
  dv.setUint32(0, planes.length, true);
  let off = 64;
  const parts: Uint8Array[] = [hdr];
  planes.forEach((p, i) => {
    dv.setUint32(4 + i * 4, off, true);
    off += p.length;
    parts.push(p);
  });
  const out = new Uint8Array(off);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

/**
 * Minimal SOF3 (lossless) JPEG encoder — test oracle inverse of
 * decodeJpegLossless. Single component, one scan, canonical Huffman with
 * code length = SSSS+1. Predictor edge rules mirror the decoder exactly.
 */
function encodeLossless(
  pixels: Uint8Array | Uint16Array,
  w: number,
  h: number,
  precision: 8 | 16,
  predictor: number,
  opts: { pt?: number; dri?: number } = {},
): Uint8Array {
  const get = (x: number, y: number): number => pixels[y * w + x]!;
  const predOf = (x: number, y: number): number => {
    if (x === 0 && y === 0) return 1 << (precision - 1);
    if (y === 0) return get(x - 1, y);
    if (x === 0) return get(x, y - 1);
    const a = get(x - 1, y), b = get(x, y - 1), c = get(x - 1, y - 1);
    switch (predictor) {
      case 1: return a;
      case 2: return b;
      case 3: return c;
      case 4: return a + b - c;
      case 5: return a + ((b - c) >> 1);
      case 6: return b + ((a - c) >> 1);
      case 7: return (a + b) >> 1;
      default: return a; // predictor 0: still emit a stream (decoder must reject Ss)
    }
  };
  const diffs: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) diffs.push(get(x, y) - predOf(x, y));
  }
  const ssssOf = (d: number): number => (d === 0 ? 0 : Math.floor(Math.log2(Math.abs(d))) + 1);
  const used = [...new Set(diffs.map(ssssOf))].sort((a, b) => a - b);
  // canonical codes, length = min(ssss+1, 16): SSSS 16 (full-range 16-bit
  // swings) cannot take length 17, so 15 and 16 share length 16 — still
  // Kraft-compliant (sums to ≤ 1).
  const codes = new Map<number, { code: number; len: number }>();
  let c = 0, cur = 1;
  for (const s of used) {
    const l = Math.min(s + 1, 16);
    c <<= l - cur;
    cur = l;
    codes.set(s, { code: c, len: l });
    c++;
  }
  const bytes: number[] = [];
  let acc = 0, nbits = 0;
  const putBits = (v: number, n: number): void => {
    acc = (acc << n) | v;
    nbits += n;
    while (nbits >= 8) {
      nbits -= 8;
      const b = (acc >> nbits) & 0xff;
      bytes.push(b);
      if (b === 0xff) bytes.push(0x00);
    }
  };
  for (const d of diffs) {
    const s = ssssOf(d);
    const e = codes.get(s)!;
    putBits(e.code, e.len);
    if (s > 0) putBits(d >= 0 ? d : (1 << s) + d - 1, s);
  }
  if (nbits > 0) putBits((1 << (8 - nbits)) - 1, 8 - nbits); // 1-bit fill
  const out: number[] = [0xff, 0xd8];
  const marker = (m: number, body: number[]): void => {
    out.push(0xff, m);
    const L = body.length + 2;
    out.push((L >> 8) & 0xff, L & 0xff, ...body);
  };
  marker(0xc3, [precision, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 1, 1, 0x11, 0]);
  const lens = new Array(16).fill(0);
  for (const s of used) lens[Math.min(s + 1, 16) - 1]++;
  marker(0xc4, [0x00, ...lens, ...used]);
  if (opts.dri !== undefined) marker(0xdd, [(opts.dri >> 8) & 0xff, opts.dri & 0xff]);
  marker(0xda, [1, 1, 0x00, predictor & 0xff, 0, opts.pt ?? 0]);
  out.push(...bytes, 0xff, 0xd9);
  return Uint8Array.from(out);
}

interface EncapSpec {
  tsUID: string;
  rows: number;
  cols: number;
  bitsAllocated: 8 | 16;
  bitsStored?: number;
  pixelRep?: 0 | 1;
  samples?: number;
  photometric?: string;
  fragments: Uint8Array[];
  bot?: number[];
  frames?: number;
}

/** Explicit-LE Part 10 with undefined-length encapsulated pixel data. */
function encapFile(s: EncapSpec): ArrayBuffer {
  const enc = new TextEncoder();
  const b: number[] = new Array(128).fill(0);
  b.push(68, 73, 67, 77);
  const u16 = (v: number): void => { b.push(v & 0xff, (v >> 8) & 0xff); };
  const u32 = (v: number): void => {
    b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  };
  const elem = (g: number, e: number, vr: string, val: number[]): void => {
    b.push(g & 0xff, (g >> 8) & 0xff, e & 0xff, (e >> 8) & 0xff,
      vr.charCodeAt(0), vr.charCodeAt(1));
    if ('OBOWOFUN'.includes(vr) || vr === 'SQ') { b.push(0, 0); u32(val.length); }
    else u16(val.length);
    b.push(...val);
  };
  const us = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
  const padded = (t: string): number[] => {
    const a = [...enc.encode(t)];
    if (a.length % 2 === 1) a.push(0x20);
    return a;
  };
  const meta: number[] = [];
  const mpush = (...xs: number[]): void => { meta.push(...xs); };
  const tsBytes = [...enc.encode(s.tsUID), 0x00];
  if (tsBytes.length % 2 === 1) tsBytes.push(0x00);
  mpush(0x02, 0x00, 0x00, 0x00, 0x55, 0x4c, 0x04, 0x00);
  const glenPos = meta.length;
  mpush(0, 0, 0, 0);
  mpush(0x02, 0x00, 0x10, 0x00, 0x55, 0x49, tsBytes.length & 0xff, (tsBytes.length >> 8) & 0xff, ...tsBytes);
  const glen = meta.length - glenPos - 4;
  meta[glenPos] = glen & 0xff;
  meta[glenPos + 1] = (glen >> 8) & 0xff;
  b.push(...meta);
  elem(0x0028, 0x0010, 'US', us(s.rows));
  elem(0x0028, 0x0011, 'US', us(s.cols));
  elem(0x0028, 0x0100, 'US', us(s.bitsAllocated));
  elem(0x0028, 0x0101, 'US', us(s.bitsStored ?? s.bitsAllocated));
  elem(0x0028, 0x0103, 'US', us(s.pixelRep ?? 0));
  elem(0x0028, 0x0002, 'US', us(s.samples ?? 1));
  if (s.frames !== undefined) {
    elem(0x0028, 0x0008, 'IS', [...enc.encode(String(s.frames)), 0x20]);
  }
  if (s.photometric) elem(0x0028, 0x0004, 'CS', padded(s.photometric));
  // (7FE0,0010) OB undefined length + BOT + fragments + delimiter
  b.push(0xe0, 0x7f, 0x10, 0x00, 0x4f, 0x42, 0x00, 0x00);
  u32(0xffffffff);
  // Unspecified BOT = truly empty (zero-length item), per DICOM: a 4-byte
  // zero item would parse as one offset and break the fragment fallback.
  const bot = s.bot ?? [];
  const botBytes = new Uint8Array(bot.length * 4);
  bot.forEach((o, i) => new DataView(botBytes.buffer).setUint32(i * 4, o, true));
  const item = (frag: Uint8Array): void => {
    b.push(0xfe, 0xff, 0x00, 0xe0);
    u32(frag.length);
    b.push(...frag);
  };
  item(botBytes);
  for (const f of s.fragments) item(f);
  b.push(0xfe, 0xff, 0xdd, 0xe0);
  u32(0);
  return Uint8Array.from(b).buffer as ArrayBuffer;
}

const maxDiff = (a: Uint8Array | Int16Array | Float32Array, c: Uint8Array): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - c[i]!));
  return m;
};

interface NativeSpec {
  tsUID: string;
  rows: number;
  cols: number;
  bitsAllocated: 8 | 16;
  pixelRep?: 0 | 1;
  photometric?: string;
  slope?: number;
  intercept?: number;
  pixels: Uint8Array; // raw LE bytes, all frames concatenated
  deflate?: boolean;
  /** raw RFC-1951 deflate (pydicom 3.x real-world shape) instead of zlib */
  rawDeflate?: boolean;
  groupLength?: boolean; // default true; false covers the scan fallback
  frames?: number;
}

/** Explicit-LE Part 10 with defined-length pixels, optionally deflated. */
function nativeFile(s: NativeSpec): ArrayBuffer {
  const enc = new TextEncoder();
  const b: number[] = new Array(128).fill(0);
  b.push(68, 73, 67, 77);
  const us = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
  const meta: number[] = [];
  const tsBytes = [...enc.encode(s.tsUID), 0x00];
  if (tsBytes.length % 2 === 1) tsBytes.push(0x00);
  meta.push(0x02, 0x00, 0x10, 0x00, 0x55, 0x49, tsBytes.length & 0xff, (tsBytes.length >> 8) & 0xff, ...tsBytes);
  if (s.groupLength ?? true) {
    const full: number[] = [0x02, 0x00, 0x00, 0x00, 0x55, 0x4c, 0x04, 0x00,
      meta.length & 0xff, (meta.length >> 8) & 0xff, (meta.length >> 16) & 0xff, (meta.length >> 24) & 0xff];
    b.push(...full, ...meta);
  } else {
    b.push(...meta);
  }
  const ds: number[] = [];
  const d = (...xs: number[]): void => { ds.push(...xs); };
  const delem = (g: number, e: number, vr: string, val: number[]): void => {
    d(g & 0xff, (g >> 8) & 0xff, e & 0xff, (e >> 8) & 0xff,
      vr.charCodeAt(0), vr.charCodeAt(1), val.length & 0xff, (val.length >> 8) & 0xff, ...val);
  };
  delem(0x0010, 0x0010, 'PN', [...enc.encode('DOE^JOHN'), 0x20]);
  delem(0x0028, 0x0010, 'US', us(s.rows));
  delem(0x0028, 0x0011, 'US', us(s.cols));
  delem(0x0028, 0x0100, 'US', us(s.bitsAllocated));
  delem(0x0028, 0x0101, 'US', us(s.bitsAllocated));
  delem(0x0028, 0x0103, 'US', us(s.pixelRep ?? 0));
  delem(0x0028, 0x0002, 'US', us(1));
  if (s.frames !== undefined) delem(0x0028, 0x0008, 'IS', [...enc.encode(String(s.frames)), 0x20]);
  if (s.photometric) {
    const p = [...enc.encode(s.photometric)];
    if (p.length % 2 === 1) p.push(0x20);
    delem(0x0028, 0x0004, 'CS', p);
  }
  if (s.slope !== undefined) delem(0x0028, 0x1053, 'DS', [...enc.encode(String(s.slope)), 0x20].slice(0, 4));
  if (s.intercept !== undefined) {
    const t = [...enc.encode(String(s.intercept))];
    while (t.length % 2 === 1) t.push(0x20);
    delem(0x0028, 0x1052, 'DS', t);
  }
  // OB defined-length pixels (long-form VR header)
  d(0xe0, 0x7f, 0x10, 0x00, 0x4f, 0x42, 0x00, 0x00);
  const L = s.pixels.length;
  d(L & 0xff, (L >> 8) & 0xff, (L >> 16) & 0xff, (L >> 24) & 0xff);
  for (const px of s.pixels) d(px);
  let file = Uint8Array.from([...b, ...ds]);
  if (s.deflate) {
    const zipped = s.rawDeflate
      ? deflateRawSync(Uint8Array.from(ds))
      : zlibSync(Uint8Array.from(ds));
    file = Uint8Array.from([...b, ...zipped]);
  }
  return file.buffer as ArrayBuffer;
}

// ---- RLE ---------------------------------------------------------------

describe('compressed DICOM', () => {
  it('RLE 8-bit round-trips a gradient', () => {
    const rows = 16, cols = 16;
    const px = new Uint8Array(rows * cols);
    for (let i = 0; i < px.length; i++) px[i] = (i * 7 + ((i >> 4) * 13)) & 255;
    const { slice, meta } = parseDicomSlice(encapFile({
      tsUID: TS_RLE, rows, cols, bitsAllocated: 8,
      fragments: [rleEncodeFrame(px, 1)],
    }));
    assert.equal(meta.transferSyntaxUID, TS_RLE);
    assert.deepEqual([...slice.pixelData], [...px]);
  });
  it('RLE 16-bit round-trips MSB/LSB planes', () => {
    const rows = 8, cols = 12;
    const raw = new Uint16Array(rows * cols);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 257 + 31) & 0xffff;
    const le = new Uint8Array(raw.buffer);
    const { slice } = parseDicomSlice(encapFile({
      tsUID: TS_RLE, rows, cols, bitsAllocated: 16,
      fragments: [rleEncodeFrame(le, 2)],
    }));
    assert.deepEqual([...slice.pixelData], [...raw]);
  });
  it('RLE run/literal shapes decode (table)', () => {
    const cases: { name: string; px: number[] }[] = [
      { name: 'all-run', px: new Array(32).fill(9) },
      { name: 'all-literal', px: Array.from({ length: 32 }, (_, i) => i) },
      { name: 'alternating', px: Array.from({ length: 32 }, (_, i) => (i % 2) * 255) },
      { name: 'single', px: [42] },
    ];
    for (const c of cases) {
      const px = Uint8Array.from(c.px);
      const back = decodeRLEFrame(rleEncodeFrame(px, 1), px.length, 1);
      assert.deepEqual([...back], c.px, c.name);
    }
  });
  it('RLE corruptions throw named errors (table)', () => {
    const good = rleEncodeFrame(Uint8Array.from([1, 2, 3, 4]), 1);
    const dv = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);
    const cases: { name: string; mut: (b: Uint8Array) => Uint8Array }[] = [
      { name: 'segment-count', mut: (x) => { dv(x).setUint32(0, 2, true); return x; } },
      { name: 'bad-offset', mut: (x) => { dv(x).setUint32(4, 7, true); return x; } },
      { name: 'truncated', mut: (x) => x.subarray(0, 66) },
      { name: 'nop-code', mut: (x) => { x[64] = 128; return x; } },
    ];
    for (const c of cases) {
      const bad = c.mut(Uint8Array.from(good));
      assert.throws(
        () => decodeRLEFrame(bad, 4, 1),
        (e: unknown) => e instanceof Error && e.message.startsWith('RLE'),
        c.name,
      );
    }
  });
  it('BOT slices frames; bad framing is loud (table)', () => {
    // two 4px RLE frames concatenated, BOT offsets [0, len1]
    const f1 = rleEncodeFrame(Uint8Array.from([5, 5, 5, 5]), 1);
    const f2 = rleEncodeFrame(Uint8Array.from([1, 2, 3, 4]), 1);
    const both = new Uint8Array(f1.length + f2.length);
    both.set(f1, 0);
    both.set(f2, f1.length);
    const buf = encapFile({
      tsUID: TS_RLE, rows: 2, cols: 2, bitsAllocated: 8,
      fragments: [both], bot: [0, f1.length],
    });
    // single-frame gate: BOT slice [0..f1] decodes to frame 1
    const { slice } = parseDicomSlice(buf);
    assert.deepEqual([...slice.pixelData], [5, 5, 5, 5]);
    // missing sequence delimiter → framing error
    const raw = new Uint8Array(buf);
    const cut = raw.buffer.slice(0, raw.length - 8);
    assert.throws(
      () => parseDicomSlice(cut),
      (e: unknown) => e instanceof DicomParseError && e.kind === 'encapsulated-framing-error',
    );
  });
  it('fragment reader rejects non-item tags', () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0xe0, 4, 0, 0, 0, 1, 2, 3, 4]);
    assert.throws(
      () => readEncapsulated(bytes, new DataView(bytes.buffer), 0),
      (e: unknown) => e instanceof Error && /missing sequence delimiter/.test(e.message),
    );
  });

  // ---- JPEG baseline ----------------------------------------------------

  it('JPEG grayscale fixture matches PIL within 2', () => {
    const { slice, meta } = parseDicomSlice(encapFile({
      tsUID: TS_JPEG_BASELINE_8, rows: 64, cols: 64, bitsAllocated: 8,
      photometric: 'MONOCHROME2',
      fragments: [Uint8Array.from(JPEG_GRAY_JPG)],
    }));
    assert.equal(meta.transferSyntaxUID, TS_JPEG_BASELINE_8);
    assert.ok(maxDiff(slice.pixelData, b64ToBytes(JPEG_GRAY_EXPECTED_B64)) <= 2);
  });
  it('JPEG YBR color fixture folds to luma within 4', () => {
    const { slice } = parseDicomSlice(encapFile({
      tsUID: TS_JPEG_BASELINE_8, rows: 32, cols: 48, bitsAllocated: 8,
      samples: 3, photometric: 'YBR_FULL_422',
      fragments: [Uint8Array.from(JPEG_RGB_JPG)],
    }));
    assert.ok(maxDiff(slice.pixelData, b64ToBytes(JPEG_RGB_EXPECTED_B64)) <= 4);
  });
  it('JPEG split across fragments still decodes', () => {
    const jpg = Uint8Array.from(JPEG_GRAY_JPG);
    const half = jpg.length >> 1;
    const { slice } = parseDicomSlice(encapFile({
      tsUID: TS_JPEG_BASELINE_8, rows: 64, cols: 64, bitsAllocated: 8,
      photometric: 'MONOCHROME2',
      fragments: [jpg.subarray(0, half), jpg.subarray(half)],
    }));
    assert.ok(maxDiff(slice.pixelData, b64ToBytes(JPEG_GRAY_EXPECTED_B64)) <= 2);
  });
  it('JPEG boundaries are loud (table)', () => {
    const gray = Uint8Array.from(JPEG_GRAY_JPG);
    const mk = (over: Partial<EncapSpec>): ArrayBuffer => encapFile({
      tsUID: TS_JPEG_BASELINE_8, rows: 64, cols: 64, bitsAllocated: 8,
      photometric: 'MONOCHROME2', fragments: [gray], ...over,
    });
    const cases: { name: string; buf: ArrayBuffer; kind: string }[] = [
      {
        name: 'progressive-SOF2',
        buf: mk({ fragments: [Uint8Array.from(JPEG_PROG_JPG)] }),
        kind: 'jpeg-decode-error',
      },
      {
        name: 'dims-mismatch',
        buf: mk({ rows: 32 }),
        kind: 'jpeg-decode-error',
      },
      {
        name: 'wrong-photometric',
        buf: mk({ photometric: 'PALETTE COLOR' }),
        kind: 'jpeg-unsupported',
      },
      {
        name: '16-bit-JPEG',
        buf: mk({ bitsAllocated: 16 }),
        kind: 'jpeg-unsupported',
      },
    ];
    for (const c of cases) {
      assert.throws(
        () => parseDicomSlice(c.buf),
        (e: unknown) => e instanceof DicomParseError && e.kind === c.kind,
        c.name,
      );
    }
    // bare decoder also rejects 12-bit-style precision edits loudly
    assert.throws(() => decodeJpegBaseline(Uint8Array.from([1, 2, 3])), /JPEG no-soi/);
  });
  it('JPEG-LS near-lossless TS still rejected; baseline port entry matches', () => {
    // ...4.81 (near-lossless, NEAR>0) has no decoder here — only the
    // lossless ...4.80 path decodes (see dicom-jpegls.test.ts).
    const buf = encapFile({
      tsUID: '1.2.840.10008.1.2.4.81', rows: 1, cols: 1, bitsAllocated: 8,
      fragments: [Uint8Array.from([0])],
    });
    assert.throws(
      () => parseDicomSlice(buf),
      (e: unknown) => e instanceof DicomParseError && e.kind === 'unsupported-transfer-syntax',
    );
    // direct port entry agrees with the loader path on the gray fixture
    const dec = decodeJpegBaseline(Uint8Array.from(JPEG_GRAY_JPG));
    assert.equal(dec.width, 64);
    assert.equal(dec.components, 1);
    assert.ok(maxDiff(dec.gray, b64ToBytes(JPEG_GRAY_EXPECTED_B64)) <= 2);
  });
  // ---- JPEG lossless (SOF3) -------------------------------------------

  it('lossless exact round-trip, predictors 1-7 (table)', () => {
    const w = 8, h = 8;
    const px = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) px[y * w + x] = (x * 17 + y * 29 + ((x * y) & 31)) & 255;
    }
    for (let pred = 1; pred <= 7; pred++) {
      const jpg = encodeLossless(px, w, h, 8, pred);
      const { slice, meta } = parseDicomSlice(encapFile({
        tsUID: TS_JPEG_LOSSLESS_1, rows: h, cols: w, bitsAllocated: 8,
        photometric: 'MONOCHROME2', fragments: [jpg],
      }));
      assert.equal(meta.transferSyntaxUID, TS_JPEG_LOSSLESS_1, `pred ${pred} ts`);
      assert.deepEqual([...slice.pixelData], [...px], `predictor ${pred}`);
    }
  });
  it('lossless 16-bit exact round-trip', () => {
    const w = 6, h = 5;
    const px = new Uint16Array(w * h);
    for (let i = 0; i < px.length; i++) px[i] = (i * 1234 + 7) % 30000;
    const jpg = encodeLossless(px, w, h, 16, 4);
    const { slice } = parseDicomSlice(encapFile({
      tsUID: TS_JPEG_LOSSLESS_1, rows: h, cols: w, bitsAllocated: 16,
      photometric: 'MONOCHROME2', fragments: [jpg],
    }));
    assert.deepEqual([...slice.pixelData], [...px]);
    // full-range values bypass the slice Int16Array: direct port entry must
    // reproduce the LE bytes bit-exactly (decoder output is correct even
    // where the display pipeline wraps)
    const big = Uint16Array.from([0, 255, 256, 32767, 32768, 40000, 65535, 1]);
    const jpgBig = encodeLossless(big, 4, 2, 16, 7);
    const dec = decodeJpegLossless(jpgBig);
    assert.equal(dec.bits, 16);
    assert.deepEqual([...dec.bytes], [...new Uint8Array(big.buffer)]);
  });
  it('lossless boundaries are loud (table)', () => {
    const w = 4, h = 4;
    const px = new Uint8Array(w * h).fill(128);
    const cases: { name: string; jpg: Uint8Array; kind: 'jpeg-decode-error' | 'jpeg-unsupported' }[] = [
      {
        name: 'baseline-SOF0-in-lossless-path',
        jpg: Uint8Array.from(JPEG_GRAY_JPG),
        kind: 'jpeg-decode-error',
      },
      {
        name: 'point-transform',
        jpg: encodeLossless(px, w, h, 8, 1, { pt: 2 }),
        kind: 'jpeg-decode-error',
      },
      {
        name: 'restart-interval',
        jpg: encodeLossless(px, w, h, 8, 1, { dri: 4 }),
        kind: 'jpeg-decode-error',
      },
      {
        name: 'bad-predictor',
        jpg: encodeLossless(px, w, h, 8, 0),
        kind: 'jpeg-decode-error',
      },
      {
        name: 'container-mismatch',
        jpg: encodeLossless(px, w, h, 8, 1),
        kind: 'jpeg-unsupported',
      },
    ];
    for (const c of cases) {
      const spec: EncapSpec = c.name === 'container-mismatch'
        ? {
          tsUID: TS_JPEG_LOSSLESS_1, rows: h, cols: w, bitsAllocated: 16,
          photometric: 'MONOCHROME2', fragments: [c.jpg],
        }
        : {
          tsUID: TS_JPEG_LOSSLESS_1, rows: h, cols: w, bitsAllocated: c.name.startsWith('baseline') ? 8 : 8,
          photometric: 'MONOCHROME2', fragments: [c.jpg],
        };
      // baseline fixture is 64x64: dims must match the declared rows/cols
      if (c.name.startsWith('baseline')) {
        spec.rows = 64;
        spec.cols = 64;
      }
      assert.throws(
        () => parseDicomSlice(encapFile(spec)),
        (e: unknown) => e instanceof DicomParseError && e.kind === c.kind,
        c.name,
      );
    }
  });

  it('compressed TS with native pixels rejected', () => {
    // hand-built: RLE syntax but defined-length pixel data (corrupt mixer)
    const enc = new TextEncoder();
    const b: number[] = new Array(128).fill(0);
    b.push(68, 73, 67, 77);
    const u32 = (v: number): void => {
      b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
    };
    b.push(0x02, 0x00, 0x00, 0x00, 0x55, 0x4c, 0x04, 0x00);
    u32(30);
    const ts = [...enc.encode(TS_RLE), 0x00, 0x00];
    b.push(0x02, 0x00, 0x10, 0x00, 0x55, 0x49, ts.length & 0xff, (ts.length >> 8) & 0xff, ...ts);
    const elem = (g: number, e: number, vr: string, val: number[]): void => {
      b.push(g & 0xff, (g >> 8) & 0xff, e & 0xff, (e >> 8) & 0xff,
        vr.charCodeAt(0), vr.charCodeAt(1), val.length & 0xff, (val.length >> 8) & 0xff, ...val);
    };
    elem(0x0028, 0x0010, 'US', [1, 0]);
    elem(0x0028, 0x0011, 'US', [1, 0]);
    elem(0x0028, 0x0100, 'US', [8, 0]);
    elem(0x7fe0, 0x0010, 'OB', [0, 0]);
    b.push(0, 0);
    assert.throws(
      () => parseDicomSlice(Uint8Array.from(b).buffer as ArrayBuffer),
      (e: unknown) => e instanceof DicomParseError && e.kind === 'encapsulated-framing-error',
    );
  });

  // ---- deflated transfer syntax -----------------------------------------

  it('deflated 8-bit + 16-bit-rescale round-trip (table)', () => {
    const cases: { name: string; spec: NativeSpec; expected: number[] }[] = [
      {
        name: '8-bit ramp',
        spec: {
          tsUID: TS_DEFLATED, rows: 4, cols: 4, bitsAllocated: 8,
          photometric: 'MONOCHROME2', pixels: Uint8Array.from({ length: 16 }, (_, i) => i * 16),
          deflate: true,
        },
        expected: Array.from({ length: 16 }, (_, i) => i * 16),
      },
      {
        name: '16-bit rescale',
        spec: {
          tsUID: TS_DEFLATED, rows: 2, cols: 2, bitsAllocated: 16,
          photometric: 'MONOCHROME2', slope: 2, intercept: -100,
          pixels: Uint8Array.from([232, 3, 208, 7, 184, 11, 160, 15]), // 1000,2000,3000,4000 LE
          deflate: true,
        },
        expected: [1900, 3900, 5900, 7900],
      },
    ];
    for (const c of cases) {
      const { slice, meta } = parseDicomSlice(nativeFile(c.spec));
      assert.equal(meta.transferSyntaxUID, TS_DEFLATED, c.name);
      assert.deepEqual([...slice.pixelData], c.expected, c.name);
    }
  });
  it('deflated readDataset path exposes text', () => {
    const buf = nativeFile({
      tsUID: TS_DEFLATED, rows: 1, cols: 1, bitsAllocated: 8,
      pixels: Uint8Array.from([7]), deflate: true,
    });
    assert.equal(readDataset(buf).text('00100010'), 'DOE^JOHN');
  });
  // ---- R2 corpora: pinned pydicom bytes off disk --------------------------

  it('R2 foundry rle-lossless.dcm decodes bit-exact off disk', () => {
    // Hand-packed DICOM RLE frame (test/e2e/foundry/rle-lossless.dcm):
    // encapsulated ...5, 8x8 8-bit, row 0 = 0..7 ramp, rest flat 64.
    // Guards the real Part-10 path, not just the rleEncodeFrame harness.
    const raw = readFileSync(join(process.cwd(), 'test', 'e2e', 'foundry', 'rle-lossless.dcm'));
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    const { slice, meta } = parseDicomSlice(buf);
    assert.equal(meta.transferSyntaxUID, TS_RLE);
    assert.equal(meta.rows, 8);
    assert.equal(meta.cols, 8);
    const want = new Array(64).fill(64);
    for (let c = 0; c < 8; c++) want[c] = c;
    assert.deepEqual([...slice.pixelData], want);
  });

  // ---- multi-frame --------------------------------------------------------

  it('native 3-frame splits in file order; slice path stays single', () => {
    const frame = (v: number): Uint8Array => new Uint8Array(4).fill(v);
    const px = new Uint8Array(12);
    px.set(frame(10), 0);
    px.set(frame(20), 4);
    px.set(frame(30), 8);
    const buf = nativeFile({
      tsUID: '1.2.840.10008.1.2.1', rows: 2, cols: 2, bitsAllocated: 8,
      pixels: px, frames: 3,
    });
    const all = parseDicomFrames(buf);
    assert.equal(all.length, 3);
    assert.equal(all[0]!.meta.numberOfFrames, 3);
    assert.ok(all[0]!.meta === all[1]!.meta, 'meta shared across frames');
    assert.deepEqual([...all[0]!.slice.pixelData], [10, 10, 10, 10]);
    assert.deepEqual([...all[1]!.slice.pixelData], [20, 20, 20, 20]);
    assert.deepEqual([...all[2]!.slice.pixelData], [30, 30, 30, 30]);
    assert.throws(
      () => parseDicomSlice(buf),
      (e: unknown) => e instanceof DicomParseError && e.kind === 'multi-frame-unsupported',
    );
  });
  it('RLE 2-frame via BOT + fragment-per-frame (table)', () => {
    const f1 = rleEncodeFrame(new Uint8Array(4).fill(5), 1);
    const f2 = rleEncodeFrame(Uint8Array.from([1, 2, 3, 4]), 1);
    const both = new Uint8Array(f1.length + f2.length);
    both.set(f1, 0);
    both.set(f2, f1.length);
    const cases: { name: string; spec: EncapSpec }[] = [
      {
        name: 'bot-sliced',
        spec: {
          tsUID: TS_RLE, rows: 2, cols: 2, bitsAllocated: 8,
          fragments: [both], bot: [0, f1.length], frames: 2,
        },
      },
      {
        name: 'fragment-per-frame',
        spec: {
          tsUID: TS_RLE, rows: 2, cols: 2, bitsAllocated: 8,
          fragments: [f1, f2], frames: 2,
        },
      },
    ];
    for (const c of cases) {
      const all = parseDicomFrames(encapFile(c.spec));
      assert.equal(all.length, 2, c.name);
      assert.deepEqual([...all[0]!.slice.pixelData], [5, 5, 5, 5], `${c.name} frame 0`);
      assert.deepEqual([...all[1]!.slice.pixelData], [1, 2, 3, 4], `${c.name} frame 1`);
    }
  });
  it('JPEG baseline 2-frame decodes both', () => {
    const gray = Uint8Array.from(JPEG_GRAY_JPG);
    const all = parseDicomFrames(encapFile({
      tsUID: TS_JPEG_BASELINE_8, rows: 64, cols: 64, bitsAllocated: 8,
      photometric: 'MONOCHROME2', fragments: [gray, gray], frames: 2,
    }));
    assert.equal(all.length, 2);
    const exp = b64ToBytes(JPEG_GRAY_EXPECTED_B64);
    assert.ok(maxDiff(all[0]!.slice.pixelData, exp) <= 2);
    assert.ok(maxDiff(all[1]!.slice.pixelData, exp) <= 2);
  });
  it('lossless 2-frame exact, distinct pixels', () => {
    const a = Uint8Array.from({ length: 16 }, (_, i) => i * 4);
    const b = Uint8Array.from({ length: 16 }, (_, i) => 255 - i * 3);
    const all = parseDicomFrames(encapFile({
      tsUID: TS_JPEG_LOSSLESS_1, rows: 4, cols: 4, bitsAllocated: 8,
      photometric: 'MONOCHROME2',
      fragments: [encodeLossless(a, 4, 4, 8, 4), encodeLossless(b, 4, 4, 8, 7)],
      frames: 2,
    }));
    assert.equal(all.length, 2);
    assert.deepEqual([...all[0]!.slice.pixelData], [...a]);
    assert.deepEqual([...all[1]!.slice.pixelData], [...b]);
  });
  it('frame count mismatch is loud (table)', () => {
    const gray = Uint8Array.from(JPEG_GRAY_JPG);
    const rle = rleEncodeFrame(new Uint8Array(4).fill(1), 1);
    const cases: { name: string; buf: () => ArrayBuffer; kind: string }[] = [
      {
        name: 'jpeg-groups-vs-declared',
        buf: () => encapFile({
          tsUID: TS_JPEG_BASELINE_8, rows: 64, cols: 64, bitsAllocated: 8,
          photometric: 'MONOCHROME2', fragments: [gray], frames: 2,
        }),
        kind: 'jpeg-decode-error',
      },
      {
        name: 'rle-fragments-without-bot',
        buf: () => encapFile({
          tsUID: TS_RLE, rows: 2, cols: 2, bitsAllocated: 8,
          fragments: [rle], frames: 2,
        }),
        kind: 'rle-decode-error',
      },
      {
        name: 'native-short',
        buf: () => nativeFile({
          tsUID: '1.2.840.10008.1.2.1', rows: 2, cols: 2, bitsAllocated: 8,
          pixels: new Uint8Array(4).fill(1), frames: 2,
        }),
        kind: 'truncated',
      },
    ];
    for (const c of cases) {
      assert.throws(
        () => parseDicomFrames(c.buf()),
        (e: unknown) => e instanceof DicomParseError && e.kind === c.kind,
        c.name,
      );
    }
  });
  it('stacking multi-frame file keeps frame order', () => {
    const px = new Uint8Array(8);
    px.set(new Uint8Array(4).fill(10), 0);
    px.set(new Uint8Array(4).fill(20), 4);
    const all = parseDicomFrames(nativeFile({
      tsUID: '1.2.840.10008.1.2.1', rows: 2, cols: 2, bitsAllocated: 8,
      pixels: px, frames: 2,
    }));
    const vol = stackToVolume(all.map((s) => s.slice));
    assert.deepEqual(vol.dims, [2, 2, 2]);
    assert.deepEqual([...vol.data], [10, 10, 10, 10, 20, 20, 20, 20]);
  });

  it('deflate passthrough + failures are loud (table)', () => {
    // non-deflated buffer returns untouched (same object, zero copy)
    const plain = nativeFile({
      tsUID: '1.2.840.10008.1.2.1', rows: 1, cols: 1, bitsAllocated: 8,
      pixels: Uint8Array.from([9]),
    });
    assert.ok(inflateDeflatedDataset(plain) === plain, 'passthrough identity');
    // no (0002,0000): scan fallback still finds the dataset
    const noGL = nativeFile({
      tsUID: TS_DEFLATED, rows: 1, cols: 2, bitsAllocated: 8,
      pixels: Uint8Array.from([3, 4]), deflate: true, groupLength: false,
    });
    assert.deepEqual([...parseDicomSlice(noGL).slice.pixelData], [3, 4]);
    // raw-deflate payload (pydicom 3.x real-world shape) decodes too
    assert.deepEqual([...parseDicomSlice(nativeFile({
      tsUID: TS_DEFLATED, rows: 1, cols: 2, bitsAllocated: 8,
      pixels: Uint8Array.from([5, 6]), deflate: true, rawDeflate: true,
    })).slice.pixelData], [5, 6]);
    // garbage zlib payload with deflated TS → named error, not a misparse
    const bad = new Uint8Array(nativeFile({
      tsUID: TS_DEFLATED, rows: 1, cols: 1, bitsAllocated: 8,
      pixels: Uint8Array.from([9]), deflate: true,
    }));
    bad.fill(0x41, bad.length - 12);
    assert.throws(
      () => parseDicomSlice(bad.buffer as ArrayBuffer),
      (e: unknown) => e instanceof DicomParseError && e.kind === 'deflate-error',
      'corrupt zlib',
    );
  });
});
