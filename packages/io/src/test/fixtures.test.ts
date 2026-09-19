import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseBed, parseGff } from '../genome.js';
import { parseFasta, parseVcf } from '../seq.js';
import { sortSlices, stackToVolume } from '../dicom.js';
import { isNiftiLike } from '../nifti.js';
import {
  BED1, BED1_EXPECTED, GFF1, GFF1_EXPECTED_ATTRS,
  FASTA1, FASTA1_EXPECTED, VCF1, VCF1_EXPECTED,
  niftiMagicBytes, dicomSeriesShuffled,
  DICOM_SERIES_EXPECTED_ORDER, DICOM_SERIES_EXPECTED_DIMS,
} from './fixtures.js';

describe('canonical fixtures', () => {
  it('BED1', () => {
    assert.deepEqual(parseBed(BED1), [BED1_EXPECTED]);
  });
  it('GFF1', () => {
    const [f] = parseGff(GFF1);
    assert.deepEqual(f!.attributes, GFF1_EXPECTED_ATTRS);
  });
  it('FASTA1', () => {
    assert.deepEqual(parseFasta(FASTA1), FASTA1_EXPECTED);
  });
  it('VCF1', () => {
    assert.deepEqual(parseVcf(VCF1), VCF1_EXPECTED);
  });
  it('NIfTI magic recognized', () => {
    assert.equal(isNiftiLike(niftiMagicBytes()), true);
  });
  it('shuffled DICOM series sorts and stacks', () => {
    const sorted = sortSlices(dicomSeriesShuffled() as never[]);
    assert.deepEqual(sorted.map((s) => s.instanceNumber), DICOM_SERIES_EXPECTED_ORDER);
    assert.deepEqual([...stackToVolume(sorted).dims], DICOM_SERIES_EXPECTED_DIMS);
  });
});
