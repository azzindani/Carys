import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeNifti1 } from '../nifti-write.js';
import { readHeader, readImage, isNIFTI1 } from '../nifti1.js';
import type { Volume } from '@carys/volume-core';

const vol = (dims: [number, number, number], dtype: Volume['dtype'], data: ArrayLike<number>): Volume =>
  ({ dims, spacing: [2, 1.5, 3], origin: [0, 0, 0], dtype, data }) as unknown as Volume;

describe('nifti-write round-trip', () => {
  const cases: [Volume['dtype'], number[]][] = [
    ['uint8', [0, 1, 255, 7]],
    ['int8', [-128, -1, 0, 127]],
    ['uint16', [0, 1000, 65535, 42]],
    ['int16', [-32768, -5, 0, 32767]],
    ['uint32', [0, 1, 4000000000, 9]],
    ['int32', [-2147483648, -3, 0, 11]],
    ['float32', [0.5, -1.25, 100.75, 0]],
    ['float64', [0.1, -1e10, 3.14159265358979, 0]],
  ];
  it('every dtype round-trips exactly', () => {
    for (const [dtype, vals] of cases) {
      const Ctor = dtype.startsWith('float')
        ? (dtype === 'float64' ? Float64Array : Float32Array)
        : dtype.includes('16') ? (dtype.startsWith('u') ? Uint16Array : Int16Array)
        : dtype.includes('32') ? (dtype.startsWith('u') ? Uint32Array : Int32Array)
        : dtype.startsWith('u') ? Uint8Array : Int8Array;
      const v = vol([2, 2, 1], dtype, new Ctor(vals));
      const buf = writeNifti1(v);
      assert.equal(isNIFTI1(buf), true, dtype);
      const h = readHeader(buf);
      assert.deepEqual(h.dims, [2, 2, 1], dtype);
      assert.equal(h.dtype, dtype);
      assert.deepEqual([h.pixDims[1], h.pixDims[2], h.pixDims[3]], [2, 1.5, 3], dtype);
      const back = new Ctor(readImage(h, buf));
      assert.deepEqual([...back].slice(0, 4), vals.map((x) => dtype.startsWith('float') ? x : Math.round(x)), dtype);
    }
  });

  // Oblique, left-handed (RAS +i → Left) grid with an offset: exercises the
  // qfac sign and a non-trivial quaternion, the cases a diagonal would hide.
  const c = Math.cos(0.4), sn = Math.sin(0.4);
  const rot = [
    [-0.9 * c, -1.1 * sn, 0, 12.5],
    [-0.9 * sn, 1.1 * c, 0, -30],
    [0, 0, 2.5, 7],
    [0, 0, 0, 1],
  ];
  const near = (a: number[][], b: number[][]): void => {
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 4; k++) assert.ok(Math.abs(a[r]![k]! - b[r]![k]!) < 1e-4, `[${r}][${k}] ${a[r]![k]} vs ${b[r]![k]}`);
    }
  };

  it('writes the affine as the sform a reader recovers', () => {
    const h = readHeader(writeNifti1(vol([2, 2, 2], 'uint8', new Uint8Array(8)), { affine: rot }));
    assert.equal(h.sform_code, 1);
    near(h.affine, rot);
    assert.deepEqual(h.pixDims.slice(1, 4).map((v) => Math.round(v * 1000) / 1000), [0.9, 1.1, 2.5]);
  });

  it('writes the same affine as a qform quaternion (qfac included)', () => {
    const h = readHeader(writeNifti1(vol([2, 2, 2], 'uint8', new Uint8Array(8)), { affine: rot, sformCode: 0 }));
    assert.equal(h.qform_code, 1);
    assert.equal(h.sform_code, 0);
    assert.equal(h.pixDims[0], -1);
    near(h.affine, rot);
  });

  it('stays METHOD 0 when no affine is given', () => {
    const h = readHeader(writeNifti1(vol([2, 2, 2], 'uint8', new Uint8Array(8))));
    assert.equal(h.qform_code, 0);
    assert.equal(h.sform_code, 0);
  });
});
