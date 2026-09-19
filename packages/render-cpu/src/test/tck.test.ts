import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTckLike, makeTck, parseTck, TckError } from '../tck.js';

const S1 = [0, 0, 0, 1, 0, 0, 1, 1, 0];
const S2 = [5, 5, 5, 6, 5, 5];

function head(lines: string, padTo = 128): ArrayBuffer {
  const hb = new TextEncoder().encode(lines);
  const out = new Uint8Array(Math.max(padTo, hb.length + 12));
  out.set(hb, 0);
  return out.buffer as ArrayBuffer;
}

describe('tck', () => {
  it('round-trips streamlines with exact points + fence posts', () => {
    const t = parseTck(makeTck([S1, S2]));
    assert.deepEqual([...t.pts], [...S1, ...S2]);
    assert.deepEqual([...t.offsetPt0], [0, 3, 5]);
    assert.ok(isTckLike(new Uint8Array(makeTck([S1]))));
    // Writers that NaN-fence every track (tckgen layout) leave the Inf to
    // close an empty tail — NiiVue-identical trailing post, zero points.
    const single = new Uint8Array(makeTck([S1]));
    const grown = new Uint8Array(single.length + 12);
    grown.set(single.subarray(0, single.length - 12), 0); // drop the Inf
    const gdv = new DataView(grown.buffer);
    gdv.setFloat32(grown.length - 24, NaN, true); // NaN fence after S1
    gdv.setFloat32(grown.length - 12, Infinity, true); // Inf terminates
    const t2 = parseTck(grown.buffer as ArrayBuffer);
    assert.deepEqual([...t2.offsetPt0], [0, 3, 3]);
  });
  it('rejects bad headers, offsets, datatypes and truncation by name', () => {
    const good = new Uint8Array(makeTck([S1]));
    const cases: Array<[string, ArrayBuffer]> = [
      ['too-small', new Uint8Array(10).buffer as ArrayBuffer],
      ['signature', head('not a tract\nfile: . 64\ndatatype: Float32LE\nEND\n')],
      ['no-end', head('mrtrix tracks\ndatatype: Float32LE\nfile: . 64\nmoredata: yes\n')],
      ['no-offset', head('mrtrix tracks\ndatatype: Float32LE\nEND\n')],
      ['be-datatype', head('mrtrix tracks\ndatatype: Float32BE\nfile: . 64\nEND\n')],
      ['truncated-data', good.slice(0, 64 + 6).buffer as ArrayBuffer],
      ['no-delimiter', good.slice(0, 64 + 12).buffer as ArrayBuffer],
    ];
    for (const [name, buf] of cases) {
      assert.throws(() => parseTck(buf), (e: unknown) => e instanceof TckError, name);
    }
    assert.equal(isTckLike(new Uint8Array([1, 2, 3])), false);
  });
});
