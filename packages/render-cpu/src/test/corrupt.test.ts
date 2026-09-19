// Broken-file battery for mesh + tract readers: hostile input fails loud
// with a NAMED error, never a hang or an uncaught RangeError/TypeError.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GiftiError, parseGifti } from '../gifti.js';
import { Mz3Error, parseMz3 } from '../mz3.js';
import { StlError, parseStl } from '../stl.js';
import { TckError, parseTck } from '../tck.js';
import { TrkError, parseTrk } from '../trk.js';
import { TrxError, parseTrx } from '../trx.js';

const buf = (bytes: number[]): ArrayBuffer => new Uint8Array(bytes).buffer as ArrayBuffer;
const text = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

function loud(fn: () => unknown, cls: new (...a: never[]) => Error, label: string): void {
  assert.throws(fn, (e: unknown) => e instanceof cls && (e as Error).message.length > 0, label);
}

describe('corrupt meshes + tracts', () => {
  it('empty and 4-byte buffers are loud everywhere', () => {
    for (const [fn, parse] of [
      ['stl', parseStl], ['mz3', parseMz3], ['gifti', parseGifti],
      ['tck', parseTck], ['trk', parseTrk], ['trx', parseTrx],
    ] as Array<[string, (b: ArrayBuffer) => unknown]>) {
      loud(() => parse(buf([])), { stl: StlError, mz3: Mz3Error, gifti: GiftiError, tck: TckError, trk: TrkError, trx: TrxError }[fn]!, `${fn} empty`);
      loud(() => parse(buf([1, 2, 3, 4])), { stl: StlError, mz3: Mz3Error, gifti: GiftiError, tck: TckError, trk: TrkError, trx: TrxError }[fn]!, `${fn} short`);
    }
  });
  it('text where binary belongs is loud, not a RangeError', () => {
    const t = text('this is not a mesh file at all....');
    loud(() => parseStl(t), StlError, 'stl text');
    loud(() => parseMz3(t), Mz3Error, 'mz3 text');
    loud(() => parseTck(t), TckError, 'tck text');
    loud(() => parseTrk(t), TrkError, 'trk text');
    loud(() => parseTrx(t), TrxError, 'trx text');
  });
  it('GIFTI rejects malformed XML by name', () => {
    loud(() => parseGifti(text('<GIFTI unfinished')), GiftiError, 'cut xml');
    loud(() => parseGifti(text('<html><body>nope</body></html>')), GiftiError, 'wrong xml');
  });
  it('TCK rejects a non-multiple-of-12 tail by name', () => {
    // 5 floats = 20 bytes: headerless triplets must come in xyz triplets.
    const odd = new ArrayBuffer(20);
    loud(() => parseTck(odd), TckError, 'odd tail');
  });
});
