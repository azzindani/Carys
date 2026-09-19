import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFasta, parseVcf } from '../seq.js';
import { sortSlices, stackToVolume } from '../dicom.js';
import { isNiftiLike } from '../nifti.js';
import { lineReader } from '../genome.js';

describe('seq', () => {
  it('parses FASTA records', () => {
    const recs = parseFasta('>a desc\nACGT\n>b\nTT\n');
    assert.deepEqual(recs, [
      { id: 'a', seq: 'ACGT' },
      { id: 'b', seq: 'TT' },
    ]);
  });
  it('parses VCF variants, skips headers', () => {
    const vars = parseVcf('##x\n#CHROM\tPOS\tID\tREF\tALT\nchr1\t100\t.\tA\tT\n');
    assert.deepEqual(vars, [{ chrom: 'chr1', pos: 100, ref: 'A', alt: 'T' }]);
  });
});

describe('dicom series', () => {
  it('sorts by instance number and stacks rows into volume', () => {
    const mk = (n: number, v: number) => ({
      instanceNumber: n, rows: 1, cols: 2,
      pixelData: Uint16Array.from([v, v]),
    });
    const sorted = sortSlices([mk(3, 30), mk(1, 10), mk(2, 20)] as never[]);
    assert.deepEqual(sorted.map((s) => s.instanceNumber), [1, 2, 3]);
    const vol = stackToVolume(sorted);
    assert.deepEqual([...vol.dims], [2, 1, 3]);
    assert.equal(vol.data[0], 10);
  });
});

describe('nifti sniff', () => {
  it('rejects non-nifti magic', () => {
    assert.equal(isNiftiLike(new Uint8Array(348)), false);
  });
});

describe('lineReader', () => {
  it('splits CRLF and LF', () => {
    assert.deepEqual([...lineReader('a\r\nb\nc')], ['a', 'b', 'c']);
  });
});
