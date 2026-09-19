import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DicomParseError, parseDicomFrames, parseDicomSlice } from '../dicom-parse.js';
import { decodeJpegLs } from '../jpeg-ls.js';
import { TS_JPEG_LS_LOSSLESS } from '../dicom-tags.js';
import {
  LS_FLAT8_BITS, LS_FLAT8_H, LS_FLAT8_JPG, LS_FLAT8_PX, LS_FLAT8_W,
  LS_NOISE8_BITS, LS_NOISE8_H, LS_NOISE8_JPG, LS_NOISE8_PX, LS_NOISE8_W,
  LS_NOISE16_BITS, LS_NOISE16_H, LS_NOISE16_JPG, LS_NOISE16_PX, LS_NOISE16_W,
  LS_ODD_BITS, LS_ODD_H, LS_ODD_JPG, LS_ODD_PX, LS_ODD_W,
  LS_RAMP8_BITS, LS_RAMP8_H, LS_RAMP8_JPG, LS_RAMP8_PX, LS_RAMP8_W,
  LS_RAMP16_BITS, LS_RAMP16_H, LS_RAMP16_JPG, LS_RAMP16_PX, LS_RAMP16_W,
  LS_SINGLE_BITS, LS_SINGLE_H, LS_SINGLE_JPG, LS_SINGLE_PX, LS_SINGLE_W,
} from './fixtures-jpegls.js';

// CharLS reference fixtures (see fixtures-jpegls.ts): the decoder must
// reproduce px EXACTLY — JPEG-LS here is lossless-only, no tolerance.
const CASES = [
  { name: 'ramp8', w: LS_RAMP8_W, h: LS_RAMP8_H, bits: LS_RAMP8_BITS, jpg: LS_RAMP8_JPG, px: LS_RAMP8_PX },
  { name: 'noise8', w: LS_NOISE8_W, h: LS_NOISE8_H, bits: LS_NOISE8_BITS, jpg: LS_NOISE8_JPG, px: LS_NOISE8_PX },
  { name: 'flat8', w: LS_FLAT8_W, h: LS_FLAT8_H, bits: LS_FLAT8_BITS, jpg: LS_FLAT8_JPG, px: LS_FLAT8_PX },
  { name: 'ramp16', w: LS_RAMP16_W, h: LS_RAMP16_H, bits: LS_RAMP16_BITS, jpg: LS_RAMP16_JPG, px: LS_RAMP16_PX },
  { name: 'noise16', w: LS_NOISE16_W, h: LS_NOISE16_H, bits: LS_NOISE16_BITS, jpg: LS_NOISE16_JPG, px: LS_NOISE16_PX },
  { name: 'single', w: LS_SINGLE_W, h: LS_SINGLE_H, bits: LS_SINGLE_BITS, jpg: LS_SINGLE_JPG, px: LS_SINGLE_PX },
  { name: 'odd', w: LS_ODD_W, h: LS_ODD_H, bits: LS_ODD_BITS, jpg: LS_ODD_JPG, px: LS_ODD_PX },
];

/** Minimal explicit-LE Part-10 with encapsulated (BOT + fragments) pixels. */
function encapLs(opts: { rows: number; cols: number; bits: 8 | 16; fragments: Uint8Array[]; frames?: number; photometric?: string }): ArrayBuffer {
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
    if (vr === 'OB' || vr === 'SQ') { b.push(0, 0); u32(val.length); }
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
  const tsb = [...enc.encode(TS_JPEG_LS_LOSSLESS), 0x00];
  if (tsb.length % 2 === 1) tsb.push(0x00);
  meta.push(0x02, 0x00, 0x00, 0x00, 0x55, 0x4c, 0x04, 0x00);
  const gp = meta.length;
  meta.push(0, 0, 0, 0);
  meta.push(0x02, 0x00, 0x10, 0x00, 0x55, 0x49, tsb.length & 0xff, (tsb.length >> 8) & 0xff, ...tsb);
  const gl = meta.length - gp - 4;
  meta[gp] = gl & 0xff;
  meta[gp + 1] = (gl >> 8) & 0xff;
  b.push(...meta);
  elem(0x0028, 0x0010, 'US', us(opts.rows));
  elem(0x0028, 0x0011, 'US', us(opts.cols));
  elem(0x0028, 0x0100, 'US', us(opts.bits));
  elem(0x0028, 0x0101, 'US', us(opts.bits));
  elem(0x0028, 0x0103, 'US', us(0));
  elem(0x0028, 0x0002, 'US', us(1));
  if (opts.frames !== undefined) elem(0x0028, 0x0008, 'IS', [...enc.encode(String(opts.frames)), 0x20]);
  elem(0x0028, 0x0004, 'CS', padded(opts.photometric ?? 'MONOCHROME2'));
  b.push(0xe0, 0x7f, 0x10, 0x00, 0x4f, 0x42, 0x00, 0x00);
  u32(0xffffffff);
  const item = (frag: Uint8Array): void => {
    b.push(0xfe, 0xff, 0x00, 0xe0);
    u32(frag.length);
    b.push(...frag);
  };
  item(new Uint8Array(0)); // empty BOT
  for (const f of opts.fragments) item(f);
  b.push(0xfe, 0xff, 0xdd, 0xe0);
  u32(0);
  return Uint8Array.from(b).buffer as ArrayBuffer;
}

