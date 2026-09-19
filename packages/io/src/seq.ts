// Port of igv.js track parsers (minimal FASTA/VCF/GFF subset for Phase 2).
// Genome tracks come in Week 3+; here just the parsers behind one interface.

export interface SeqRecord { id: string; seq: string }
export interface Variant { chrom: string; pos: number; ref: string; alt: string }

export function parseFasta(text: string): SeqRecord[] {
  const out: SeqRecord[] = [];
  let cur: SeqRecord | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('>')) {
      cur = { id: line.slice(1).split(/\s/)[0], seq: '' };
      out.push(cur);
    } else if (cur && line.trim()) {
      cur.seq += line.trim();
    }
  }
  return out;
}

export function parseVcf(text: string): Variant[] {
  const out: Variant[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [chrom, pos, , ref, alt] = line.split('\t');
    out.push({ chrom, pos: parseInt(pos, 10), ref, alt });
  }
  return out;
}
