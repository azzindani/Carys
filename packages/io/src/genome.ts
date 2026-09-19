// Ported from igv.js parsers (Phase 2 staged): GFF3/GTF decode subset,
// BED decode, DataWrapper nextLine, inferFileFormat ext sniff.
// FASTA/VCF already in seq.ts.

export interface BedFeature {
  chr: string;
  start: number;
  end: number;
  name?: string;
  score?: number;
  strand?: string;
}

export interface GffFeature {
  seqid: string;
  source: string;
  type: string;
  start: number;
  end: number;
  score?: number;
  strand?: string;
  attributes: Record<string, string>;
}

/** Line reader over string|bytes (igv dataWrapper nextLine). */
export function* lineReader(input: string | Uint8Array): Generator<string> {
  const text = typeof input === 'string' ? input : new TextDecoder().decode(input);
  let s = 0;
  while (s <= text.length) {
    const e = text.indexOf('\n', s);
    if (e === -1) {
      yield text.slice(s).replace(/\r$/, '');
      break;
    }
    yield text.slice(s, e).replace(/\r$/, '');
    s = e + 1;
  }
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const unquote = (v: string): string => {
    const t = v.trim();
    return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
  };
  for (const part of s.split(';')) {
    const t = part.trim();
    if (!t) continue;
    const eq = t.indexOf('=');
    if (eq !== -1) {
      // GFF3 form: key=value (values may still quote + percent-encode).
      out[t.slice(0, eq).trim()] = decodeURIComponent(unquote(t.slice(eq + 1)));
      continue;
    }
    // GTF form: key "value" (space-separated, quoted). Without this arm
    // every GTF attribute parsed to {} and transcript grouping silently
    // found nothing — the G1 lane needs the real keys.
    const m = /^(\S+)\s+(.*)$/.exec(t);
    if (!m) continue;
    out[m[1]!] = decodeURIComponent(unquote(m[2]!));
  }
  return out;
}

/** GFF3/GTF subset (igv gff.js decodeGFF3/decodeGTF). */
export function parseGff(input: string | Uint8Array): GffFeature[] {
  const out: GffFeature[] = [];
  for (const line of lineReader(input)) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f.length < 9) continue;
    out.push({
      seqid: f[0], source: f[1], type: f[2],
      start: parseInt(f[3], 10), end: parseInt(f[4], 10),
      score: f[5] === '.' ? undefined : parseFloat(f[5]),
      strand: f[6] === '.' ? undefined : f[6],
      attributes: parseAttrs(f[8]),
    });
  }
  return out;
}

/** BED subset (igv ucsc.js decodeBed). */
export function parseBed(input: string | Uint8Array): BedFeature[] {
  const out: BedFeature[] = [];
  for (const line of lineReader(input)) {
    if (!line || line.startsWith('#') || line.startsWith('track')) continue;
    const f = line.split('\t');
    if (f.length < 3) continue;
    out.push({
      chr: f[0],
      start: parseInt(f[1], 10),
      end: parseInt(f[2], 10),
      name: f[3],
      score: f[4] !== undefined ? parseFloat(f[4]) : undefined,
      strand: f[5],
    });
  }
  return out;
}

const EXT_FORMAT: Record<string, string> = {
  vcf: 'vcf', bcf: 'vcf', gff: 'gff', gff3: 'gff', gtf: 'gff',
  bed: 'bed', fa: 'fasta', fasta: 'fasta', '2bit': 'twobit',
  bw: 'bigwig', bigwig: 'bigwig', bam: 'bam', cram: 'cram',
};

/** Format sniff by extension (igv inferFileFormat, ext arm only). */
export function inferFileFormat(filename: string): string {
  const lower = filename.toLowerCase();
  const exts = Object.keys(EXT_FORMAT).sort((a, b) => b.length - a.length);
  for (const e of exts) {
    if (lower.endsWith('.' + e) || lower.endsWith('.' + e + '.gz')) return EXT_FORMAT[e];
  }
  return 'unknown';
}
