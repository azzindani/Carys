// OME-Zarr reader (zarr v2, CPU cut). Live chunk path: .zattrs multiscales
// + .zarray metadata over injected fetch, chunk GET, numcodecs decode for
// stored-raw + gzip/zlib (fflate), named errors for blosc/lz4/zstd,
// Fortran order, zarr v3, and pyramid levels > 0. Tile assembly walks the
// chunk grid for one (channel, z) slice. No deck.gl, no network by default:
// every network touch takes an explicit fetchFn (house style, testable).
import { gunzipSync, unzlibSync } from 'fflate';
import { LruChunkCache } from '@carys/volume-core';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class OmeZarrError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(`zarr ${code}: ${message}`);
    this.name = 'OmeZarrError';
    this.code = code;
  }
}

export interface OmeZarrMeta {
  axes: string[]; // e.g. ['t','c','z','y','x']
  shape: number[];
  chunks: number[];
  dtype: 'uint8' | 'uint16' | 'int16' | 'float32';
}

export interface TileRequest {
  /** scale level (index into datasets[]), channel, z */
  s: number; c: number; z: number;
  /** timepoint (stores without a t axis ignore it) */
  t?: number;
  /** tile rect in pixels */
  x: number; y: number; w: number; h: number;
}

export function tileKey(r: TileRequest): string {
  return `s${r.s}/c${r.c}/z${r.z}/y${r.y}-${r.y + r.h}/x${r.x}-${r.x + r.w}`;
}

const DTYPE_BYTES: Record<OmeZarrMeta['dtype'], number> = {
  uint8: 1, uint16: 2, int16: 2, float32: 4,
};

const DTYPE_FROM_ZARR: Record<string, OmeZarrMeta['dtype']> = {
  '|u1': 'uint8', '<u2': 'uint16', '<i2': 'int16', '<f4': 'float32',
};

export type ZarrCompressor = 'none' | 'gzip' | 'zlib';

export interface ZarrArray {
  meta: OmeZarrMeta;
  compressor: ZarrCompressor;
}

/** Validate a .zarray document; throws OmeZarrError on anything exotic. */
export function parseZArray(json: unknown): ZarrArray {
  const d = json as Record<string, unknown>;
  if (typeof d !== 'object' || d === null) throw new OmeZarrError('bad-meta', 'not an object');
  if (d['zarr_format'] !== 2) throw new OmeZarrError('bad-meta', `zarr_format ${String(d['zarr_format'])} (only v2)`);
  if (d['order'] !== 'C') throw new OmeZarrError('bad-order', 'only C-order arrays');
  const shape = d['shape'];
  const chunks = d['chunks'];
  if (!Array.isArray(shape) || !Array.isArray(chunks) || shape.length !== chunks.length ||
    shape.some((v) => !Number.isInteger(v) || (v as number) <= 0) ||
    chunks.some((v) => !Number.isInteger(v) || (v as number) <= 0)) {
    throw new OmeZarrError('bad-meta', 'shape/chunks must be parallel positive-int arrays');
  }
  const dtype = DTYPE_FROM_ZARR[String(d['dtype'])];
  if (!dtype) throw new OmeZarrError('bad-dtype', `dtype ${String(d['dtype'])} (uint8/uint16/int16/float32 only)`);
  const comp = d['compressor'] as { id?: string } | null;
  let compressor: ZarrCompressor = 'none';
  if (comp) {
    if (comp.id === 'gzip' || comp.id === 'zlib') compressor = comp.id;
    else throw new OmeZarrError('unsupported-compressor', `compressor ${comp.id} (none/gzip/zlib only)`);
  }
  return { meta: { axes: [], shape: shape as number[], chunks: chunks as number[], dtype }, compressor };
}

/**
 * Multiscales axes + every dataset path from a .zattrs document (vizarr
 * loadMultiscales pattern: open all pyramid levels, not just datasets[0]).
 */
