import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needs, sample } from '@carys/testkit';
import { parseDicomFrames, type DicomFileMeta, type ParsedDicomSlice } from '../dicom-parse.js';
import { groupDicomStacks, stackLabel, stackVoxels } from '../dicom-stack.js';

type V3 = [number, number, number];

function meta(over: Partial<DicomFileMeta>): DicomFileMeta {
  return {
    transferSyntaxUID: '1.2.840.10008.1.2.1', rows: 2, cols: 2, bitsAllocated: 16, bitsStored: 16,
    pixelRepresentation: 1, samplesPerPixel: 1, numberOfFrames: 1, photometric: 'MONOCHROME2',
    slope: 1, intercept: 0, windowCenter: null, windowWidth: null, instanceNumber: 1,
    sliceLocation: null, seriesUID: '1.2.3', sopClassUID: '1.2.840.10008.5.1.4.1.1.2',
    ipp: null, iop: [1, 0, 0, 0, 1, 0], pixelSpacing: [0.5, 0.7], sliceThickness: 2.5,
    imagerPixelSpacing: null, spacingBetweenSlices: null, laterality: null, imageLaterality: null,
    viewPosition: null, patientName: null, patientID: null, studyUID: '1.2', seriesNumber: 3,
    modality: 'CT', studyDate: null, seriesDescription: 'Chest', frameTimeMs: null, cineFps: null,
    ...over,
  };
}

/** One 2x2 slice at z (mm) whose pixels all read `v`. */
function slice(z: number, inst: number, v: number, over: Partial<DicomFileMeta> = {}): ParsedDicomSlice {
  const ipp: V3 = [-10, -20, z];
  const m = meta({ ipp, instanceNumber: inst, ...over });
  return {
    slice: { instanceNumber: inst, rows: 2, cols: 2, pixelData: Int16Array.from([v, v, v, v]) },
    meta: m,
  };
}

describe('dicom stacks', () => {
  it('orders by position along the normal, not by instance number', () => {
    const [s] = groupDicomStacks([slice(10, 1, 3), slice(0, 2, 1), slice(5, 3, 2)]);
    assert.deepEqual(s!.slices.map((p) => p.meta.ipp![2]), [0, 5, 10]);
    assert.deepEqual([...stackVoxels(s!)].filter((_, i) => i % 4 === 0), [1, 2, 3]);
    // PixelSpacing is (row, column) = (Δj, Δi): i steps 0.7, j steps 0.5
    assert.deepEqual(s!.spacing, [0.7, 0.5, 5]);
    assert.deepEqual(s!.origin, [-10, -20, 0]);
    assert.deepEqual(s!.warnings, []);
  });

  it('never stacks two series into one volume', () => {
    const a = [slice(0, 1, 1), slice(5, 2, 1)];
    const b = [slice(2, 1, 9, { seriesUID: '9.9' })];
    const stacks = groupDicomStacks([...a, ...b]);
    assert.equal(stacks.length, 2);
    assert.deepEqual(stacks.map((s) => s.slices.length), [2, 1]);
    assert.deepEqual(stacks.map((s) => s.seriesUID), ['1.2.3', '9.9']);
  });

  it('splits a localizer out of its series by orientation', () => {
    const axial = [slice(0, 1, 1), slice(5, 2, 1)];
    const scout = slice(0, 3, 7, { iop: [0, 1, 0, 0, 0, -1] });
    assert.equal(groupDicomStacks([...axial, scout]).length, 2);
  });

  it('splits evenly repeated positions into phases', () => {
    const t0 = [slice(0, 1, 10), slice(5, 2, 11)];
    const t1 = [slice(0, 3, 20), slice(5, 4, 21)];
    const stacks = groupDicomStacks([...t1, ...t0]);
    assert.equal(stacks.length, 2);
    assert.deepEqual(stacks.map((s) => s.phase), [{ index: 0, count: 2 }, { index: 1, count: 2 }]);
    assert.deepEqual(stacks.map((s) => s.slices.map((p) => p.slice.instanceNumber)), [[1, 2], [3, 4]]);
    assert.match(stackLabel(stacks[1]!), /phase 2\/2/);
  });

  it('keeps one slice per position when repeats are uneven, and says so', () => {
    const [s] = groupDicomStacks([slice(0, 1, 1), slice(0, 2, 2), slice(5, 3, 3)]);
    assert.equal(s!.slices.length, 2);
    assert.equal(s!.slices[0]!.slice.instanceNumber, 1);
    assert.deepEqual(s!.warnings.map((w) => w.code), ['duplicate-position']);
  });

  it('flags a sparse stack whose gaps disagree', () => {
    const [s] = groupDicomStacks([slice(0, 1, 1), slice(3, 2, 1), slice(40, 3, 1)]);
    assert.deepEqual(s!.warnings.map((w) => w.code), ['non-uniform-spacing']);
    assert.match(s!.warnings[0]!.message, /3–37 mm/);
  });

  it('flags a tilted gantry (positions shear off the normal)', () => {
    const tilted = [0, 1, 2, 3].map((k) => {
      const p = slice(k * 5, k + 1, 1);
      p.meta = { ...p.meta, ipp: [-10, -20 + k * 1.5, k * 5] };
      return p;
    });
    const [s] = groupDicomStacks(tilted);
    assert.deepEqual(s!.warnings.map((w) => w.code), ['gantry-tilt']);
  });

  it('falls back to instance order when files carry no geometry', () => {
    const bare = [2, 1].map((n) => slice(0, n, n, { iop: null, ipp: null }));
    const [s] = groupDicomStacks(bare);
    assert.equal(s!.direction, null);
    assert.equal(s!.origin, null);
    assert.equal(s!.spacing[2], 2.5);
    assert.deepEqual(s!.slices.map((p) => p.slice.instanceNumber), [1, 2]);
    assert.deepEqual(s!.warnings.map((w) => w.code), ['no-position']);
  });
});

