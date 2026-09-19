// Port of Viv loader+cache + Neuroglancer chunk_manager (CPU cut).
// Viv: loadOmeZarr/loadOmeTiff -> { data: PixelSource[], metadata }, deck.gl
// layers. We steal loader shape + LRU chunk cache, replace deck.gl with CPU
// tile slicer. Neuroglancer: frontend UI thread + backend Worker for queue /
// download / preprocess — same split we already use.

export interface ChunkKey {
  /** e.g. "s0/c2/z17/y0-256/x0-256" */
  key: string;
}

export class LruChunkCache<T> {
  private map = new Map<string, T>();
  constructor(public maxEntries = 128) {}
  get(k: string): T | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: T): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }
  get size(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
}

/** Channel composite on CPU: N channel tiles -> RGBA (replaces Viv shader). */
export function compositeChannels(
  channels: Uint8Array[],
  colors: [number, number, number][],
  outRgba: Uint8ClampedArray,
): void {
  const n = outRgba.length / 4;
  for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0;
    for (let c = 0; c < channels.length; c++) {
      const v = channels[c][i];
      r += v * (colors[c]?.[0] ?? 1);
      g += v * (colors[c]?.[1] ?? 1);
      b += v * (colors[c]?.[2] ?? 1);
    }
    const o = i * 4;
    outRgba[o] = Math.min(255, r);
    outRgba[o + 1] = Math.min(255, g);
    outRgba[o + 2] = Math.min(255, b);
    outRgba[o + 3] = 255;
  }
}