export function parseMultiscales(zattrs: unknown): { axes: string[]; arrayPath: string; arrayPaths: string[] } {
  const d = zattrs as Record<string, unknown>;
  const ms = (d?.['multiscales'] as { axes?: unknown[]; datasets?: { path?: unknown }[] }[] | undefined)?.[0];
  if (!ms || !Array.isArray(ms.axes) || !Array.isArray(ms.datasets) || ms.datasets.length === 0 ||
    ms.datasets.some((x) => typeof x?.path !== 'string')) {
    throw new OmeZarrError('bad-meta', 'no multiscales[0].axes + datasets[].path');
  }
  const axes = ms.axes.map((a) => (typeof a === 'string' ? a : (a as { name?: unknown }).name));
  if (axes.some((a) => typeof a !== 'string') || !axes.includes('y') || !axes.includes('x')) {
    throw new OmeZarrError('bad-meta', 'axes must name y and x');
  }
  const arrayPaths = ms.datasets.map((x) => x!.path as string);
  return { axes: axes as string[], arrayPath: arrayPaths[0]!, arrayPaths };
}

/** Dot-joined chunk coords (zarr v2 key suffix). */
export function chunkKey(indices: number[]): string {
  return indices.join('.');
}

/** Stored element count of one chunk (edge chunks truncate to the array). */
export function chunkElements(shape: number[], chunks: number[], indices: number[]): number {
  let n = 1;
  for (let d = 0; d < shape.length; d++) {
    n *= Math.min(chunks[d]!, shape[d]! - indices[d]! * chunks[d]!);
  }
  return n;
}

/** Decompress + length-check one stored chunk into raw bytes. */
export function decodeChunk(stored: Uint8Array, shape: number[], chunks: number[], indices: number[], dtype: OmeZarrMeta['dtype'], compressor: ZarrCompressor): Uint8Array {
  let raw: Uint8Array;
  try {
    raw = compressor === 'gzip' ? gunzipSync(stored) : compressor === 'zlib' ? unzlibSync(stored) : stored;
  } catch (e) {
    throw new OmeZarrError('corrupt-chunk', (e as Error).message);
  }
  const want = chunkElements(shape, chunks, indices) * DTYPE_BYTES[dtype];
  if (raw.length !== want) throw new OmeZarrError('bad-chunk-size', `got ${raw.length} bytes, want ${want}`);
  return raw;
}

export interface ZarrLevel {
  path: string;
  meta: OmeZarrMeta;
  compressor: ZarrCompressor;
}

export class OmeZarrStore {
  cache = new LruChunkCache<Uint8Array>(128);
  constructor(
    public baseUrl: string,
    public levels: ZarrLevel[],
    private readonly fetchFn: FetchFn,
  ) {
    if (levels.length === 0) throw new OmeZarrError('bad-meta', 'no pyramid levels');
  }

  /** Level 0 (full resolution) conveniences. */
  get meta(): OmeZarrMeta { return this.levels[0]!.meta; }
  get arrayPath(): string { return this.levels[0]!.path; }
  get compressor(): ZarrCompressor { return this.levels[0]!.compressor; }

  /** Open a store: fetch .zattrs + every datasets[]/.zarray (vizarr). */
  static async open(baseUrl: string, fetchFn: FetchFn): Promise<OmeZarrStore> {
    const za = await fetchJson(fetchFn, `${baseUrl}/.zattrs`);
    const { axes, arrayPaths } = parseMultiscales(za);
    const levels: ZarrLevel[] = [];
    for (const path of arrayPaths) {
      const arr = parseZArray(await fetchJson(fetchFn, `${baseUrl}/${path}/.zarray`));
      levels.push({ path, meta: { ...arr.meta, axes }, compressor: arr.compressor });
    }
    return new OmeZarrStore(baseUrl, levels, fetchFn);
  }

  private dim(name: string): number {
    return this.meta.axes.indexOf(name);
  }

