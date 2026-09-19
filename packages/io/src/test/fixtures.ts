// Canonical synthetic fixtures — committed, deterministic, no patient data.
// Text fixtures as TS modules so they compile into dist/ with the tests
// (tsc does not copy raw files). Binary fixtures built in-code.

/** 1-line BED + expected parse. */
export const BED1 = 'chr1\t100\t200\tgeneA\t960\t+\n';
export const BED1_EXPECTED = {
  chr: 'chr1', start: 100, end: 200, name: 'geneA', score: 960, strand: '+',
};

/** 1-line GFF3 + expected attributes. */
export const GFF1 = 'chr1\tsrc\tgene\t1000\t2000\t.\t+\t.\tID=g1;Name=BRCA1\n';
export const GFF1_EXPECTED_ATTRS = { ID: 'g1', Name: 'BRCA1' };

/** 2-record FASTA + expected. */
export const FASTA1 = '>a desc\nACGT\n>b\nTT\n';
export const FASTA1_EXPECTED = [
  { id: 'a', seq: 'ACGT' },
  { id: 'b', seq: 'TT' },
];

/** 1-variant VCF + expected. */
export const VCF1 = '##x\n#CHROM\tPOS\tID\tREF\tALT\nchr1\t100\t.\tA\tT\n';
export const VCF1_EXPECTED = [{ chrom: 'chr1', pos: 100, ref: 'A', alt: 'T' }];

/** Minimal NIfTI-like magic: int32 348 little-endian. */
export function niftiMagicBytes(): Uint8Array {
  const b = new Uint8Array(348);
  new DataView(b.buffer).setInt32(0, 348, true);
  return b;
}

/** 3-slice shuffled DICOM series (instance numbers out of order). */
export function dicomSeriesShuffled() {
  const mk = (n: number, v: number) => ({
    instanceNumber: n, rows: 1, cols: 2,
    pixelData: Uint16Array.from([v, v]),
  });
  return [mk(3, 30), mk(1, 10), mk(2, 20)];
}
export const DICOM_SERIES_EXPECTED_ORDER = [1, 2, 3];
export const DICOM_SERIES_EXPECTED_DIMS = [2, 1, 3];
