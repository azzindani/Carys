import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { listSamples, needsAny } from '@carys/testkit';
import { isNIFTI1, readHeader, readImage } from '../nifti1.js';
import { parseDicomSlice, DicomParseError } from '../dicom-parse.js';
import { sortSlices, stackToVolume } from '../dicom.js';
import { writeNifti1 } from '../nifti-write.js';
import { readHeader as readNiftiHeader, readImage as readNiftiImage } from '../nifti1.js';
import type { Volume } from '@carys/volume-core';

const SAMPLES = join(process.cwd(), 'samples');
const niiFiles = listSamples((f) => f.endsWith('.nii'));
const dcmFiles = listSamples((f) => f.endsWith('.dcm'));

function dim0(buf: ArrayBuffer, le: boolean): number {
  return new DataView(buf).getInt16(40, le);
}

describe('samples: NIfTI sweep', needsAny('NIfTI samples', niiFiles), () => {
  it(`found NIfTI samples (n=${niiFiles.length})`, () => {
    assert.ok(niiFiles.length > 0, 'no .nii samples');
  });
  it('every NIfTI parses with sane geometry + intensities', () => {
    for (const f of niiFiles) {
      const raw = readFileSync(join(SAMPLES, f));
      const buf = Uint8Array.from(raw).buffer as ArrayBuffer;
      assert.equal(isNIFTI1(buf), true, `${f}: not NIFTI-1 magic`);
      const h = readHeader(buf);
      const [nx, ny, nz] = h.dims;
      assert.ok(nx > 0 && ny > 0 && nz > 0, `${f}: bad dims ${h.dims}`);
      for (let i = 1; i <= 3; i++) {
        assert.ok(Number.isFinite(h.pixDims[i]) && h.pixDims[i]! > 0, `${f}: bad pixdim[${i}]`);
      }
      for (const row of h.affine) for (const v of row) assert.ok(Number.isFinite(v), `${f}: affine NaN`);
      // 4D (cardiac_patient021_4d): header carries dims[4]=nt; exact-size check is 3D-only
      const is4D = dim0(buf, h.littleEndian) === 4;
      const img = readImage(h, buf);
      if (!is4D) {
        assert.equal(img.byteLength, Math.floor((nx * ny * nz * h.numBitsPerVoxel) / 8), f);
      } else {
        assert.ok(img.byteLength > 0 && buf.byteLength >= img.byteLength, `${f}: 4D short read`);
      }
      // intensity sanity on first volume (strided scan)
      const n = nx * ny * nz;
      const view: ArrayLike<number> =
        h.dtype === 'int16' ? new Int16Array(img)
        : h.dtype === 'uint16' ? new Uint16Array(img)
        : h.dtype === 'int32' ? new Int32Array(img)
        : h.dtype === 'uint32' ? new Uint32Array(img)
        : h.dtype === 'float32' ? new Float32Array(img)
        : h.dtype === 'float64' ? new Float64Array(img)
        : h.dtype === 'int8' ? new Int8Array(img)
        : new Uint8Array(img);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < Math.min(n, view.length); i += 997) {
        const v = view[i]!;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      assert.ok(Number.isFinite(min) && Number.isFinite(max) && max >= min, `${f}: stats insane`);
    }
  });

  it('writer round-trips real skull-seg mask byte-identical', () => {
    const raw = readFileSync(join(SAMPLES, 'skull_case_0001_seg.nii'));
    const buf = Uint8Array.from(raw).buffer as ArrayBuffer;
    const h = readNiftiHeader(buf);
    const data = new Uint8Array(readNiftiImage(h, buf));
    const out = writeNifti1(
      { dims: h.dims, spacing: [h.pixDims[1]!, h.pixDims[2]!, h.pixDims[3]!], origin: [0, 0, 0], dtype: 'uint8', data } as Volume,
    );
    const h2 = readNiftiHeader(out);
    assert.deepEqual(h2.dims, h.dims);
    assert.deepEqual([...new Uint8Array(readNiftiImage(h2, out))], [...data]);
  });

  const pairs: [string, string][] = [
    ['brain_tumor_BraTS19_CBICA_AQN_1_flair.nii', 'brain_tumor_BraTS19_CBICA_AQN_1_seg.nii'],
    ['liver_33_img.nii', 'liver_33_seg.nii'],
    ['hepatic_vessel_tumor_227_img.nii', 'hepatic_vessel_tumor_227_seg.nii'],
    ['skull_case_0001_img.nii', 'skull_case_0001_seg.nii'],
    ['spine_ct_case_0010_img.nii', 'spine_ct_case_0010_seg.nii'],
    ['spine_11_0000_img.nii', 'spine_11_seg.nii'],
    ['volume-covid19-A-0329.nii', 'volume-covid19-A-0329_seg.nii'],
    ['brain_fluid_dlbs_0028337_img.nii', 'brain_fluid_dlbs_0028337_probmask_graymatter.nii'],
    ['brain_lession_16_rr_mni_flair.nii', 'brain_lession_16_rr_mni_lesion.nii'],
  ];
  it('all 9 img/seg pairs share dims', () => {
    for (const [img, seg] of pairs) {
      const hb = (b: Buffer) => readHeader(Uint8Array.from(b).buffer as ArrayBuffer);
      const hi = hb(readFileSync(join(SAMPLES, img)) as Buffer);
      const hs = hb(readFileSync(join(SAMPLES, seg)) as Buffer);
      assert.deepEqual(hs.dims, hi.dims, `${basename(seg)} dims ${hs.dims} vs img ${hi.dims}`);
    }
  });
});