  /** Fetch + decode one chunk by full-dim indices (cached per level). */
  async getChunk(indices: number[], level = 0): Promise<Uint8Array> {
    const lv = this.levels[level];
    if (!lv) throw new OmeZarrError('bad-level', `level ${level} of ${this.levels.length}`);
    const key = `${level}/${chunkKey(indices)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const res = await this.fetchFn(`${this.baseUrl}/${lv.path}/${chunkKey(indices)}`);
    if (!res.ok) throw new OmeZarrError('http', `chunk ${key} -> ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const raw = decodeChunk(bytes, lv.meta.shape, lv.meta.chunks, indices, lv.meta.dtype, lv.compressor);
    this.cache.set(key, raw);
    return raw;
  }

  /**
   * Assemble a y/x rect of one (channel, z) slice at pyramid level s as raw
   * dtype bytes (length w*h*bytesPerPixel).
   */
  async getTile(r: TileRequest): Promise<Uint8Array> {
    const lv = this.levels[r.s];
    if (!lv) throw new OmeZarrError('bad-level', `level ${r.s} of ${this.levels.length}`);
    const { shape, chunks, dtype } = lv.meta;
    if (r.w <= 0 || r.h <= 0) throw new OmeZarrError('bad-tile', 'empty rect');
    const iy = this.dim('y'), ix = this.dim('x');
    const ic = this.dim('c'), iz = this.dim('z');
    const bpp = DTYPE_BYTES[dtype];
    const base = shape.map(() => 0);
    const at = (name: string, v: number): void => {
      const d = this.dim(name);
      if (d >= 0) base[d] = v;
    };
    at('c', r.c); at('z', r.z); at('t', r.t ?? 0);
    if (ic >= 0 && (r.c < 0 || r.c >= shape[ic]!)) throw new OmeZarrError('bad-tile', `channel ${r.c}`);
    if (iz >= 0 && (r.z < 0 || r.z >= shape[iz]!)) throw new OmeZarrError('bad-tile', `z ${r.z}`);
    if (r.x < 0 || r.y < 0 || r.x + r.w > shape[ix]! || r.y + r.h > shape[iy]!) {
      throw new OmeZarrError('bad-tile', 'rect outside array');
    }
    const out = new Uint8Array(r.w * r.h * bpp);
    // chunk indices + in-chunk coords of one global pixel
    const locate = (gy: number, gx: number): { idx: number[]; local: number[] } => {
      const idx: number[] = [], local: number[] = [];
      for (let d = 0; d < shape.length; d++) {
        const g = d === iy ? gy : d === ix ? gx : base[d]!;
        const ci = Math.floor(g / chunks[d]!);
        idx.push(ci);
        local.push(g - ci * chunks[d]!);
      }
      return { idx, local };
    };
    // fetch each touched chunk once
    const need = new Map<string, number[]>();
    for (let dy = 0; dy < r.h; dy++) {
      for (let dx = 0; dx < r.w; dx++) {
        const { idx } = locate(r.y + dy, r.x + dx);
        need.set(chunkKey(idx), idx);
      }
    }
    const got = new Map<string, Uint8Array>();
    for (const [k, idx] of need) got.set(k, await this.getChunk(idx, r.s));
    for (let dy = 0; dy < r.h; dy++) {
      for (let dx = 0; dx < r.w; dx++) {
        const { idx, local } = locate(r.y + dy, r.x + dx);
        const chunk = got.get(chunkKey(idx))!;
        // C-order element offset inside this chunk (truncated edge aware)
        let o = 0, st = 1;
        for (let d = shape.length - 1; d >= 0; d--) {
          o += local[d]! * st;
          st *= Math.min(chunks[d]!, shape[d]! - idx[d]! * chunks[d]!);
        }
        out.set(chunk.slice(o * bpp, o * bpp + bpp), (dy * r.w + dx) * bpp);
      }
    }
    return out;
  }
}

async function fetchJson(fetchFn: FetchFn, url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch (e) {
    throw new OmeZarrError('http', `${url}: ${(e as Error).message}`);
  }
  if (!res.ok) throw new OmeZarrError('http', `${url} -> ${res.status}`);
  try {
    return await res.json();
  } catch (e) {
    throw new OmeZarrError('bad-json', `${url}: ${(e as Error).message}`);
  }
}
