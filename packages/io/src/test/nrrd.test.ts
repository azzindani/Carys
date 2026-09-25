import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeNrrd, NrrdError, nrrdDetachedName, parseNrrd, parseNrrdDetached, type NrrdDType } from '../nrrd.js';
import { isNrrdLike } from '../sniff.js';

const DIMS: [number, number, number] = [3, 2, 2]; // n = 12
const seq = (n: number, f: (i: number) => number): number[] => Array.from({ length: n }, (_, i) => f(i));

describe('nrrd', () => {
  it('raw round-trips all 8 scalar types with exact values', () => {
    const cases: Array<[NrrdDType, number[]]> = [
      ['uint8', seq(12, (i) => i * 20)],
      ['int8', seq(12, (i) => i * 10 - 60)],
      ['uint16', seq(12, (i) => i * 5432)],
      ['int16', [ -32768, -300, -1, 0, 1, 300, 32767, 1234, -1234, 7, -7, 9999 ]],
      ['uint32', seq(12, (i) => i * 360000000)],
      ['int32', seq(12, (i) => i * 180000000 - 1080000000)],
      ['float32', seq(12, (i) => i * 0.25 - 1.5)],
      ['float64', seq(12, (i) => i * 0.1 - 0.55)],
    ];
    for (const [dtype, values] of cases) {
      const v = parseNrrd(makeNrrd(DIMS, dtype, values, { spacing: [1, 2, 3] }));
      assert.deepEqual(v.dims, [3, 2, 2], dtype);
      assert.deepEqual(v.spacing, [1, 2, 3], dtype);
      assert.equal(v.dtype, dtype);
      assert.deepEqual([...v.data], values, dtype);
    }
    assert.ok(isNrrdLike(new Uint8Array(makeNrrd(DIMS, 'uint8', seq(12, (i) => i)))));
  });
  it('ascii, gzip and big-endian payloads decode identically', () => {
    const values = seq(12, (i) => i * 0.5 - 2);
    for (const encoding of ['ascii', 'gzip'] as const) {
      const v = parseNrrd(makeNrrd(DIMS, 'float32', values, { encoding }));
      assert.deepEqual([...v.data], values, encoding);
      assert.deepEqual(v.spacing, [1, 1, 1], `${encoding} default spacing`);
    }
    const ints = [-32768, -300, -1, 0, 1, 300, 32767, 1234, -1234, 7, -7, 9999];
    const be = parseNrrd(makeNrrd(DIMS, 'int16', ints, { endian: 'big' }));
    assert.deepEqual([...be.data], ints);
    const be64 = parseNrrd(makeNrrd(DIMS, 'float64', values, { endian: 'big' }));
    assert.deepEqual([...be64.data], values);
  });
  it('detached .nhdr pairs raw/ascii payloads, honors byte skip', () => {
    const head = (extra = ''): ArrayBuffer => new TextEncoder().encode(
      `NRRD0004\ntype: short\ndimension: 3\nsizes: 3 2 2\nendian: little\nencoding: raw\ndata file: vol.raw\n${extra}`,
    ).buffer as ArrayBuffer; // no blank line, no inline data: header-only
    const payload = new Uint8Array(24);
    for (let i = 0; i < 12; i++) { payload[i * 2] = i; payload[i * 2 + 1] = 0; }
    const v = parseNrrdDetached(head(), payload);
    assert.deepEqual(v.dims, [3, 2, 2]);
    assert.equal(v.dtype, 'int16');
    assert.deepEqual([...v.data], seq(12, (i) => i));
    // byte skip jumps a prefix (e.g. a text preamble in the .raw)
    const prefixed = new Uint8Array(28);
    prefixed.set([65, 66, 67, 68], 0);
    prefixed.set(payload, 4);
    const skipped = parseNrrdDetached(head('byte skip: 4\n'), prefixed);
    assert.deepEqual([...skipped.data], seq(12, (i) => i));
    // ascii payload through the detached path too
    const ahead = new TextEncoder().encode(
      'NRRD0004\ntype: uchar\ndimension: 3\nsizes: 3 2 2\nencoding: ascii\ndata file: v.txt\n',
    ).buffer as ArrayBuffer;
    const ascii = parseNrrdDetached(ahead, new TextEncoder().encode('0 1 2 3 4 5 6 7 8 9 10 11'));
    assert.deepEqual([...ascii.data], seq(12, (i) => i));
    // bad skips and short files are loud
    assert.throws(() => parseNrrdDetached(head('byte skip: -1\n'), payload), (e: unknown) => e instanceof NrrdError);
    assert.throws(() => parseNrrdDetached(head('byte skip: 99\n'), payload), (e: unknown) => e instanceof NrrdError);
    assert.throws(() => parseNrrdDetached(head(), payload.slice(0, 10)), (e: unknown) => e instanceof NrrdError);
    assert.ok(isNrrdLike(new Uint8Array(head())));
    // header without a trailing newline still parses (EOF-terminated)
    const unterminated = head().slice(0, head().byteLength - 1);
    assert.deepEqual([...parseNrrdDetached(unterminated, payload).data], seq(12, (i) => i));
  });
  it('nrrdDetachedName resolves the data-file pointer, null when attached', () => {
    const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
    assert.equal(
      nrrdDetachedName(enc('NRRD0004\ntype: uchar\ndimension: 3\nsizes: 3 2 2\nencoding: raw\ndata file: vol.raw\n')),
      'vol.raw',
    );
    // "datafile:" single-word spelling also resolves
    assert.equal(
      nrrdDetachedName(enc('NRRD0004\ntype: uchar\ndimension: 3\nsizes: 3 2 2\nencoding: raw\ndatafile: v.bin\n')),
      'v.bin',
    );
    // attached header (no pointer) -> null, not throw
    assert.equal(nrrdDetachedName(makeNrrd(DIMS, 'uint8', seq(12, (i) => i))), null);
    // non-NRRD bytes are loud (callers treat as "not a header")
    assert.throws(() => nrrdDetachedName(enc('XXXX....')), (e: unknown) => e instanceof NrrdError);
  });
  it('rejects bad headers, unknown types/encodings and size mismatches by name', () => {
    const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
    const good = makeNrrd(DIMS, 'uint8', seq(12, (i) => i));
    const cases: Array<[string, ArrayBuffer]> = [
      ['bad-magic', enc('NRRD9999\ntype: uchar\ndimension: 3\nsizes: 3 2 2\nencoding: raw\n\nABCDABCDABCD')],
      ['no-blank-line', enc('NRRD0004\ntype: uchar\ndimension: 3\nsizes: 3 2 2\nencoding: raw')],
      ['inline-data', enc('NRRD0004\ntype: uchar\ndimension: 3\nsizes: 3 2 2\nencoding: raw\ndata file:= foo\n\nABCD')],
      ['dimension-2', enc('NRRD0004\ntype: uchar\ndimension: 2\nsizes: 3 4\nencoding: raw\n\n012345678901')],
      ['bad-sizes', enc('NRRD0004\ntype: uchar\ndimension: 3\nsizes: 3 2 x\nencoding: raw\n\n012345678901')],
      ['unknown-type', enc('NRRD0004\ntype: vec3\ndimension: 3\nsizes: 3 2 2\nencoding: raw\n\n012345678901')],
      ['missing-type', enc('NRRD0004\ndimension: 3\nsizes: 3 2 2\nencoding: raw\n\n012345678901')],
      ['bzip2', enc('NRRD0004\ntype: uchar\ndimension: 3\nsizes: 3 2 2\nencoding: bzip2\n\n012345678901')],
      ['truncated-raw', good.slice(0, good.byteLength - 4)],
      ['short-payload', enc('NRRD0004\ntype: uchar\ndimension: 3\nsizes: 3 2 2\nencoding: raw\n\nABC')],
      ['ascii-count', (() => {
        const b = new Uint8Array(makeNrrd(DIMS, 'uint8', seq(12, (i) => i), { encoding: 'ascii' }));
        return b.slice(0, b.length - 2).buffer as ArrayBuffer;
      })()],
      ['corrupt-gzip', enc('NRRD0004\ntype: uchar\ndimension: 3\nsizes: 3 2 2\nencoding: gzip\n\nnot-gzip-bytes')],
    ];
    for (const [name, buf] of cases) {
      assert.throws(() => parseNrrd(buf), (e: unknown) => e instanceof NrrdError, name);
    }
    assert.equal(isNrrdLike(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), false);
  });
});
