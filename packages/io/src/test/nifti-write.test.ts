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
});
