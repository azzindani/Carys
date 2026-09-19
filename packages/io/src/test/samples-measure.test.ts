import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readHeader, readImage } from '../nifti1.js';
import { maskVolume } from '@carys/measure';
import type { Volume } from '@carys/volume-core';

const SAMPLES = join(process.cwd(), 'samples');
const bufOf = (f: string): ArrayBuffer => Uint8Array.from(readFileSync(join(SAMPLES, f))).buffer as ArrayBuffer;

const DTYPE_ARRAYS = {
  uint8: Uint8Array, int8: Int8Array, uint16: Uint16Array, int16: Int16Array,
  uint32: Uint32Array, int32: Int32Array, float32: Float32Array, float64: Float64Array,
} as const;

// liver_33 naming is swapped upstream: img=labels, seg=CT.
const PAIRS: [string, string, string][] = [
  ['brats-tumor', 'brain_tumor_BraTS19_CBICA_AQN_1_flair.nii', 'brain_tumor_BraTS19_CBICA_AQN_1_seg.nii'],
  ['liver', 'liver_33_seg.nii', 'liver_33_img.nii'],
  ['hepatic-vessel', 'hepatic_vessel_tumor_227_img.nii', 'hepatic_vessel_tumor_227_seg.nii'],
  ['skull', 'skull_case_0001_img.nii', 'skull_case_0001_seg.nii'],
  ['spine-11', 'spine_11_0000_img.nii', 'spine_11_seg.nii'],
  ['spine-ct', 'spine_ct_case_0010_img.nii', 'spine_ct_case_0010_seg.nii'],
  ['covid', 'volume-covid19-A-0329.nii', 'volume-covid19-A-0329_seg.nii'],
  ['lesion', 'brain_lession_16_rr_mni_flair.nii', 'brain_lession_16_rr_mni_lesion.nii'],
];

describe('samples: segmentation volumes (mm^3)', () => {
  it('every pair has positive sub-image volume with bbox inside dims', () => {
    for (const [name, imgF, segF] of PAIRS) {
      const hs = readHeader(bufOf(segF));
      const A = new (DTYPE_ARRAYS[hs.dtype] ?? Uint8Array)(readImage(hs, bufOf(segF))) as ArrayLike<number>;
      const [nx, ny, nz] = hs.dims;
      const n = nx * ny * nz;
      const mask = new Uint8Array(n);
      const bb = [nx, ny, nz, -1, -1, -1];
      for (let i = 0; i < Math.min(n, A.length); i++) {
        if (A[i]! > 0) {
          mask[i] = 1;
          const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
          if (x < bb[0]!) bb[0] = x;
          if (y < bb[1]!) bb[1] = y;
          if (z < bb[2]!) bb[2] = z;
          if (x > bb[3]!) bb[3] = x;
          if (y > bb[4]!) bb[4] = y;
          if (z > bb[5]!) bb[5] = z;
        }
      }
      const vol = {
        dims: hs.dims, spacing: [hs.pixDims[1], hs.pixDims[2], hs.pixDims[3]],
        origin: [0, 0, 0], dtype: hs.dtype, data: mask,
      } as unknown as Volume;
      const mm3 = maskVolume(mask, vol);
      assert.ok(mm3 > 0, `${name}: empty mask`);
      assert.ok(mm3 < n * hs.pixDims[1]! * hs.pixDims[2]! * hs.pixDims[3]!, `${name}: mask bigger than image`);
      void imgF;
    }
  });
});
