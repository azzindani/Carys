import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isMz3Like, makeMz3, Mz3Error, parseMz3 } from '../mz3.js';
import { base64ToBytes, GiftiError, isGiftiLike, makeGiftiAscii, parseGifti } from '../gifti.js';

// Shared tetrahedron: 4 verts, 2 faces (fully synthetic, image gate safe).
const POS = new Float32Array([0, 0, 0, 4, 0, 0, 0, 3, 0, 0, 0, 2]);
const IDX = new Uint32Array([0, 1, 2, 0, 1, 3]);

describe('mz3', () => {
  it('round-trips faces + verts with exact geometry and unit normals', () => {
    const back = parseMz3(makeMz3(POS, IDX));
    assert.deepEqual([...back.mesh.positions], [...POS]);
    assert.deepEqual([...back.mesh.indices], [...IDX]);
    assert.equal(back.colors, null);
    assert.equal(back.scalars, null);
    for (let i = 0; i < back.mesh.normals.length; i += 3) {
      const l = Math.hypot(back.mesh.normals[i]!, back.mesh.normals[i + 1]!, back.mesh.normals[i + 2]!);
      assert.ok(Math.abs(l - 1) < 1e-5, `normal ${i / 3} not unit: ${l}`);
    }
    assert.ok(isMz3Like(new Uint8Array(makeMz3(POS, IDX))));
  });
  it('round-trips colors (/255) + scalar frames', () => {
    const colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]);
    const scalars = new Float32Array([0.5, 1.5, 2.5, 3.5]);
    const back = parseMz3(makeMz3(POS, IDX, { colors, scalars }));
    for (let i = 0; i < colors.length; i++) assert.ok(Math.abs(back.colors![i]! - colors[i]!) < 1 / 255 + 1e-6);
    assert.deepEqual([...back.scalars!], [...scalars]);
  });
  it('rejects truncated, foreign, gzip, future-attr and face-less inputs by name', () => {
    const good = new Uint8Array(makeMz3(POS, IDX));
    const cases: Array<[string, Uint8Array]> = [
      ['truncated-header', new Uint8Array([1, 2, 3])],
      ['bad-magic', (() => { const b = good.slice(); b[0] = 0x34; b[1] = 0x12; return b; })()],
      ['gzip-magic', (() => { const b = good.slice(); b[0] = 0x1f; b[1] = 0x8b; return b; })()],
      ['future-attr', (() => { const b = good.slice(); b[2] = 0x80; b[3] = 0x01; return b; })()],
      ['truncated-faces', good.slice(0, 20)],
      ['face-index-oor', (() => {
        const b = new Uint8Array(makeMz3(POS, IDX));
        new DataView(b.buffer).setUint32(16, 99, true);
        return b;
      })()],
      ['scalar-only', (() => {
        const b = new Uint8Array(makeMz3(POS, IDX));
        const dv = new DataView(b.buffer);
        dv.setUint16(2, 2 | 8, true); // verts + scalars, no faces
        dv.setUint32(4, 0, true);
        return b.slice(0, 16 + 48 + 16);
      })()],
    ];
    for (const [name, bytes] of cases) {
      assert.throws(() => parseMz3(bytes.buffer as ArrayBuffer), (e: unknown) => e instanceof Mz3Error, name);
    }
    assert.equal(isMz3Like(new Uint8Array([1, 2, 3])), false);
  });
});

describe('gifti', () => {
  it('ASCII round-trips pointset + triangles with exact geometry', () => {
    const g = parseGifti(makeGiftiAscii([...POS], [...IDX]));
    assert.deepEqual([...g.positions], [...POS]);
    assert.deepEqual([...g.indices], [...IDX]);
    assert.ok(g.mesh !== null);
    assert.deepEqual([...g.mesh!.indices], [...IDX]);
    assert.equal(g.scalars.length, 0);
    assert.ok(isGiftiLike(new Uint8Array(makeGiftiAscii([...POS], [...IDX]))));
  });
  it('Base64Binary round-trips and ColumnMajorOrder un-transposes', () => {
    const variants = [
      makeGiftiAscii([...POS], [...IDX], { encoding: 'Base64Binary' }),
      makeGiftiAscii([...POS], [...IDX], { colMajor: true }),
      makeGiftiAscii([...POS], [...IDX], { colMajor: true, encoding: 'Base64Binary' }),
    ];
    for (const buf of variants) {
      const g = parseGifti(buf);
      assert.deepEqual([...g.positions], [...POS]);
      assert.deepEqual([...g.indices], [...IDX]);
    }
  });
  it('scalar arrays concatenate; pointset-only files give mesh null', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GIFTI Version="1.0" NumberOfDataArrays="2">
<DataArray Intent="NIFTI_INTENT_NONE" DataType="NIFTI_TYPE_FLOAT32" ArrayIndexingOrder="RowMajorOrder" Dimensionality="1" Dim0="4" Encoding="ASCII" Endian="LittleEndian">
<Data>0.25 0.5 0.75 1.0</Data>
</DataArray>
<DataArray Intent="NIFTI_INTENT_POINTSET" DataType="NIFTI_TYPE_FLOAT32" ArrayIndexingOrder="RowMajorOrder" Dimensionality="2" Dim0="4" Dim1="3" Encoding="ASCII" Endian="LittleEndian">
<Data>0 0 0 4 0 0 0 3 0 0 0 2</Data>
</DataArray>
</GIFTI>`;
    const g = parseGifti(new TextEncoder().encode(xml).buffer as ArrayBuffer);
    assert.deepEqual([...g.scalars], [0.25, 0.5, 0.75, 1.0]);
    assert.equal(g.mesh, null);
    assert.deepEqual([...g.positions], [...POS]);
  });
  it('rejects foreign XML, missing payloads, gzip and shape mismatches by name', () => {
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
    const good = new TextDecoder().decode(makeGiftiAscii([...POS], [...IDX]));
    const cases: Array<[string, Uint8Array]> = [
      ['not-xml', enc('<html></html>')],
      ['no-dataarray', enc('<?xml version="1.0"?><GIFTI></GIFTI>')],
      ['missing-data', enc(good.replace(/<Data>[\s\S]*?<\/Data>/, '<NODATA/>'))],
      ['gzip-encoding', enc(good.replaceAll('Encoding="ASCII"', 'Encoding="GZipBase64Binary"'))],
      ['bad-dtype', enc(good.replaceAll('NIFTI_TYPE_FLOAT32', 'NIFTI_TYPE_COMPLEX64'))],
      ['count-mismatch', enc(good.replace('Dim0="4"', 'Dim0="5"'))],
      ['triangle-oor', enc(good.replaceAll('0 1 2 0 1 3', '0 1 2 0 1 9'))],
      ['whole-file-gzip', new Uint8Array([0x1f, 0x8b, 0x08, 0x00])],
    ];
    for (const [name, bytes] of cases) {
      assert.throws(() => parseGifti(bytes.buffer as ArrayBuffer), (e: unknown) => e instanceof GiftiError, name);
    }
    assert.throws(() => base64ToBytes('abc'), (e: unknown) => e instanceof GiftiError);
    assert.equal(isGiftiLike(new Uint8Array([1, 2, 3])), false);
  });
});
