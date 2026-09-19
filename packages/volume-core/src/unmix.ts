// Channel unmixer + flatfield: per-channel gain/offset + background
// subtraction before the Viv composite. All pure typed-array ops, no DOM.
//
// Flatfield model: corrected = max(0, (raw − dark) · gain − bg), where
// dark = per-pixel darkfield (or scalar), gain = per-channel scalar,
// bg = per-channel background estimate (median of a border sample when
// the caller doesn't supply one).
//
// TorchIO-studied intensity audit (REFERENCE → engine-pure, TorchIO 1.2.1
// Apache-2.0, wheel METADATA verified 2026-09-18): RescaleIntensity
// (percentile-clip + min-max to [outMin,outMax]), ZNormalization (masked
// mean/std; std==0 loud like TorchIO's RuntimeError), Clamp
// (out_min/out_max, null = image min/max). Masking-method/label-maps,
// trainable landmarks (HistogramStandardization), and spatial transforms
// stay out — the loader audit needs intensity math, not a framework.
export function channelGainOffset(
  raw: ArrayLike<number>, gain: number, offset: number, out?: Float64Array,
): Float64Array {
  if (!Number.isFinite(gain) || !Number.isFinite(offset)) {
    throw new RangeError(`unmix-gain-offset: ${gain}, ${offset}`);
  }
  const n = raw.length;
  const dst = out && out.length === n ? out : new Float64Array(n);
  for (let i = 0; i < n; i++) dst[i] = raw[i]! * gain + offset;
  return dst;
}

/** Median of the frame border (default 2px) — cheap background estimate. */
export function borderBackground(frame: ArrayLike<number>, w: number, h: number, border = 2): number {
  if (w * h !== frame.length) throw new RangeError(`unmix-border-dims: ${w}x${h} vs ${frame.length}`);
  if (border < 1) throw new RangeError(`unmix-border: ${border}`);
  const vals: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < border || y < border || x >= w - border || y >= h - border) vals.push(frame[y * w + x]!);
    }
  }
  if (vals.length === 0) throw new RangeError('unmix-border-empty');
  vals.sort((a, b) => a - b);
  const m = vals.length >> 1;
  return vals.length % 2 ? vals[m]! : (vals[m - 1]! + vals[m]!) / 2;
}

/**
 * TorchIO RescaleIntensity audit: percentile-clip then min-max map to
 * [outMin, outMax] (defaults 0..1, matching RescaleIntensity's
 * out_min_max=(0,1) + percentiles=(0,100)). Empty masks warn-and-return
 * like TorchIO's RuntimeWarning path (loud, never silent); constant
 * images throw (TorchIO warns, we fail — prototype has no warning bus).
 */
export function rescaleIntensity(
  raw: ArrayLike<number>,
  opts: { outMin?: number; outMax?: number; pctLo?: number; pctHi?: number; out?: Float64Array } = {},
): Float64Array {
  const { outMin = 0, outMax = 1, pctLo = 0, pctHi = 100, out } = opts;
  if (![outMin, outMax, pctLo, pctHi].every(Number.isFinite)) {
    throw new RangeError(`unmix-rescale-params: [${outMin},${outMax}] pct [${pctLo},${pctHi}]`);
  }
  if (pctLo < 0 || pctHi > 100 || pctLo >= pctHi) throw new RangeError(`unmix-rescale-pct: [${pctLo},${pctHi}]`);
  const n = raw.length;
  if (n === 0) throw new RangeError('unmix-rescale-empty');
  const vals = Array.from(raw as ArrayLike<number>);
  const sorted = [...vals].sort((a, b) => a - b);
  const at = (p: number): number => {
    const r = (p / 100) * (n - 1);
    const lo = Math.floor(r), hi = Math.ceil(r);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (r - lo);
  };
  const lo = at(pctLo), hi = at(pctHi);
  const span = hi - lo;
  if (!(span > 0)) throw new RangeError(`unmix-rescale-constant: pct window [${lo},${hi}]`);
  const dst = out && out.length === n ? out : new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = Math.min(hi, Math.max(lo, vals[i]!));
    dst[i] = outMin + ((c - lo) / span) * (outMax - outMin);
  }
  return dst;
}

/**
 * TorchIO ZNormalization audit: (x − mean) / std over the masked values
 * (mask defaults to all-ones = TorchIO masking_method=None). std==0
 * throws unmix-znorm-std (TorchIO raises RuntimeError naming the image;
 * we name the condition). Returns a new array unless `out` fits.
 */
export function zNormalize(
  raw: ArrayLike<number>, mask?: ArrayLike<number>, out?: Float64Array,
): Float64Array {
  const n = raw.length;
  if (n === 0) throw new RangeError('unmix-znorm-empty');
  if (mask && mask.length !== n) throw new RangeError(`unmix-znorm-mask: ${mask.length} vs ${n}`);
  let sum = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (!mask || mask[i]) { sum += raw[i]!; count++; }
  }
  if (count === 0) throw new RangeError('unmix-znorm-mask-empty: no masked values');
  const mean = sum / count;
  let v = 0;
  for (let i = 0; i < n; i++) {
    if (!mask || mask[i]) { const d = raw[i]! - mean; v += d * d; }
  }
  const std = Math.sqrt(v / count);
  if (!(std > 0)) throw new RangeError('unmix-znorm-std: masked std is 0');
  const dst = out && out.length === n ? out : new Float64Array(n);
  for (let i = 0; i < n; i++) dst[i] = (raw[i]! - mean) / std;
  return dst;
}

/**
 * TorchIO Clamp audit: clamp into [outMin, outMax]; null end = image
 * min/max (matching Clamp's out_min/out_max=None convention).
 */
export function clampIntensity(
  raw: ArrayLike<number>,
  opts: { outMin?: number | null; outMax?: number | null; out?: Float64Array } = {},
): Float64Array {
  const n = raw.length;
  if (n === 0) throw new RangeError('unmix-clamp-empty');
  let lo = opts.outMin ?? null, hi = opts.outMax ?? null;
  if (lo === null || hi === null) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = raw[i]!;
      if (!Number.isFinite(v)) throw new RangeError(`unmix-clamp-nan: index ${i}`);
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (lo === null) lo = mn;
    if (hi === null) hi = mx;
  }
  if (!(lo <= hi)) throw new RangeError(`unmix-clamp-range: [${lo},${hi}]`);
  const dst = opts.out && opts.out.length === n ? opts.out : new Float64Array(n);
  for (let i = 0; i < n; i++) dst[i] = Math.min(hi, Math.max(lo, raw[i]!));
  return dst;
}

/**
 * Flatfield correct one channel: subtract darkfield (per-pixel or scalar
 * 0), apply gain, subtract background, clamp at 0. Returns a new array
 * unless `out` fits.
 */
export function flatfieldCorrect(
  raw: ArrayLike<number>,
  opts: { dark?: ArrayLike<number> | number; gain?: number; bg?: number; out?: Float64Array } = {},
): Float64Array {
  const n = raw.length;
  const { dark = 0, gain = 1, bg = 0, out } = opts;
  if (!Number.isFinite(gain) || !Number.isFinite(bg)) throw new RangeError(`unmix-flatfield: ${gain}, ${bg}`);
  if (typeof dark !== 'number' && dark.length !== n) {
    throw new RangeError(`unmix-dark-dims: ${dark.length} vs ${n}`);
  }
  const dst = out && out.length === n ? out : new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = typeof dark === 'number' ? dark : dark[i]!;
    dst[i] = Math.max(0, (raw[i]! - d) * gain - bg);
  }
  return dst;
}
