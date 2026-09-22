import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needs, sample } from '@carys/testkit';
import { writeNifti1 } from '../nifti-write.js';
import { readHeader, readImage, isNIFTI1 } from '../nifti1.js';
import { isGzip, gunzipNifti, gzipNifti, decodeNiftiBuffer, NiftiGzipError } from '../nifti-gzip.js';
import type { Volume } from '@carys/volume-core';


describe('nifti-gzip', () => {
  it('gzip round-trips bytes exactly (all 8 dtypes)', () => {
    const dtypes: Volume['dtype'][] = ['uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32', 'float32', 'float64'];
    for (const dtype of dtypes) {
      const plain = writeNifti1({ dims: [2, 2, 1], spacing: [1, 1, 1], origin: [0, 0, 0], dtype, data: [1, 2, 3, 4] } as unknown as Volume);
      const gz = gzipNifti(plain);
      assert.ok(isGzip(gz), `${dtype}: missing gzip magic`);
      assert.ok(gz.length < plain.byteLength, `${dtype}: no compression`);
      assert.deepEqual(new Uint8Array(decodeNiftiBuffer(gz)), new Uint8Array(plain), dtype);
    }
  });
  it('real sample header + pixels survive a gzip round-trip', needs('brain_tumor_BraTS19_CBICA_AQN_1_flair.nii'), () => {
    const raw = new Uint8Array(readFileSync(sample('brain_tumor_BraTS19_CBICA_AQN_1_flair.nii')!));
    const back = new Uint8Array(gunzipNifti(gzipNifti(raw.buffer as ArrayBuffer)));
    assert.deepEqual(back, raw);
    assert.equal(isNIFTI1(back.buffer as ArrayBuffer), true);
    const h0 = readHeader(raw.buffer as ArrayBuffer);
    const h1 = readHeader(back.buffer as ArrayBuffer);
    assert.deepEqual(h1.dims, h0.dims);
    assert.equal(h1.dtype, h0.dtype);
    assert.deepEqual(new Uint8Array(readImage(h1, back.buffer as ArrayBuffer)), new Uint8Array(readImage(h0, raw.buffer as ArrayBuffer)));
  });
  it('decode passes plain bytes through as an equal copy', needs('brain_tumor_BraTS19_CBICA_AQN_1_flair.nii'), () => {
    const raw = new Uint8Array(readFileSync(sample('brain_tumor_BraTS19_CBICA_AQN_1_flair.nii')!));
    const out = new Uint8Array(decodeNiftiBuffer(raw));
    assert.deepEqual(out, raw);
    assert.notEqual(out.buffer, raw.buffer);
  });
  it('corrupt gzip rejected with named error', () => {
    assert.throws(() => gunzipNifti(Uint8Array.from([0x1f, 0x8b, 0, 1, 2, 3])), (e: unknown) => e instanceof NiftiGzipError);
    assert.throws(() => gunzipNifti(new Uint8Array(400).fill(7)), (e: unknown) => e instanceof NiftiGzipError);
    assert.equal(isGzip(Uint8Array.from([0x1f, 0x8b])), true);
    assert.equal(isGzip(Uint8Array.from([0x00])), false);
  });
});
