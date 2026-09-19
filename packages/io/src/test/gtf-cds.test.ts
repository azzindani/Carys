import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translateGtfCds, variantToResidue } from '../codon-map.js';

// G1 GTF CDS translation: transcript alignment (GTF CDS → codon
// translation) so variant↔residue links need no caller-supplied map.
// Synthetic GTF text (no patient data): one multi-exon plus-strand
// transcript (T, 9bp = 3 codons, carry across the exon boundary), one
// partial (P, 7bp = 2 codons + 1 leftover), one minus-strand (M).
const GTF =
  'chr1\tsrc\tCDS\t100\t104\t.\t+\t0\tgene_id "G"; transcript_id "T";\n' +
  'chr1\tsrc\tCDS\t200\t203\t.\t+\t0\tgene_id "G"; transcript_id "T";\n' +
  'chr1\tsrc\tCDS\t300\t306\t.\t+\t0\tgene_id "G"; transcript_id "P";\n' +
  'chr1\tsrc\tCDS\t400\t402\t.\t-\t0\tgene_id "G"; transcript_id "M";\n' +
  'chr1\tsrc\tCDS\t500\t502\t.\t-\t0\tgene_id "G"; transcript_id "M";\n' +
  'chr1\tsrc\texon\t100\t502\t.\t+\t.\tgene_id "G"; transcript_id "T";\n';

describe('gtf cds translation', () => {
  it('splice-aware codons: carry crosses the exon boundary', () => {
    const { transcripts, partialCodons } = translateGtfCds(GTF);
    assert.deepEqual(transcripts.map((t) => t.transcriptId), ['M', 'P', 'T']);
    const t = transcripts.find((x) => x.transcriptId === 'T')!;
    assert.equal(t.geneId, 'G');
    assert.equal(t.chrom, 'chr1');
    assert.deepEqual(t.entries, [
      { chrom: 'chr1', start: 100, end: 102, chain: 'T', resStart: 1, strand: 1 },
      // codon 2 spans the boundary: last base of exon 1 + first 2 of exon 2
      { chrom: 'chr1', start: 200, end: 200, chain: 'T', resStart: 2, strand: 1 },
      { chrom: 'chr1', start: 201, end: 203, chain: 'T', resStart: 3, strand: 1 },
    ]);
    assert.deepEqual(partialCodons.filter((p) => p.transcriptId === 'T'), []);
  });
  it('partial trailing codon reported, minus strand walks down', () => {
    const { transcripts, partialCodons } = translateGtfCds(GTF);
    const p = transcripts.find((x) => x.transcriptId === 'P')!;
    assert.equal(p.entries.length, 2);
    assert.deepEqual(partialCodons, [{ transcriptId: 'P', leftoverBp: 1 }]);
    const m = transcripts.find((x) => x.transcriptId === 'M')!;
    // minus strand: codon 1 sits at the highest start (translation start)
    assert.equal(m.entries[0]!.start, 500);
    assert.equal(m.entries[0]!.strand, -1);
    assert.equal(m.entries[1]!.start, 400);
  });
  it('translated maps resolve variants through the shared lookup', () => {
    const { transcripts } = translateGtfCds(GTF);
    const t = transcripts.find((x) => x.transcriptId === 'T')!;
    // per-base rule: entry starts open their codon; interior bases walk
    // forward inside it (pos 101 = second base of codon 1 → resSeq 2).
    assert.deepEqual(variantToResidue(t.entries, 'chr1', 100), { chain: 'T', resSeq: 1 });
    assert.deepEqual(variantToResidue(t.entries, 'chr1', 101), { chain: 'T', resSeq: 2 });
    // pos 200 opens codon 2 (carry-completed entry 200-200, resStart 2)
    assert.deepEqual(variantToResidue(t.entries, 'chr1', 200), { chain: 'T', resSeq: 2 });
    assert.equal(variantToResidue(t.entries, 'chr1', 150), null);
  });
  it('hostile input fails loud with named errors', () => {
    assert.throws(
      () => translateGtfCds('chr1\tsrc\tCDS\t100\t102\t.\t+\t0\tgene_id "G";\n'),
      /gtf-cds-no-transcript-id/,
    );
    assert.throws(
      () => translateGtfCds(
        'chr1\tsrc\tCDS\t100\t102\t.\t+\t0\tgene_id "G"; transcript_id "S";\n' +
        'chr2\tsrc\tCDS\t100\t102\t.\t+\t0\tgene_id "G"; transcript_id "S";\n',
      ),
      /gtf-cds-split-transcript/,
    );
    assert.throws(
      () => translateGtfCds('chr1\tsrc\tCDS\tx\t102\t.\t+\t0\tgene_id "G"; transcript_id "S";\n'),
      /gtf-cds-row-0/,
    );
  });
  it('non-CDS rows ignored; empty input yields no transcripts', () => {
    const r = translateGtfCds('chr1\tsrc\texon\t100\t200\t.\t+\t.\tgene_id "G"; transcript_id "E";\n');
    assert.deepEqual(r.transcripts, []);
    assert.deepEqual(r.partialCodons, []);
  });
});