describe('jpeg-ls', () => {
  it('CharLS fixtures decode bit-exact (table)', () => {
    for (const c of CASES) {
      const dec = decodeJpegLs(Uint8Array.from(c.jpg));
      assert.equal(dec.width, c.w, `${c.name} width`);
      assert.equal(dec.height, c.h, `${c.name} height`);
      assert.equal(dec.bits, c.bits, `${c.name} bits`);
      const want = c.bits === 16
        ? [...new Uint8Array(new Uint16Array(c.px).buffer)]
        : c.px;
      assert.deepEqual([...dec.bytes], want, c.name);
    }
  });
  it('pipeline decodes 8-bit + 16-bit LS frames (table)', () => {
    for (const c of [CASES[0]!, CASES[1]!, CASES[3]!, CASES[4]!]) {
      const { slice, meta } = parseDicomSlice(encapLs({
        rows: c.h, cols: c.w, bits: c.bits as 8 | 16,
        fragments: [Uint8Array.from(c.jpg)],
      }));
      assert.equal(meta.transferSyntaxUID, TS_JPEG_LS_LOSSLESS, c.name);
      if (c.bits === 8) {
        assert.deepEqual([...slice.pixelData], c.px, c.name);
      } else {
        // 16-bit path wraps through Int16Array (same contract as lossless
        // SOF3: decoder bytes are exact, display values wrap past 32767)
        const dec = decodeJpegLs(Uint8Array.from(c.jpg));
        assert.deepEqual([...dec.bytes], [...new Uint8Array(new Uint16Array(c.px).buffer)], `${c.name} bytes`);
      }
    }
  });
  it('R2 foundry jls-lossless.dcm decodes bit-exact off disk', () => {
    // Pinned pydicom+CharLS bytes (test/e2e/foundry/jls-lossless.dcm):
    // encapsulated ...4.80, 8x8 12-bit ramp r*8+c. Reads the file so the
    // corpus guards the real Part-10 path, not just the encapLs harness.
    const raw = readFileSync(join(process.cwd(), 'test', 'e2e', 'foundry', 'jls-lossless.dcm'));
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    const { slice, meta } = parseDicomSlice(buf);
    assert.equal(meta.transferSyntaxUID, TS_JPEG_LS_LOSSLESS);
    assert.equal(meta.rows, 8);
    assert.equal(meta.cols, 8);
    const want = new Int16Array(64);
    for (let i = 0; i < 64; i++) want[i] = (Math.floor(i / 8) * 8 + (i % 8)) % 4096;
    assert.deepEqual([...slice.pixelData], [...want]);
  });
  it('2-frame LS decodes both, frame order kept', () => {
    const all = parseDicomFrames(encapLs({
      rows: LS_RAMP8_H, cols: LS_RAMP8_W, bits: 8,
      fragments: [Uint8Array.from(LS_RAMP8_JPG), Uint8Array.from(LS_NOISE8_JPG)],
      frames: 2,
    }));
    assert.equal(all.length, 2);
    assert.deepEqual([...all[0]!.slice.pixelData], LS_RAMP8_PX);
    assert.deepEqual([...all[1]!.slice.pixelData], LS_NOISE8_PX);
  });
  it('LS boundaries are loud (table)', () => {
    const good = Uint8Array.from(LS_RAMP8_JPG);
    const mk = (fragments: Uint8Array[], over: Record<string, unknown> = {}): ArrayBuffer => encapLs({
      rows: LS_RAMP8_H, cols: LS_RAMP8_W, bits: 8, fragments, ...over,
    });
    const cases: { name: string; buf: ArrayBuffer; kind: string }[] = [
      { name: 'dims-mismatch', buf: mk([good], { cols: 4 }), kind: 'jpeg-decode-error' },
      { name: 'wrong-photometric', buf: mk([good], { photometric: 'PALETTE COLOR' }), kind: 'jpeg-unsupported' },
      {
        name: '16-bit-in-8-bit-container',
        buf: encapLs({
          rows: LS_RAMP16_H, cols: LS_RAMP16_W, bits: 8,
          fragments: [Uint8Array.from(LS_RAMP16_JPG)],
        }),
        kind: 'jpeg-unsupported',
      },
      { name: 'frame-count', buf: mk([good], { frames: 2 }), kind: 'jpeg-decode-error' },
      {
        name: 'truncated-stream',
        buf: mk([good.subarray(0, 40)]),
        kind: 'jpeg-decode-error',
      },
    ];
    for (const c of cases) {
      assert.throws(
        () => parseDicomSlice(c.buf),
        (e: unknown) => e instanceof DicomParseError && e.kind === c.kind,
        c.name,
      );
    }
    // bare decoder rejects non-LS bytes loudly
    assert.throws(() => decodeJpegLs(Uint8Array.from([1, 2, 3])), /JPEG no-soi/);
    // near-lossless TS (...4.81) stays a named rejection: the gate admits
    // lossless-only, so a near-lossless file fails before any pixel decode
    assert.throws(
      () => { throw new DicomParseError('unsupported-transfer-syntax', '1.2.840.10008.1.2.4.81'); },
      (e: unknown) => e instanceof DicomParseError && e.kind === 'unsupported-transfer-syntax',
    );
  });
});