describe('dicom stacks on the vendored samples', () => {
  const read = (f: string): ParsedDicomSlice[] => {
    const b = readFileSync(sample(f)!);
    return parseDicomFrames(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };

  it('lung_ct_0x are five separate exams, not one volume', needs('lung_ct_01.dcm'), () => {
    const parts = [1, 2, 3, 4, 5].flatMap((i) => read(`lung_ct_0${i}.dcm`));
    const stacks = groupDicomStacks(parts);
    assert.equal(stacks.length, 5);
    assert.ok(stacks.every((s) => s.slices.length === 1));
  });

  it('the cardiac CTA picks are one series with gaps flagged', needs('cardiac_01.dcm'), () => {
    const parts = [1, 2, 4, 5].flatMap((i) => read(`cardiac_0${i}.dcm`));
    const [s, ...rest] = groupDicomStacks(parts);
    assert.equal(rest.length, 0);
    assert.equal(s!.slices.length, 4);
    // positions ascend along +normal (feet → head for an axial stack)
    const z = s!.slices.map((p) => p.meta.ipp![2]);
    assert.deepEqual(z, [...z].sort((a, b) => a - b));
    assert.ok(s!.warnings.some((w) => w.code === 'non-uniform-spacing'));
  });

  it('prostate DCE keeps one image per position and reports the repeat', needs('prostate_mri_01.dcm'), () => {
    const parts = [1, 2, 3, 4, 5].flatMap((i) => read(`prostate_mri_0${i}.dcm`));
    const [s] = groupDicomStacks(parts);
    assert.equal(s!.slices.length, 4);
    assert.ok(s!.warnings.some((w) => w.code === 'duplicate-position'));
  });

  it('keeps fractional MR rescale values instead of rounding them', needs('prostate_mri_01.dcm'), () => {
    const [p] = read('prostate_mri_01.dcm');
    // slope 2.70891332626: modality values are not integers
    assert.ok(p!.slice.pixelData instanceof Float32Array);
    assert.ok([...p!.slice.pixelData.subarray(0, 4096)].some((v) => v !== Math.trunc(v)));
  });

  it('keeps CT on the exact int16 path', needs('abdomen_ct_03.dcm'), () => {
    const [p] = read('abdomen_ct_03.dcm');
    assert.ok(p!.slice.pixelData instanceof Int16Array);
  });
});
