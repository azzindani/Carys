import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readHeader, readImage } from '../nifti1.js';
import { writeNifti1 } from '../nifti-write.js';
import { mulberry32 } from './rng.js';

// NIfTI write->read round-trip matrix: every dtype x several shapes,
// exact values back (int) or within float epsilon.
const DTYPES = ['uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32', 'float32', 'float64'] as const;

function volFor(dtype: (typeof DTYPES)[number], n: number): { data: ArrayLike<number>; lo: number; hi: number } {
  const rng = mulberry32(n * 7919 + dtype.length);
  const ranges: Record<string, [number, number]> = {
    uint8: [0, 255], int8: [-128, 127], uint16: [0, 60000], int16: [-30000, 30000],
    uint32: [0, 4000000000], int32: [-2000000000, 2000000000],
    float32: [-1000.5, 1000.5], float64: [-1e6, 1e6],
  };
  const [lo, hi] = ranges[dtype]!;
  const data = Array.from({ length: n }, () => {
    const v = lo + rng() * (hi - lo);
    return dtype.startsWith('float') ? v : Math.round(v);
  });
  return { data, lo, hi };
}

describe('dtype round-trip', () => {
  it('every dtype x shape round-trips exactly', () => {
    for (const dtype of DTYPES) {
      for (const shape of [[4, 3, 2], [7, 5, 3], [2, 2, 9]] as [number, number, number][]) {
        const n = shape[0] * shape[1] * shape[2];
        const { data } = volFor(dtype, n);
        const buf = writeNifti1({
          dims: shape, spacing: [1, 1, 1], origin: [0, 0, 0], dtype, data: data as never,
        });
        const h = readHeader(buf);
        assert.equal(h.dtype, dtype, shape.join('x'));
        assert.deepEqual(h.dims, shape, dtype);
        const Ctors = {
          uint8: Uint8Array, int8: Int8Array, uint16: Uint16Array, int16: Int16Array,
          uint32: Uint32Array, int32: Int32Array, float32: Float32Array, float64: Float64Array,
        } as const;
        const back = new Ctors[dtype](readImage(h, buf));
        const eps = dtype === 'float32' ? 0.5 : dtype === 'float64' ? 1e-9 : 0;
        for (let i = 0; i < n; i++) {
          assert.ok(Math.abs(back[i]! - (data[i] as number)) <= eps, `${dtype}[${i}]`);
        }
      }
    }
  });
});
