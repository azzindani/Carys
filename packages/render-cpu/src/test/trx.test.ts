import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { isTrxLike, makeTrx, parseTrx, TrxError } from '../trx.js';

const S1 = [0, 0, 0, 1, 0, 0, 1, 1, 0];
const S2 = [5, 5, 5, 6, 5, 5];

function u64le(vals: number[], high = 0): Uint8Array {
  const out = new Uint8Array(vals.length * 8);
  const dv = new DataView(out.buffer);
  vals.forEach((v, i) => { dv.setUint32(i * 8, v, true); dv.setUint32(i * 8 + 4, high, true); });
  return out;
}

function f32(vals: number[]): Uint8Array {
  const out = new Uint8Array(vals.length * 4);
  const dv = new DataView(out.buffer);
  vals.forEach((v, i) => dv.setFloat32(i * 4, v, true));
  return out;
}

function zipped(files: Record<string, Uint8Array | string>): ArrayBuffer {
  const z = zipSync(Object.fromEntries(
    Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? new TextEncoder().encode(v) : v]),
  ));
  const out = new ArrayBuffer(z.length);
  new Uint8Array(out).set(z);
  return out;
}

describe('trx', () => {
  it('round-trips float32 points, offsets and header', () => {
    const t = parseTrx(makeTrx([S1, S2], { header: { NB_VERTICES: 5 } }));
    assert.deepEqual([...t.pts], [...S1, ...S2]);
    assert.deepEqual([...t.offsetPt0], [0, 3, 5]);
    assert.deepEqual(t.header, { NB_VERTICES: 5 });
    assert.ok(isTrxLike(new Uint8Array(makeTrx([S1]))));
  });
  it('float16 positions decode exactly', () => {
    const vals = [0.5, 1, -2, 100.5, 33.25, 0, 0.75, -0.5, 8];
    const t = parseTrx(makeTrx([vals], { positionsDtype: 'float16' }));
    assert.deepEqual([...t.pts], vals);
    assert.deepEqual(t.header, null);
  });
  it('dps/dps_streamline sidecars decode with length checks', () => {
    const fa = [0.1, 0.2, 0.3, 0.4, 0.5]; // one per point
    const len = [3.0, 2.0]; // one per streamline
    const t = parseTrx(makeTrx([S1, S2], { dps: { fa: fa }, dpsStreamline: { length: len } }));
    assert.deepEqual([...t.dps.get('fa.float32')!].map((v) => Math.round(v * 10) / 10), fa);
    assert.deepEqual([...t.dpsStreamline.get('length.float32')!], len);
    const bad = makeTrx([S1], { dps: { fa: [1, 2] } }); // 2 values vs 3 points
    assert.throws(() => parseTrx(bad), (e: unknown) => e instanceof TrxError);
  });
  it('rejects bad zips, missing arrays, bad dtypes and corrupt offsets (table)', () => {
    const pos = f32([...S1, ...S2]);
    const cases: Array<[string, ArrayBuffer]> = [
      ['not-a-zip', new TextEncoder().encode('hello').buffer as ArrayBuffer],
      ['missing-offsets', zipped({ 't/positions.3.float32': pos })],
      ['missing-positions', zipped({ 't/offsets.uint64': u64le([0, 3]) })],
      ['bad-positions-dtype', zipped({ 't/offsets.uint64': u64le([0, 3]), 't/positions.3.int32': pos })],
      ['u64-overflow', zipped({ 't/offsets.uint64': u64le([0, 3], 1), 't/positions.3.float32': pos })],
      ['first-not-zero', zipped({ 't/offsets.uint64': u64le([7, 9]), 't/positions.3.float32': pos })],
      ['non-monotonic', zipped({ 't/offsets.uint64': u64le([0, 5, 3]), 't/positions.3.float32': pos })],
      ['offset-past-end', zipped({ 't/offsets.uint64': u64le([0, 99]), 't/positions.3.float32': pos })],
      ['empty-offsets', zipped({ 't/offsets.uint64': new Uint8Array(0), 't/positions.3.float32': pos })],
      ['bad-header-json', zipped({
        't/offsets.uint64': u64le([0]), 't/positions.3.float32': f32(S1), 't/header.json': '{nope',
      })],
    ];
    for (const [name, buf] of cases) {
      assert.throws(() => parseTrx(buf), (e: unknown) => e instanceof TrxError, name);
    }
    assert.equal(isTrxLike(new Uint8Array(zipped({ 'a/b.txt': 'hi' }))), false);
    assert.equal(isTrxLike(new Uint8Array([1, 2, 3, 4])), false);
  });
});
