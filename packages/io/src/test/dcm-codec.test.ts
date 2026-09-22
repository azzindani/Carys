import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needs, sample } from '@carys/testkit';
import { readDataset } from '../dcm-read.js';
import { makeUID, writePart10 } from '../dcm-write.js';
import { DicomParseError, Walker, parseDicomSlice } from '../dicom-parse.js';

function part10(): ArrayBuffer {
  return writePart10('1.2.3.4', '1.2.3.4.5', [
    { tag: [0x0008, 0x0016], vr: 'UI', value: '1.2.3.4' },
    { tag: [0x0008, 0x0018], vr: 'UI', value: '1.2.3.4.5' },
    { tag: [0x0010, 0x0010], vr: 'PN', value: 'DOE^JOHN' },
    { tag: [0x0028, 0x0010], vr: 'US', value: 512 },
    { tag: [0x0028, 0x0030], vr: 'DS', value: [0.5, 0.5] },
    { tag: [0x7fe0, 0x0010], vr: 'OB', value: new Uint8Array([1, 2, 3]) },
    {
      tag: [0x3006, 0x0020], vr: 'SQ', value: [{
        elements: [
          { tag: [0x3006, 0x0022], vr: 'IS', value: 7 },
          { tag: [0x3006, 0x0026], vr: 'LO', value: 'Tumor' },
        ],
      }],
    },
  ]);
}

