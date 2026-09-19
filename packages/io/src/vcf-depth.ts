// VCF allele depth: per-variant DP/AD parsing + depth histogram for the
// tracks view. FORMAT-less rows degrade to depth-unknown (null) rather
// than 0 — 0 is a measured value, unknown is unknown. BAM pileup stays
// out: BGZF + index in-browser is its own project (documented, loud).
import type { Variant } from './seq.js';

export interface VariantDepth extends Variant {
  /** total depth (DP) or AD sum; null when unrecorded */
  depth: number | null;
  /** alt-allele fraction 0..1; null without AD */
  altFrac: number | null;
}

/** Parse the INFO/FORMAT tail of one VCF data line into depth fields. */
export function vcfDepth(
  chrom: string, pos: number, ref: string, alt: string,
  info: string, formatKeys: string, sample: string,
): VariantDepth {
  const base: VariantDepth = { chrom, pos, ref, alt, depth: null, altFrac: null };
  // INFO DP first (cheap, sample-independent)
  const dp = /(?:^|;)DP=(\d+)/.exec(info ?? '');
  if (dp) base.depth = parseInt(dp[1]!, 10);
  // FORMAT AD refines: AD=a,b → depth=a+b, altFrac=b/(a+b)
  const keys = (formatKeys ?? '').split(':');
  const vals = (sample ?? '').split(':');
  const ai = keys.indexOf('AD');
  if (ai >= 0 && vals[ai]) {
    const ads = vals[ai]!.split(',').map((v) => parseInt(v, 10));
    if (ads.length >= 2 && ads.every((v) => Number.isFinite(v) && v >= 0)) {
      const total = ads.reduce((a, b) => a + b, 0);
      if (total > 0) {
        base.depth = total;
        base.altFrac = ads.slice(1).reduce((a, b) => a + b, 0) / total;
      }
    }
  }
  return base;
}

/** Parse a VCF text (or its data lines) into depth-annotated variants. */
export function parseVcfDepth(text: string): VariantDepth[] {
  const out: VariantDepth[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f.length < 8) throw new Error(`vcf-depth-columns: ${f.length} (want ≥8)`);
    out.push(vcfDepth(
      f[0]!, parseInt(f[1]!, 10), f[3]!, f[4]!, f[7] ?? '', f[8] ?? '', f[9] ?? '',
    ));
  }
  return out;
}

/**
 * Depth histogram over variants with known depth: `bins` equal-width bins
 * from 0..maxDepth (default = data max). Returns bin edges + counts.
 */
export function depthHistogram(
  variants: VariantDepth[], bins = 10, maxDepth?: number,
): { edges: number[]; counts: number[] } {
  if (!Number.isInteger(bins) || bins < 1) throw new RangeError(`vcf-depth-bins: ${bins}`);
  const ds = variants.map((v) => v.depth).filter((d): d is number => d !== null);
  if (ds.length === 0) return { edges: [], counts: [] };
  const max = maxDepth ?? Math.max(...ds);
  if (!(max > 0)) throw new RangeError(`vcf-depth-max: ${max}`);
  const edges = Array.from({ length: bins + 1 }, (_, i) => (i * max) / bins);
  const counts = new Array<number>(bins).fill(0);
  for (const d of ds) {
    const b = Math.min(bins - 1, Math.floor((d / max) * bins));
    counts[b]!++;
  }
  return { edges, counts };
}
