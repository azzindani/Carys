// Ported from Viv types/loaders + Vizarr utils (MIT/Apache-2).
// Steals: PixelSource interface, DTYPE max table, channel stats +
// contrast math, hex/defaults, tile-size/interleave, 2D fit.
// Replaces deck.gl/XRLayer compositing with CPU compositeChannelsViv.

export type SupportedDtype =
  | 'Uint8' | 'Uint16' | 'Uint32' | 'Float32' | 'Float64'
  | 'Int8' | 'Int16' | 'Int32';

export type SupportedTypedArray =
  | Uint8Array | Uint16Array | Uint32Array | Float32Array | Float64Array
  | Int8Array | Int16Array | Int32Array;

export type Labels = string[];

export interface RasterSelection {
  selection: Record<string, number>;
  signal?: AbortSignal;
}

export interface TileSelection extends RasterSelection {
  x: number;
  y: number;
}

export interface PixelData {
  data: SupportedTypedArray;
  width: number;
  height: number;
}

export interface PixelSource {
  getRaster(sel: RasterSelection): Promise<PixelData>;
  getTile(sel: TileSelection): Promise<PixelData>;
  onTileError(err: Error): void;
  shape: number[];
  dtype: SupportedDtype;
  labels: Labels;
  tileSize: number;
}

export const MAX_CHANNELS = 10;

export const DTYPE_VALUES: Record<SupportedDtype, { min: number; max: number }> = {
  Uint8: { min: 0, max: 255 },
  Uint16: { min: 0, max: 65535 },
  Uint32: { min: 0, max: 4294967295 },
  Int8: { min: -128, max: 127 },
  Int16: { min: -32768, max: 32767 },
  Int32: { min: -2147483648, max: 2147483647 },
  Float32: { min: -3.4e38, max: 3.4e38 },
  // 1.8e308 is past Number.MAX_VALUE (1.7976931348623157e308), so the literal
  // rounded to Infinity and this row described an unbounded range rather than
  // a float64's. The named constant is the value that was meant.
  Float64: { min: -Number.MAX_VALUE, max: Number.MAX_VALUE },
};

export interface ChannelStats {
  min: number; max: number; mean: number; sd: number;
  median: number; q1: number; q3: number;
  domain: [number, number];
  contrastLimits: [number, number];
}

/** Channel stats (Viv getChannelStats): 0.05%/99.95% of non-zero as limits. */
export function getChannelStats(data: ArrayLike<number>): ChannelStats {
  const vals: number[] = [];
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    if (v !== 0) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  const q = (p: number) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : min);
  const mean = data.length ? sum / data.length : 0;
  let sd = 0;
  if (vals.length > 1) {
    let s2 = 0;
    for (const v of vals) s2 += (v - mean) ** 2;
    sd = Math.sqrt(s2 / vals.length);
  }
  const lo = q(0.0005), hi = q(0.9995);
  return {
    min, max, mean, sd, median: q(0.5), q1: q(0.25), q3: q(0.75),
    domain: [min, max], contrastLimits: [lo, hi],
  };
}

/** Hidden channel -> [max,max] so it renders black (Viv padContrastLimits). */
export function padContrastLimit(
  limit: [number, number] | null,
  domain: [number, number],
): [number, number] {
  if (limit === null) return [domain[1], domain[1]];
  return limit;
}

/**
 * CPU channel composite (Viv xr-layer GLSL on CPU):
 * norm = max(0,(v-lo)/max(0.0005,hi-lo)); rgb += clamp(norm)*color/255.
 */
export function compositeChannelsViv(
  channels: ArrayLike<number>[],
  limits: [number, number][],
  colors: [number, number, number][],
  outRgba: Uint8ClampedArray,
): void {
  const n = outRgba.length / 4;
  for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0;
    for (let c = 0; c < channels.length; c++) {
      const v = channels[c][i];
      const [lo, hi] = limits[c];
      const norm = Math.max(0, (v - lo) / Math.max(0.0005, hi - lo));
      const k = Math.min(1, norm);
      r += k * (colors[c][0] / 255);
      g += k * (colors[c][1] / 255);
      b += k * (colors[c][2] / 255);
    }
    const o = i * 4;
    outRgba[o] = Math.min(255, Math.round(r * 255));
    outRgba[o + 1] = Math.min(255, Math.round(g * 255));
    outRgba[o + 2] = Math.min(255, Math.round(b * 255));
    outRgba[o + 3] = 255;
  }
}

export function hexToRGB(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const DEFAULT_COLORS: [number, number, number][] = [
  [0, 255, 255], [255, 0, 255], [255, 255, 0], [0, 255, 0], [255, 0, 0],
];

export function defaultVisibilities(n: number): boolean[] {
  return Array.from({ length: n }, (_, i) => i < 3);
}

/** deck.gl pow2 requirement: 2^floor(log2(min(chunkY,chunkX))). */
export function guessTileSize(chunkY: number, chunkX: number): number {
  return 2 ** Math.floor(Math.log2(Math.min(chunkY, chunkX)));
}

export function isInterleavedLabels(labels: Labels): boolean {
  const last = labels[labels.length - 1];
  return last === '_c';
}

/** Pyramid resolution pick: clamp(round(-zoom)) into [0, levels). */
export function resolveScale(zoom: number, levels: number): number {
  return Math.min(levels - 1, Math.max(0, Math.round(-zoom)));
}

/** 2D image->canvas fit (Vizarr fitImageToViewport, no Matrix4). */
export function fitImage(
  imgW: number, imgH: number, viewW: number, viewH: number,
): { scaleX: number; scaleY: number; tx: number; ty: number } {
  const s = Math.min(viewW / imgW, viewH / imgH);
  return { scaleX: s, scaleY: s, tx: (viewW - imgW * s) / 2, ty: (viewH - imgH * s) / 2 };
}