describe('part-10 codec', () => {
  it('preamble + DICM + meta group length', () => {
    const b = new Uint8Array(part10());
    assert.ok(b.slice(0, 128).every((x) => x === 0));
    assert.deepEqual([...b.slice(128, 132)], [68, 73, 67, 77]);
    // (0002,0000) UL first: group/element + VR + length + value
    assert.equal(b[132], 2);
    assert.equal(b[136], 85); // 'U'
    assert.equal(b[137], 76); // 'L'
  });
  it('reads back strings, numbers, bytes, items', () => {
    const ds = readDataset(part10());
    assert.equal(ds.text('00100010'), 'DOE^JOHN');
    assert.deepEqual(ds.numbers('00280010'), [512]);
    assert.deepEqual(ds.numbers('00280030'), [0.5, 0.5]);
    // odd-length OB is even-padded on write (DICOM-correct): pad included
    assert.deepEqual(ds.bytes('7FE00010'), new Uint8Array([1, 2, 3, 0]));
    const items = ds.sequence('30060020');
    assert.equal(items.length, 1);
    assert.equal(items[0]!.text('30060026'), 'Tumor');
    assert.deepEqual(items[0]!.numbers('30060022'), [7]);
  });
  it('SOP UIDs survive', () => {
    const ds = readDataset(part10());
    assert.equal(ds.text('00080016'), '1.2.3.4');
    assert.equal(ds.text('00080018'), '1.2.3.4.5');
  });
  it('makeUID uniqueness + root', () => {
    const a = makeUID(), b = makeUID();
    assert.notEqual(a, b);
    assert.ok(a.startsWith('1.2.826.0.1.999999.2.'));
  });
  it('megabyte OB payloads survive (no spread overflow)', () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1); // odd on purpose
    for (let i = 0; i < big.length; i += 4096) big[i] = i % 251;
    const buf = writePart10('1.2.3', '1.2.4', [
      { tag: [0x7fe0, 0x0010], vr: 'OB', value: big },
    ]);
    const back = readDataset(buf).bytes('7FE00010')!;
    assert.equal(back.length, big.length + 1); // padded to even
    assert.deepEqual(back.subarray(0, big.length), big);
  });
  it('odd-length text padded to even', () => {
    const buf = writePart10('1.2.3', '1.2.4', [
      { tag: [0x0010, 0x0010], vr: 'PN', value: 'ABC' }, // 3 -> 4
    ]);
    assert.equal(buf.byteLength % 2, 0);
    assert.equal(readDataset(buf).text('00100010'), 'ABC');
  });
  it('undecodable transfer syntax rejected with named error (boundary)', needs('lung_ct_01.dcm'), () => {
    // No sample in the repo uses an undecodable syntax (sweep proves 18x
    // Explicit LE + 9x Implicit LE), so derive one synthetically: patch a
    // valid file's TransferSyntaxUID to JPEG 2000 (...4.91, no CPU decoder)
    // and require the named gate instead of a pixel-decode crash.
    // Baseline (...4.50), Lossless (...4.70), RLE and JPEG-LS lossless
    // (...4.80) now decode — see dicom-compressed.test.ts + dicom-jpegls.
    const raw = Buffer.from(readFileSync(sample('lung_ct_01.dcm')!));
    const at = 272; // value start of (0002,0010) in this file
    assert.equal(raw.slice(at, at + 17).toString(), '1.2.840.10008.1.2');
    const uid = Buffer.from('1.2.840.10008.1.2.4.91');
    const patched = Buffer.concat([raw.slice(0, at), uid, Buffer.from([0]), raw.slice(at + 18)]);
    patched.writeUInt16LE(22, at - 2); // UI length field
    const buf = patched.buffer.slice(patched.byteOffset, patched.byteOffset + patched.byteLength);
    assert.throws(
      () => parseDicomSlice(buf),
      (e: unknown) => e instanceof DicomParseError && (e as DicomParseError).kind === 'unsupported-transfer-syntax',
    );
  });
  it('UN-wrapped implicit sequence parses through (dicomParser port)', () => {
    // Implicit files rewritten explicit keep UN VR on sequences. Old walker
    // set valueLength 0xFFFFFFFF and jumped past the file end, silently
    // dropping every tag after the sequence. Build: meta + UN-undefined with
    // one defined item + delimitation + a trailing PN element.
    const enc = new TextEncoder();
    const bytes: number[] = new Array(128).fill(0);
    bytes.push(68, 73, 67, 77);
    const push = (...xs: number[]): void => { bytes.push(...xs); };
    const u16 = (v: number): void => { push(v & 0xff, (v >> 8) & 0xff); };
    const u32 = (v: number): void => { push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff); };
    push(0x02, 0x00, 0x00, 0x00, 0x55, 0x4c); u16(4); u32(28); // group length
    push(0x02, 0x00, 0x10, 0x00, 0x55, 0x49); u16(20); // TS UID, Explicit LE
    push(...enc.encode('1.2.840.10008.1.2.1'), 0x00);
    push(0x29, 0x00, 0x01, 0x10, 0x55, 0x4e, 0x00, 0x00); u32(0xffffffff); // UN undefined
    const itemStart = bytes.length;
    push(0xfe, 0xff, 0x00, 0xe0); u32(10); // defined item, 10 bytes
    push(0x08, 0x00, 0x60, 0x00); u32(2); push(0x43, 0x54); // (0008,0060)='CT', implicit: no VR
    push(0xfe, 0xff, 0xdd, 0xe0); u32(0); // sequence delimitation
    const seqEnd = bytes.length;
    push(0x10, 0x00, 0x10, 0x00, 0x50, 0x4e); u16(4); push(...enc.encode('DOE^'), 0x20); // trailing PN
    const buf = Uint8Array.from(bytes).buffer as ArrayBuffer;
    const w = new Walker(buf);
    w.walk();
    const un = w.tags.get('00291001');
    assert.ok(un, 'UN sequence element missing');
    assert.equal(un.vr, 'UN');
    assert.equal(un.valueOffset, itemStart);
    assert.equal(un.valueLength, seqEnd - itemStart);
    const pn = w.tags.get('00100010');
    assert.ok(pn, 'tag after the sequence was dropped');
    assert.equal(w.getStrings(pn)[0], 'DOE^');
  });
  it('truncated implicit sequence + stray undefined lengths throw (loud)', () => {
    const enc = new TextEncoder();
    const meta = (): number[] => {
      const b: number[] = new Array(128).fill(0);
      b.push(68, 73, 67, 77);
      b.push(0x02, 0x00, 0x00, 0x00, 0x55, 0x4c, 0x04, 0x00, 28, 0, 0, 0);
      b.push(0x02, 0x00, 0x10, 0x00, 0x55, 0x49, 20, 0, ...enc.encode('1.2.840.10008.1.2.1'), 0x00);
      return b;
    };
    const u32 = (b: number[], v: number): void => { b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff); };
    // UN sequence with no delimitation
    const b1 = meta();
    b1.push(0x29, 0x00, 0x01, 0x10, 0x55, 0x4e, 0x00, 0x00); u32(b1, 0xffffffff);
    b1.push(0xfe, 0xff, 0x00, 0xe0); u32(b1, 4); b1.push(1, 2, 3, 4);
    assert.throws(
      () => new Walker(Uint8Array.from(b1).buffer as ArrayBuffer).walk(),
      (e: unknown) => e instanceof DicomParseError,
    );
    // stray undefined-length OD (long-form VR, non-sequence): was a silent
    // tail drop (off jumped past end), now loud. Short-form VRs cannot carry
    // undefined lengths in explicit syntax (u16 field); implicit syntax maps
    // every undefined length to SQ by Daikon convention, unchanged.
    const b2 = meta();
    b2.push(0x19, 0x00, 0x01, 0x10, 0x4f, 0x44, 0x00, 0x00); u32(b2, 0xffffffff);
    assert.throws(
      () => new Walker(Uint8Array.from(b2).buffer as ArrayBuffer).walk(),
      (e: unknown) => e instanceof DicomParseError && (e as DicomParseError).kind === 'truncated',
    );
  });
  it('undefined-length SQ parses', () => {
    // hand-built: sequence with undefined length, one undefined item
    const enc = new TextEncoder();
    const inner: number[] = [];
    const push = (...xs: number[]): void => { inner.push(...xs); };
    const elem = (g: number, e: number, vr: string, val: number[]): void => {
      push(g & 0xff, (g >> 8) & 0xff, e & 0xff, (e >> 8) & 0xff,
        vr.charCodeAt(0), vr.charCodeAt(1), val.length & 0xff, (val.length >> 8) & 0xff, ...val);
    };
    push(0x06, 0x30, 0x20, 0x00); // (3006,0020)
    push(0x53, 0x51, 0, 0); // SQ reserved
    push(0xff, 0xff, 0xff, 0xff); // undefined length
    push(0xfe, 0xff, 0x00, 0xe0, 0xff, 0xff, 0xff, 0xff); // undefined item
    elem(0x3006, 0x0026, 'LO', [...enc.encode('Kidney'), 0x20]);
    push(0xfe, 0xff, 0x0d, 0xe0, 0, 0, 0, 0); // item delimitation
    push(0xfe, 0xff, 0xdd, 0xe0, 0, 0, 0, 0); // sequence delimitation
    const file = new Uint8Array(132 + inner.length);
    file[128] = 68; file[129] = 73; file[130] = 67; file[131] = 77;
    file.set(inner, 132);
    const ds = readDataset(file.buffer as ArrayBuffer);
    const items = ds.sequence('30060020');
    assert.equal(items.length, 1);
    assert.equal(items[0]!.text('30060026'), 'Kidney');
  });
});
