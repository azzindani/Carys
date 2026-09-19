// Variant ↔ protein residue linking: a caller-supplied codon map bridges
// genomic coordinates to protein residues without a backend alignment
// service. The map is a plain JSON file (one interval row per coding
// segment): the viewer uploads it alongside the VCF in #/tracks, and
// variant rows resolve to chain+residue targets the protein view selects.
//
// Coordinate contract: VCF POS is 1-based (vcf-depth.ts); map intervals are
// 1-based inclusive [start, end] on the same contig naming the VCF uses
// (no chr-prefix normalization — mismatched names miss loudly, never
// silently). Residue numbering is author seqId (PDB resSeq / CIF
// auth_seq_id), matching ResidueRef.seqId exactly.
export interface CodonEntry {
  /** contig name, byte-equal to the VCF CHROM */
  chrom: string;
  /** 1-based inclusive genomic interval */
  start: number;
  end: number;
  /** protein chain (PDB chain / CIF auth_asym_id) */
  chain: string;
  /** author seqId of the residue at `start` */
  resStart: number;
  /** +1 (forward) or -1 (reverse strand): seqId step per genomic base */
  strand: 1 | -1;
}

export interface ResidueTarget {
  chain: string;
  /** author seqId */
  resSeq: number;
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Loud parse of a codon-map JSON document into entries. Unknown fields
 *  pass through; misshaped rows throw `codon-map-*` (never skipped). */
export function parseCodonMap(text: string): CodonEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('bad-json: codon map is not valid JSON');
  }
  const rows = isRec(raw) && Array.isArray(raw.entries) ? raw.entries : raw;
  if (!Array.isArray(rows)) throw new Error('codon-map-shape: want an array or {entries: [...]}');
  return rows.map((r, i) => {
    const bad = (why: string): Error => new Error(`codon-map-row-${i}: ${why}`);
    if (!isRec(r)) throw bad('must be an object');
    if (typeof r.chrom !== 'string' || r.chrom.length === 0) throw bad('chrom must be a non-empty string');
    if (!Number.isInteger(r.start) || (r.start as number) < 1) throw bad('start must be a 1-based int');
    if (!Number.isInteger(r.end) || (r.end as number) < (r.start as number)) throw bad('end must be an int >= start');
    if (typeof r.chain !== 'string' || r.chain.length === 0) throw bad('chain must be a non-empty string');
    if (!Number.isInteger(r.resStart)) throw bad('resStart must be an int');
    if (r.strand !== 1 && r.strand !== -1) throw bad('strand must be 1 or -1');
    return {
      chrom: r.chrom, start: r.start as number, end: r.end as number,
      chain: r.chain, resStart: r.resStart as number, strand: r.strand,
    };
  });
}

/**
 * Resolve one 1-based genomic position to a residue target. Codon-aware:
 * entry starts open their codon (the answer is the entry's resStart), and
 * interior bases walk forward within that codon (resStart + offset, capped
 * at the codon's span). Document order still decides ties; outside every
 * interval returns null (intergenic/UTR is a miss, not an error). The
 * start-opens rule keeps hand-authored single-base maps exact while
 * translated entries (whose starts sit mid-codon after a splice carry)
 * resolve through the same codon the G1 tests pin.
 */
export function variantToResidue(map: CodonEntry[], chrom: string, pos: number): ResidueTarget | null {
  if (!Number.isInteger(pos) || pos < 1) throw new RangeError(`codon-map-pos: ${pos}`);
  for (const e of map) {
    if (e.chrom !== chrom) continue;
    if (pos < e.start || pos > e.end) continue;
    // codon-aware: interior bases stay inside the opened codon. Single-base
    // entries answer verbatim; multi-base spans add the offset.
    const off = pos - e.start;
    const span = e.end - e.start;
    return { chain: e.chain, resSeq: e.resStart + (span === 0 ? 0 : e.strand * off) };
  }
  return null;
}

/** Resolve a VCF row list to per-row targets (null = unmapped). Pure map
 *  over variantToResidue; row order preserved. */
export function linkVariants(
  map: CodonEntry[], rows: { chrom: string; pos: number }[],
): (ResidueTarget | null)[] {
  return rows.map((r) => variantToResidue(map, r.chrom, r.pos));
}

// --- G1 GTF CDS translation: real transcript alignment (GTF CDS rows →
// codon translation) so variant↔residue links need no caller-supplied map.
// The caller uploads a GTF; CDS rows grouped by transcript_id become codon
// maps whose resStart counts codons from the CDS start (1-based). Residue
// numbering is transcript-codon ordinal (codon 1 = first translated codon),
// matching author seqId only when the structure covers the CDS from its
// start — the UI labels the map as transcript-ordinal so the mismatch is
// visible, never silent. SOURCES: same igv.js GTF grammar as genome.ts.

