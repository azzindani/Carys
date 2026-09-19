import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { depthHistogram, parseVcfDepth, vcfDepth } from '../vcf-depth.js';

const VCF = [
  '##fileformat=VCFv4.2',
  '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tsample',
  'chr1\t100\t.\tA\tG\t.\t.\tDP=30\tGT:AD\t0/1:20,10',
  'chr1\t200\t.\tC\tT\t.\t.\t.\tGT:AD\t0/1:5,15',
  'chr1\t300\t.\tG\tA\t.\t.\tDP=12\tGT\t0/1',
  'chr1\t400\t.\tT\tC\t.\t.\t.\tGT\t0/1',
].join('\n');

describe('vcf depth', () => {
  it('AD refines DP, FORMAT-less rows keep DP, bare rows stay null', () => {
    const vs = parseVcfDepth(VCF);
    assert.equal(vs.length, 4);
    assert.equal(vs[0]!.depth, 30); // AD sum 20+10 refines DP=30
    assert.equal(vs[0]!.altFrac, 10 / 30);
    assert.equal(vs[1]!.depth, 20); // AD only
    assert.equal(vs[1]!.altFrac, 15 / 20);
    assert.equal(vs[2]!.depth, 12); // INFO DP only
    assert.equal(vs[2]!.altFrac, null);
    assert.equal(vs[3]!.depth, null); // nothing recorded ≠ 0
    assert.equal(vs[3]!.altFrac, null);
  });
  it('short rows throw, histogram bins known depths', () => {
    assert.throws(() => parseVcfDepth('chr1\t100'), /vcf-depth-columns/);
    const vs = parseVcfDepth(VCF);
    const h = depthHistogram(vs, 3, 30);
    assert.equal(h.counts.reduce((a, b) => a + b, 0), 3); // 3 known depths
    assert.deepEqual(depthHistogram([], 5), { edges: [], counts: [] });
    assert.throws(() => depthHistogram(vs, 0), /vcf-depth-bins/);
  });
  it('vcfDepth unit: malformed AD ignored, DP kept', () => {
    const v = vcfDepth('chr2', 50, 'A', 'T', 'DP=7', 'GT:AD', '0/1:xx');
    assert.equal(v.depth, 7);
    assert.equal(v.altFrac, null);
  });
});
