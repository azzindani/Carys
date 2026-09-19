// View-parameterized LRU cache keys: cine + MIP scrub repaint the same
// slice under different display params, so the key must encode every input
// that changes the pixels (WL, LUT, projection, slab, obliquity, frame).
// A key missing one input is a stale-image bug, not a perf win — hence one
// canonical builder both sides share.
export interface ViewParams {
  series: string;
  plane: string;
  slice: number;
  wlW: number;
  wlC: number;
  lut: string;
  proj: string;
  slab: number;
  oblA: number;
  oblB: number;
  invert: boolean;
  frame?: number;
  compare?: string;
  compareMode?: string;
}

/** Canonical cache key: every pixel-changing input, fixed order. */
export function viewCacheKey(p: ViewParams): string {
  const num = (v: number): string => (Number.isFinite(v) ? String(v) : 'nan');
  return [
    p.series, p.plane, String(p.slice),
    `W${num(p.wlW)}C${num(p.wlC)}`, p.lut, p.proj, String(p.slab),
    `A${num(p.oblA)}B${num(p.oblB)}`, p.invert ? 'inv' : 'nrm',
    `t${p.frame ?? 0}`, p.compare ? `${p.compareMode ?? '?'}@${p.compare}` : 'single',
  ].join('|');
}