/** One translated transcript: transcript_id + its codon map entries. */
export interface TranscriptMap {
  /** GTF transcript_id (stable key for the picker + audit). */
  transcriptId: string;
  /** gene_id when present (teaching context, never a claim). */
  geneId: string | null;
  /** seqid (contig) the CDS rows came from. */
  chrom: string;
  /** Codon-ordered entries: entry i covers codon i+1 of the transcript. */
  entries: CodonEntry[];
}

/**
 * Translate GTF CDS rows into per-transcript codon maps. Groups CDS rows
 * by transcript_id, orders each group by genomic start (strand-aware:
 * minus-strand transcripts walk the CDS from the highest start down, so
 * codon 1 sits at the translation start), and emits 3bp codon intervals
 * with resStart counting codons from 1. Non-CDS rows are ignored; rows
 * without transcript_id throw (fail-loud named error, never a silent
 * merge). CDS lengths that are not multiples of 3 keep the trailing
 * partial codon out of the map and report it via `partialCodons`.
 */
export function translateGtfCds(
  input: string | Uint8Array,
): { transcripts: TranscriptMap[]; partialCodons: { transcriptId: string; leftoverBp: number }[] } {
  // Local line split (genome.ts lineReader is a generator; here a plain
  // array keeps the grouping pass readable and the module dependency-free).
  const text = typeof input === 'string' ? input : new TextDecoder().decode(input);
  interface CdsRow { seqid: string; start: number; end: number; strand: string; transcriptId: string; geneId: string | null }
  const rows: CdsRow[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f.length < 9 || f[2] !== 'CDS') continue;
    const attrs = parseGtfAttrsForCodon(f[8]!);
    const tid = attrs.transcript_id;
    if (!tid) throw new Error('gtf-cds-no-transcript-id: CDS row without transcript_id cannot group');
    rows.push({
      seqid: f[0]!, start: parseInt(f[3]!, 10), end: parseInt(f[4]!, 10),
      strand: f[6]!, transcriptId: tid, geneId: attrs.gene_id ?? null,
    });
  }
  for (const [i, r] of rows.entries()) {
    if (!r.seqid || !Number.isInteger(r.start) || r.start < 1 || !Number.isInteger(r.end) || r.end < r.start) {
      throw new Error(`gtf-cds-row-${i}: bad interval ${r.seqid}:${r.start}-${r.end}`);
    }
    if (r.strand !== '+' && r.strand !== '-') throw new Error(`gtf-cds-row-${i}: strand must be +|-`);
  }
  const byTx = new Map<string, CdsRow[]>();
  for (const r of rows) {
    const g = byTx.get(r.transcriptId) ?? [];
    g.push(r);
    byTx.set(r.transcriptId, g);
  }
  const transcripts: TranscriptMap[] = [];
  const partialCodons: { transcriptId: string; leftoverBp: number }[] = [];
  for (const [tid, group] of [...byTx.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const minus = group[0]!.strand === '-';
    if (!group.every((r) => r.seqid === group[0]!.seqid && r.strand === group[0]!.strand)) {
      throw new Error(`gtf-cds-split-transcript: ${tid} spans contigs/strands`);
    }
    const ordered = [...group].sort((a, b) => (minus ? b.start - a.start : a.start - b.start));
    const entries: CodonEntry[] = [];
    let codon = 1;
    let carry = 0; // bases carried from a short exon into the next codon
    for (const exon of ordered) {
      let p = exon.start;
      let len = exon.end - exon.start + 1;
      if (carry > 0 && carry < 3) {
        // finish the open codon with the head of this exon (splice-aware:
        // codons span exon boundaries in transcript order)
        const need = 3 - carry;
        if (len >= need) {
          entries.push({
            chrom: exon.seqid, start: p, end: p + need - 1,
            chain: tid, resStart: codon, strand: minus ? -1 : 1,
          });
          codon++;
          p += need;
          len -= need;
        }
        carry = 0;
      }
      while (len >= 3) {
        entries.push({
          chrom: exon.seqid, start: p, end: p + 2,
          chain: tid, resStart: codon, strand: minus ? -1 : 1,
        });
        codon++;
        p += 3;
        len -= 3;
      }
      carry = len; // 0, 1, or 2 trailing bases wait for the next exon
    }
    if (carry > 0) partialCodons.push({ transcriptId: tid, leftoverBp: carry });
    transcripts.push({ transcriptId: tid, geneId: group[0]!.geneId, chrom: group[0]!.seqid, entries });
  }
  return { transcripts, partialCodons };
}

/** GTF-flavored attribute parse (key "value"; shared shape, local copy so
 *  codon-map.ts stays import-free of genome.ts internals). */
function parseGtfAttrsForCodon(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(';')) {
    const t = part.trim();
    if (!t) continue;
    const m = /^(\S+)\s+(.*)$/.exec(t);
    if (!m) continue;
    const v = m[2]!.trim();
    out[m[1]!] = v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
  }
  return out;
}
