import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listSamples, needsAny } from '@carys/testkit';
import { readHeader } from '../nifti1.js';
import { parseDicomSlice } from '../dicom-parse.js';

// Fixture inventory: every sample present, non-trivial, and parsing with
// sane geometry. One `it` per file KIND (not per file — see counting rule).
const DIR = join(process.cwd(), 'samples');
const FILES = listSamples((f) => f.endsWith('.nii') || f.endsWith('.dcm'));
// Pool-safe copy: Buffer.buffer alone may alias the node slab.
const bufOf = (f: string): ArrayBuffer => Uint8Array.from(readFileSync(join(DIR, f))).buffer as ArrayBuffer;

// D1 OpenNeuro ds000001 crops: center-cut teaching fixtures (BOLD fMRI +
// structural T1 of one run from the Balloon Analog Risk-taking Task,
// CC0 per dataset_description.json). The crops carry the source affine
// shifted to the window (origin = aff @ corner), so world coordinates stay
// honest; pixDims/affine are pinned below against the vendored bytes.
const OPENNEURO_T1 = 'openneuro_ds000001_t1-crop.nii';
const OPENNEURO_BOLD = 'openneuro_ds000001_bold-f0.nii';

describe('samples matrix', needsAny('imaging samples', FILES), () => {
  it('D1 crops: provenance sidecar + CC0 registry row present', () => {
    // io stays dependency-free (study owns the validators): assert the
    // sidecar + registry shapes literally; study-side sources.test walks
    // DIGESTS.json row by row through the real validators.
    const sidecar = JSON.parse(readFileSync(join(process.cwd(), 'digests', 'openneuro-ds000001', 'SOURCES.json'), 'utf8'));
    assert.equal(sidecar.format, 'carys-sources/1');
    assert.equal(sidecar.digest, 'openneuro-ds000001');
    assert.equal(sidecar.sources[0].license_spdx, 'CC0-1.0');
    assert.equal(sidecar.sources[0].entry_count, 2);
    const reg = JSON.parse(readFileSync(join(process.cwd(), 'DIGESTS.json'), 'utf8'));
    const row = reg.digests.find((r: { id: string }) => r.id === 'openneuro-ds000001');
    assert.ok(row, 'openneuro-ds000001 missing from DIGESTS.json');
    assert.equal(row.license_spdx, 'CC0-1.0');
    assert.equal(row.lane, 'D1');
    assert.equal(row.status, 'shipped');
  });
  it('D1 crops: frozen header geometry (dims/dtype/spacing/affine)', () => {
    const t1 = readHeader(bufOf(OPENNEURO_T1));
    assert.deepEqual(t1.dims, [64, 64, 64]);
    assert.equal(t1.dtype, 'int16');
    assert.deepEqual([t1.pixDims[1], t1.pixDims[2], t1.pixDims[3]].map((v) => Number(v!.toFixed(3))), [1, 1.333, 1.333]);
    assert.deepEqual(t1.affine[0]!.map((v) => Number(v.toFixed(3))), [1, 0, 0, -35]);
    const b0 = readHeader(bufOf(OPENNEURO_BOLD));
    assert.deepEqual(b0.dims, [64, 64, 33]);
    assert.equal(b0.dtype, 'int16');
    assert.deepEqual([b0.pixDims[1], b0.pixDims[2], b0.pixDims[3]].map((v) => Number(v!.toFixed(3))), [3.125, 3.125, 4]);
    assert.deepEqual(b0.affine[0]!.map((v) => Number(v.toFixed(3))), [-3.125, 0, 0, 97.932]);
  });
  it('inventory complete', () => {
    assert.ok(FILES.length >= 40, `only ${FILES.length} samples`);
    for (const f of FILES) {
      const p = join(DIR, f);
      assert.ok(existsSync(p), f);
      assert.ok(statSync(p).size > 1024, `${f} suspiciously small`);
    }
  });
  it('every NIfTI header parses with sane dims', () => {
    for (const f of FILES.filter((x) => x.endsWith('.nii'))) {
      const h = readHeader(bufOf(f));
      const [nx, ny, nz] = h.dims;
      assert.ok(nx > 0 && ny > 0 && nz > 0, `${f} dims ${h.dims}`);
      assert.ok(nx * ny * nz < 2e9, `${f} absurd volume`);
      assert.ok(typeof h.dtype === 'string' && h.dtype.length > 0, f);
    }
  });
  it('every DICOM parses with pixel data', () => {
    for (const f of FILES.filter((x) => x.endsWith('.dcm'))) {
      const { slice, meta } = parseDicomSlice(bufOf(f));
      assert.ok(meta.rows > 0 && meta.cols > 0, f);
      assert.equal(slice.pixelData.length, meta.rows * meta.cols, f);
    }
  });
});