describe('samples: DICOM sweep (dicom-parse decoder)', needsAny('DICOM samples', dcmFiles), () => {
  it(`found DICOM samples (n=${dcmFiles.length})`, () => {
    assert.ok(dcmFiles.length > 0, 'no .dcm samples');
  });
  it('all have DICM preamble magic + nonzero size', () => {
    for (const f of dcmFiles) {
      const p = join(SAMPLES, f);
      assert.ok(statSync(p).size > 132, `${f} too small`);
      const b = readFileSync(p);
      assert.equal(
        String.fromCharCode(b[128]!, b[129]!, b[130]!, b[131]!),
        'DICM',
        `${f} missing DICM magic`,
      );
    }
  });
  const decodable = dcmFiles;
  it('every DICOM decodes with sane pixels', () => {
    for (const f of decodable) {
      const buf = Uint8Array.from(readFileSync(join(SAMPLES, f))).buffer as ArrayBuffer;
      const { slice, meta } = parseDicomSlice(buf);
      assert.ok(slice.rows > 0 && slice.cols > 0, `${f}: bad dims`);
      assert.equal(slice.pixelData.length, slice.rows * slice.cols, f);
      assert.ok(meta.instanceNumber != null, `${f}: no instance number`);
      assert.ok(meta.transferSyntaxUID.length > 0, `${f}: no transfer syntax`);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < slice.pixelData.length; i += 977) {
        const v = slice.pixelData[i]!;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      assert.ok(Number.isFinite(min) && max > min, `${f} constant/degen pixels`);
    }
  });
  it('space-corrupted meta rejected with named error (ex-abdomen_ct_01 artifact)', () => {
    // Removed sample abdomen_ct_01.dcm had all 0x00 bytes in its meta header
    // replaced with 0x20 spaces (bad anonymizer) — unparseable by any
    // conformant reader. Reproduce synthetically from a valid file.
    const raw = Uint8Array.from(readFileSync(join(SAMPLES, 'abdomen_ct_03.dcm')));
    for (let i = 128; i < 600; i++) if (raw[i] === 0) raw[i] = 0x20;
    assert.throws(
      () => parseDicomSlice(raw.buffer as ArrayBuffer),
      (e: unknown) => e instanceof DicomParseError,
    );
  });
  // Synthetic samples carry near-unique seriesUIDs, so stack by filename
  // prefix as a decoder+sort+stack exercise (not a clinical series claim).
  it('all 5 series stack (decode+sort+volume)', () => {
    for (const prefix of ['abdomen_ct', 'brain_mri_2', 'cardiac', 'lung_ct', 'prostate_mri']) {
      const files = decodable.filter((f) => f.startsWith(prefix));
      assert.ok(files.length >= 3, `too few ${prefix} files`);
      const slices = files.map((f) => {
        const buf = Uint8Array.from(readFileSync(join(SAMPLES, f))).buffer as ArrayBuffer;
        return parseDicomSlice(buf).slice;
      });
      const vol = stackToVolume(sortSlices(slices));
      assert.deepEqual([...vol.dims], [slices[0]!.cols, slices[0]!.rows, slices.length], prefix);
    }
  });
});
