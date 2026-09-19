// Progressive + tiled volume streaming: fetch an OME-Zarr (t,c,z,y,x)
// volume in tile batches with progress + abort, assembling a Float64
// display volume. Same chunk path CellsView uses (OmeZarrStore.getTile),
// generalized from one (c,z) slice to a (t,c,z) list. Pure orchestration
// over the store — no DOM, AbortSignal throughout.
//
// What stays out (documented): out-of-core paging past the VOL_BUDGET
// (callers check byte size first), multi-resolution blending (level is
// fixed per call).
import type { OmeZarrStore } from './omezarr.js';

export interface TileProgress {
  done: number;
  total: number;
  label: string;
}

/**
 * Stream one (t, c, z-range) brick into a display volume. Tiles are
 * fetched row-band by row-band (bandRows tall) so progress is smooth and
 * aborts land between bands, not mid-volume. Throws `tiled-abort` on
 * signal, `tiled-dims` when the level lacks y/x.
 */
export async function streamBrick(
  store: OmeZarrStore,
  opts: {
    t?: number; c: number; z0: number; z1: number; level?: number;
    bandRows?: number; signal?: AbortSignal;
    onProgress?: (p: TileProgress) => void;
  },
): Promise<{ dims: [number, number, number]; data: Float64Array }> {
  const { t = 0, c, z0, z1, level = 0, bandRows = 64, signal, onProgress } = opts;
  if (!Number.isInteger(c) || c < 0) throw new RangeError(`tiled-channel: ${c}`);
  if (!Number.isInteger(z0) || !Number.isInteger(z1) || z0 < 0 || z1 < z0) {
    throw new RangeError(`tiled-zrange: ${z0}..${z1}`);
  }
  const lv = store.levels[level];
  if (!lv) throw new RangeError(`tiled-level: ${level} of ${store.levels.length}`);
  const iy = lv.meta.axes.indexOf('y'), ix = lv.meta.axes.indexOf('x');
  if (iy < 0 || ix < 0) throw new RangeError('tiled-dims: level lacks y/x axes');
  const w = lv.meta.shape[ix]!, h = lv.meta.shape[iy]!;
  const nz = z1 - z0 + 1;
  const data = new Float64Array(w * h * nz);
  const bands = Math.ceil(h / bandRows);
  const total = bands * nz;
  let done = 0;
  for (let z = z0; z <= z1; z++) {
    for (let b = 0; b < bands; b++) {
      if (signal?.aborted) throw new Error('tiled-abort');
      const y = b * bandRows;
      const bh = Math.min(bandRows, h - y);
      const tile = await store.getTile({ s: level, c, z, ...(store.meta.axes.includes('t') ? { t } : {}), x: 0, y, w, h: bh });
      // tiles arrive as raw dtype bytes: normalize through Number()
      for (let i = 0; i < w * bh; i++) {
        data[(z - z0) * w * h + y * w + i] = tile[i]!;
      }
      done++;
      onProgress?.({ done, total, label: `z${z} band ${b + 1}/${bands}` });
    }
  }
  return { dims: [w, h, nz], data };
}

/** Byte size of a planned brick (callers gate against VOL_BUDGET first). */
export function brickBytes(w: number, h: number, nz: number): number {
  return w * h * nz * 8;
}
