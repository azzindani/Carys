import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'fflate';
import { isTrkLike, makeTrk, parseTrk, TrkError } from '../trk.js';

const S1 = [0, 0, 0, 1, 0, 0, 1, 1, 0];
const S2 = [5, 5, 5, 6, 5, 5];

describe('trk', () => {
  it('round-trips streamlines with exact points + fence posts', () => {
    const t = parseTrk(makeTrk([S1, S2]));
    assert.deepEqual([...t.pts], [...S1, ...S2]);
    assert.deepEqual([...t.offsetPt0], [0, 3, 5]);
    assert.ok(isTrkLike(new Uint8Array(makeTrk([S1]))));
  });
  it('applies vox_to_ras, stores scalars and properties', () => {
    const shift = [1, 0, 0, 10, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const t = parseTrk(makeTrk([S1], {
      matrix: shift,
      scalarsPerVertex: 2,
      propertiesPerStreamline: 1,
    }));
    assert.deepEqual([...t.pts], [10, 0, 0, 11, 0, 0, 11, 1, 0]);
    assert.deepEqual([...t.offsetPt0], [0, 3]);
    assert.equal(t.nScalars, 2);
    assert.equal(t.scalars!.length, 6); // 3 points × 2 scalars (builder zeroes)
    assert.ok(t.scalars!.every((v) => v === 0));
    assert.equal(t.properties!.length, 1);
    const plain = parseTrk(makeTrk([S1]));
    assert.equal(plain.nScalars, 0);
    assert.equal(plain.scalars, null);
    assert.equal(plain.properties, null);
  });
  it('reads gzip-wrapped files', () => {
    const gz = gzipSync(new Uint8Array(makeTrk([S1, S2])));
    const buf = new ArrayBuffer(gz.length);
    new Uint8Array(buf).set(gz);
    assert.ok(isTrkLike(new Uint8Array(buf)));
    const t = parseTrk(buf);
    assert.deepEqual([...t.pts], [...S1, ...S2]);
  });
  it('rejects bad headers, truncation and empty content by name', () => {
    const good = new Uint8Array(makeTrk([S1]));
    const neg = new Uint8Array(makeTrk([S1]));
    new DataView(neg.buffer).setInt32(1000, -1, true);
    const badVer = new Uint8Array(makeTrk([S1]));
    new DataView(badVer.buffer).setUint32(992, 9, true);
    const cases: Array<[string, ArrayBuffer]> = [
      ['too-small', new Uint8Array(100).buffer as ArrayBuffer],
      ['bad-magic', (() => { const b = good.slice(); b[0] = 0x58; return b.buffer as ArrayBuffer; })()],
      ['zstd', new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]).buffer as ArrayBuffer],
      ['bad-version', badVer.buffer as ArrayBuffer],
      ['negative-count', neg.buffer as ArrayBuffer],
      ['truncated-vertex', good.slice(0, 1000 + 4 + 8).buffer as ArrayBuffer],
      ['empty', makeTrk([])],
    ];
    for (const [name, b] of cases) {
      assert.throws(() => parseTrk(b), (e: unknown) => e instanceof TrkError, name);
    }
    assert.equal(isTrkLike(new Uint8Array([1, 2, 3, 4])), false);
  });
});
