import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readHeader, readFrame, readImage } from '../nifti1.js';

const SAMPLES = join(process.cwd(), 'samples');

describe('nifti 4D time', () => {
  it('cardiac 4D parses nt=30 with 3D dims', () => {
    const buf = Uint8Array.from(readFileSync(join(SAMPLES, 'cardiac_patient021_4d.nii'))).buffer as ArrayBuffer;
    const h = readHeader(buf);
    assert.deepEqual(h.dims, [240, 256, 10]);
    assert.equal(h.nt, 30);
    assert.equal(h.dtype, 'int16');
  });
  it('frames tile the file exactly, frame 0 equals readImage', () => {
    const raw = Uint8Array.from(readFileSync(join(SAMPLES, 'cardiac_patient021_4d.nii')));
    const buf = raw.buffer as ArrayBuffer;
    const h = readHeader(buf);
    const f0 = new Uint8Array(readFrame(h, buf, 0));
    assert.deepEqual(f0, new Uint8Array(readImage(h, buf)));
    const last = new Uint8Array(readFrame(h, buf, 29));
    assert.equal(last.length, 240 * 256 * 10 * 2);
    let differ = 0;
    for (let i = 0; i < f0.length; i += 2) if (f0[i] !== last[i]) differ++;
    assert.ok(differ > 0, 'first and last cardiac frames identical — no motion captured');
  });
  it('3D files report nt=1, out-of-range frames throw RangeError', () => {
    const buf = Uint8Array.from(readFileSync(join(SAMPLES, 'brain_tumor_BraTS19_CBICA_AQN_1_flair.nii'))).buffer as ArrayBuffer;
    const h = readHeader(buf);
    assert.equal(h.nt, 1);
    assert.throws(() => readFrame(h, buf, 1), RangeError);
    const h4 = readHeader(Uint8Array.from(readFileSync(join(SAMPLES, 'cardiac_patient021_4d.nii'))).buffer as ArrayBuffer);
    assert.throws(() => readFrame(h4, buf, -1), RangeError);
    assert.throws(() => readFrame(h4, buf, 30), RangeError);
  });
});
