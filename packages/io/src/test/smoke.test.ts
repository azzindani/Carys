import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseBed, parseGff, inferFileFormat } from '../genome.js';

describe('genome parsers', () => {
  it('parses BED lines', () => {
    const feats = parseBed('chr1\t100\t200\tgeneA\t960\t+\n');
    assert.deepEqual(feats, [
      { chr: 'chr1', start: 100, end: 200, name: 'geneA', score: 960, strand: '+' },
    ]);
  });
  it('parses GFF3 lines', () => {
    const feats = parseGff('chr1\tsrc\tgene\t1000\t2000\t.\t+\t.\tID=g1;Name=BRCA1\n');
    assert.equal(feats.length, 1);
    assert.equal(feats[0]!.attributes['Name'], 'BRCA1');
  });
  it('sniffs formats by extension', () => {
    assert.equal(inferFileFormat('x.vcf.gz'), 'vcf');
    assert.equal(inferFileFormat('x.bed'), 'bed');
    assert.equal(inferFileFormat('x.gff3'), 'gff');
    assert.equal(inferFileFormat('x.???'), 'unknown');
  });
});
