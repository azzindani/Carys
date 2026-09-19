// Ported from igv.js search.js parseLocusString + locus.js Locus +
// referenceFrame.js math (bpPerPixel/toBP/toPixels). No DOM/viewports.

export interface Locus {
  chr: string;
  start: number; // 0-based
  end: number;
}

export function parseLocusString(s: string): Locus | null {
  const m = s.trim().match(/^(\S+):([\d,]+)-([\d,]+)$/);
  if (!m) return null;
  const [, chr, s0, s1] = m;
  const start = parseInt(s0.replace(/,/g, ''), 10) - 1;
  const end = parseInt(s1.replace(/,/g, ''), 10);
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end <= start) return null;
  return { chr, start, end };
}

export function locusString(l: Locus): string {
  return `${l.chr}:${l.start + 1}-${l.end}`;
}

export function lociOverlap(a: Locus, b: Locus): boolean {
  return a.chr === b.chr && a.start < b.end && b.start < a.end;
}

/** ReferenceFrame math: bp<->pixel without viewports. */
export function bpPerPixel(locus: Locus, viewportWidth: number): number {
  return (locus.end - locus.start) / Math.max(1, viewportWidth);
}

export function toPixels(bp: number, locus: Locus, bpp: number): number {
  return (bp - locus.start) / bpp;
}

export function toBP(px: number, locus: Locus, bpp: number): number {
  return Math.floor(locus.start + px * bpp);
}
