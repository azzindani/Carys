import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'fflate';
import {
  OmeZarrStore, OmeZarrError, chunkElements, chunkKey, decodeChunk,
  parseMultiscales, parseZArray, tileKey, type FetchFn,
} from '../omezarr.js';
import { parsePlateAttrs, parseWellAttrs, wellImageUrl } from '../ome-plate.js';
// V4 reference: MIT-licensed zarrita decodes the same vendored bytes
// independently. Test-only import (io stays dependency-free); the
// comparison proves our chunk math against the reference reader.

// Synthetic store: axes c,z,y,x — shape [2,2,5,6], chunks [1,1,4,4].
// Pixel value = global (y*6+x) % 251, so every tile has hand-computable bytes.
const SHAPE = [2, 2, 5, 6], CHUNKS = [1, 1, 4, 4];

function chunkBytes(c: number, z: number, cy: number, cx: number): Uint8Array {
  const out: number[] = [];
  const y0 = cy * 4, x0 = cx * 4;
  for (let y = y0; y < Math.min(y0 + 4, 5); y++) {
    for (let x = x0; x < Math.min(x0 + 4, 6); x++) out.push((y * 6 + x) % 251);
  }
  void c; void z;
  return Uint8Array.from(out);
}

function zarray(compressor: unknown = null): object {
  return {
    zarr_format: 2, shape: SHAPE, chunks: CHUNKS, dtype: '|u1',
    compressor, fill_value: 0, order: 'C',
    filters: null,
  };
}

function zattrs(): object {
  return {
    multiscales: [{
      axes: [{ name: 'c' }, { name: 'z' }, { name: 'y' }, { name: 'x' }],
      datasets: [{ path: '0' }],
    }],
  };
}

/** In-memory store fronted as fetch; records every URL hit. */
function fakeFetch(opts: { compressor?: unknown; gzipChunk?: string; missing?: string[] } = {}): { fetchFn: FetchFn; hits: string[] } {
  const files = new Map<string, Uint8Array | object>();
  files.set('https://z/arr/.zattrs', zattrs());
  files.set('https://z/arr/0/.zarray', zarray(opts.compressor));
  for (let c = 0; c < 2; c++) {
    for (let z = 0; z < 2; z++) {
      for (let cy = 0; cy < 2; cy++) {
        for (let cx = 0; cx < 2; cx++) {
          let bytes = chunkBytes(c, z, cy, cx);
          const key = `${c}.${z}.${cy}.${cx}`;
          if (opts.gzipChunk === key) bytes = gzipSync(bytes);
          files.set(`https://z/arr/0/${key}`, bytes);
        }
      }
    }
  }
  for (const m of opts.missing ?? []) files.delete(m);
  const hits: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    hits.push(url);
    const f = files.get(url);
    if (!f) return new Response('nope', { status: 404 });
    if (f instanceof Uint8Array) return new Response(f as unknown as BodyInit);
    return Response.json(f);
  };
  return { fetchFn, hits };
}

describe('omezarr live path', () => {
  it('open reads multiscales + zarray into meta', async () => {
    const { fetchFn } = fakeFetch();
    const store = await OmeZarrStore.open('https://z/arr', fetchFn);
    assert.deepEqual(store.meta.axes, ['c', 'z', 'y', 'x']);
    assert.deepEqual(store.meta.shape, SHAPE);
    assert.deepEqual(store.meta.chunks, CHUNKS);
    assert.equal(store.meta.dtype, 'uint8');
    assert.equal(store.arrayPath, '0');
  });
  it('rejects v3, fortran, blosc, unknown dtype, 404 with named codes', async () => {
    const bad = (mut: (z: Record<string, unknown>) => void, url = 'https://z/arr/0/.zarray'): FetchFn => {
      const { fetchFn: base } = fakeFetch();
      return (async (u: string, init?: RequestInit) => {
        if (u === url) {
          const z = zarray() as Record<string, unknown>;
          mut(z);
          return Response.json(z);
        }
        return base(u, init);
      }) as FetchFn;
    };
    const za = zarray() as Record<string, unknown>;
    assert.throws(() => parseZArray({ ...za, zarr_format: 3 }), (e: unknown) => e instanceof OmeZarrError && e.code === 'bad-meta');
    assert.throws(() => parseZArray({ ...za, order: 'F' }), (e: unknown) => e instanceof OmeZarrError && e.code === 'bad-order');
    assert.throws(() => parseZArray({ ...za, compressor: { id: 'blosc' } }), (e: unknown) => e instanceof OmeZarrError && e.code === 'unsupported-compressor');
    assert.throws(() => parseZArray({ ...za, dtype: '<f8' }), (e: unknown) => e instanceof OmeZarrError && e.code === 'bad-dtype');
    assert.throws(() => parseMultiscales({}), (e: unknown) => e instanceof OmeZarrError);
    await assert.rejects(OmeZarrStore.open('https://z/arr', bad((z) => { z['compressor'] = { id: 'lz4' }; })), (e: unknown) => e instanceof OmeZarrError && e.code === 'unsupported-compressor');
    await assert.rejects(
      OmeZarrStore.open('https://z/arr', fakeFetch({ missing: ['https://z/arr/0/.zarray'] }).fetchFn),
      (e: unknown) => e instanceof OmeZarrError && e.code === 'http',
    );
  });
  it('chunks decode exactly, edges truncate, cache hits identical', async () => {
    const { fetchFn, hits } = fakeFetch();
    const store = await OmeZarrStore.open('https://z/arr', fetchFn);
    assert.equal(chunkElements(SHAPE, CHUNKS, [0, 0, 0, 0]), 16);
    assert.equal(chunkElements(SHAPE, CHUNKS, [1, 1, 1, 1]), 2);
    assert.equal(chunkKey([1, 0, 1, 0]), '1.0.1.0');
    const full = await store.getChunk([0, 0, 0, 0]);
    assert.deepEqual([...full], [0, 1, 2, 3, 6, 7, 8, 9, 12, 13, 14, 15, 18, 19, 20, 21]);
    const edge = await store.getChunk([0, 0, 1, 1]);
    assert.deepEqual([...edge], [28, 29]);
    assert.equal(await store.getChunk([0, 0, 0, 0]), full, 'no cache hit');
    assert.equal(hits.filter((u) => u.endsWith('/0.0.0.0')).length, 1);
    await assert.rejects(store.getChunk([0, 0, 0, 5]), (e: unknown) => e instanceof OmeZarrError);
    assert.throws(
      () => decodeChunk(new Uint8Array([1, 2, 3]), SHAPE, CHUNKS, [0, 0, 0, 0], 'uint8', 'none'),
      (e: unknown) => e instanceof OmeZarrError && e.code === 'bad-chunk-size',
    );
  });
  it('gzip chunks decode through fflate', async () => {
    const { fetchFn } = fakeFetch({ gzipChunk: '0.0.0.0', compressor: { id: 'gzip' } });
    const store = await OmeZarrStore.open('https://z/arr', fetchFn);
    assert.equal(store.compressor, 'gzip');
    const back = await store.getChunk([0, 0, 0, 0]);
    assert.deepEqual([...back], [0, 1, 2, 3, 6, 7, 8, 9, 12, 13, 14, 15, 18, 19, 20, 21]);
  });
  it('pyramid levels open together, tile per level, caches isolated', async () => {
    // level 0: 4x4 values y*4+x; level 1: 2x2 floor-means [2,4,10,12]
    const l0 = Uint8Array.from({ length: 16 }, (_, i) => i);
    const l1 = Uint8Array.from([2, 4, 10, 12]);
    const files = new Map<string, Uint8Array | object>([
      ['https://z/pyr/.zattrs', {
        multiscales: [{
          axes: [{ name: 'c' }, { name: 'z' }, { name: 'y' }, { name: 'x' }],
          datasets: [{ path: '0' }, { path: '1' }],
        }],
      }],
      ['https://z/pyr/0/.zarray', {
        zarr_format: 2, shape: [1, 1, 4, 4], chunks: [1, 1, 4, 4],
        dtype: '|u1', compressor: null, fill_value: 0, order: 'C', filters: null,
      }],
      ['https://z/pyr/1/.zarray', {
        zarr_format: 2, shape: [1, 1, 2, 2], chunks: [1, 1, 2, 2],
        dtype: '|u1', compressor: null, fill_value: 0, order: 'C', filters: null,
      }],
      ['https://z/pyr/0/0.0.0.0', l0],
      ['https://z/pyr/1/0.0.0.0', l1],
    ]);
    const hits: string[] = [];
    const fetchFn: FetchFn = (async (url: string) => {
      hits.push(url);
      const f = files.get(url);
      if (!f) return new Response('nope', { status: 404 });
      if (f instanceof Uint8Array) return new Response(f as unknown as BodyInit);
      return Response.json(f);
    }) as FetchFn;
    const store = await OmeZarrStore.open('https://z/pyr', fetchFn);
    assert.equal(store.levels.length, 2);
    assert.deepEqual(store.levels[1]!.meta.shape, [1, 1, 2, 2]);
    assert.deepEqual(store.meta.shape, [1, 1, 4, 4]);
    assert.equal(store.arrayPath, '0');
    assert.deepEqual([...await store.getTile({ s: 0, c: 0, z: 0, x: 0, y: 0, w: 4, h: 4 })], [...l0]);
    assert.deepEqual([...await store.getTile({ s: 1, c: 0, z: 0, x: 0, y: 0, w: 2, h: 2 })], [2, 4, 10, 12]);
    const c0 = await store.getChunk([0, 0, 0, 0], 0);
    const c1 = await store.getChunk([0, 0, 0, 0], 1);
    assert.deepEqual([...c0], [...l0]);
    assert.deepEqual([...c1], [2, 4, 10, 12]);
    assert.equal(hits.filter((u) => u.endsWith('/0/0.0.0.0')).length, 1);
    assert.equal(hits.filter((u) => u.endsWith('/1/0.0.0.0')).length, 1);
    await assert.rejects(store.getTile({ s: 2, c: 0, z: 0, x: 0, y: 0, w: 1, h: 1 }), (e: unknown) => e instanceof OmeZarrError && e.code === 'bad-level');
    await assert.rejects(store.getChunk([0, 0, 0, 0], 2), (e: unknown) => e instanceof OmeZarrError && e.code === 'bad-level');
  });
  it('tile assembles exact pixels across chunk seams', async () => {
    const { fetchFn, hits } = fakeFetch();
    const store = await OmeZarrStore.open('https://z/arr', fetchFn);
    assert.equal(tileKey({ s: 0, c: 1, z: 1, x: 0, y: 0, w: 6, h: 5 }), 's0/c1/z1/y0-5/x0-6');
    // rect straddling all four y/x chunks of channel 1, z 1
    const t = await store.getTile({ s: 0, c: 1, z: 1, x: 2, y: 3, w: 4, h: 2 });
    assert.deepEqual([...t], [20, 21, 22, 23, 26, 27, 28, 29]);
    for (const k of ['1.1.0.0', '1.1.0.1', '1.1.1.0', '1.1.1.1']) {
      assert.ok(hits.some((u) => u.endsWith(`/0/${k}`)), `chunk ${k} never fetched`);
    }
    // single-chunk tile, channel 0
    const t0 = await store.getTile({ s: 0, c: 0, z: 0, x: 0, y: 0, w: 4, h: 4 });
    assert.deepEqual([...t0], [0, 1, 2, 3, 6, 7, 8, 9, 12, 13, 14, 15, 18, 19, 20, 21]);
    await assert.rejects(store.getTile({ s: 1, c: 0, z: 0, x: 0, y: 0, w: 1, h: 1 }), (e: unknown) => e instanceof OmeZarrError && e.code === 'bad-level');
    await assert.rejects(store.getTile({ s: 0, c: 5, z: 0, x: 0, y: 0, w: 1, h: 1 }), (e: unknown) => e instanceof OmeZarrError && e.code === 'bad-tile');
    await assert.rejects(store.getTile({ s: 0, c: 0, z: 0, x: 5, y: 0, w: 2, h: 1 }), (e: unknown) => e instanceof OmeZarrError && e.code === 'bad-tile');
  });
});

// Vendored sample store (samples/cells_demo.zarr, written by
// scripts/gen-cells-zarr.mjs): the same OmeZarrStore path, but over a
// disk-backed fetch instead of an in-memory map. Goldens below are exact
// pixel values + integer channel sums from the generator.

const ZARR_DIR = join(process.cwd(), 'samples', 'cells_demo.zarr');

/** File-backed fetch: maps store-relative URLs onto the vendored tree. */
function diskFetch(base: string): FetchFn {
  return (async (url: string) => {
    if (!url.startsWith(`${base}/`)) return new Response('nope', { status: 404 });
    const rel = url.slice(base.length + 1);
    if (rel.includes('..')) return new Response('nope', { status: 404 });
    try {
      const bytes = Uint8Array.from(readFileSync(join(ZARR_DIR, rel)));
      return new Response(bytes as unknown as BodyInit);
    } catch {
      return new Response('nope', { status: 404 });
    }
  }) as FetchFn;
}

const sum = (a: Uint8Array): number => a.reduce((s, v) => s + v, 0);

describe('omezarr vendored store', () => {
  it('opens from disk with both pyramid levels', async () => {
    const store = await OmeZarrStore.open('file://cells_demo', diskFetch('file://cells_demo'));
    assert.equal(store.levels.length, 2);
    assert.deepEqual(store.meta.axes, ['c', 'z', 'y', 'x']);
    assert.deepEqual(store.meta.shape, [2, 1, 128, 128]);
    assert.deepEqual(store.meta.chunks, [1, 1, 64, 64]);
    assert.equal(store.compressor, 'none');
    assert.deepEqual(store.levels[1]!.meta.shape, [2, 1, 64, 64]);
    assert.equal(store.levels[1]!.compressor, 'gzip');
  });
  it('tiles match goldens, seams assemble, sums fingerprint channels', async () => {
    const store = await OmeZarrStore.open('file://cells_demo', diskFetch('file://cells_demo'));
    // blob centers + ring peaks (discriminating, not background)
    const b1 = await store.getTile({ s: 0, c: 0, z: 0, x: 40, y: 44, w: 1, h: 1 });
    const b2 = await store.getTile({ s: 0, c: 0, z: 0, x: 88, y: 80, w: 1, h: 1 });
    const r1 = await store.getTile({ s: 0, c: 1, z: 0, x: 64, y: 24, w: 1, h: 1 });
    assert.deepEqual([...b1], [255]);
    assert.deepEqual([...b2], [255]);
    assert.deepEqual([...r1], [228]);
    // chunk seams assemble: horizontal pair straddles x=64 (c0),
    // vertical pair straddles y=64 (c1)
    const seamH = await store.getTile({ s: 0, c: 0, z: 0, x: 63, y: 64, w: 2, h: 1 });
    const seamV = await store.getTile({ s: 0, c: 1, z: 0, x: 32, y: 63, w: 1, h: 2 });
    assert.deepEqual([...seamH], [97, 100]);
    assert.deepEqual([...seamV], [99, 98]);
    // whole-channel integer sums fingerprint the pattern exactly
    const full0 = await store.getTile({ s: 0, c: 0, z: 0, x: 0, y: 0, w: 128, h: 128 });
    const full1 = await store.getTile({ s: 0, c: 1, z: 0, x: 0, y: 0, w: 128, h: 128 });
    assert.equal(sum(full0), 953327);
    assert.equal(sum(full1), 962268);
    // gzip level decodes and downsamples (floor-mean: sums close, not equal)
    const small0 = await store.getTile({ s: 1, c: 0, z: 0, x: 0, y: 0, w: 64, h: 64 });
    assert.equal(sum(small0), 237206);
    const peak = await store.getTile({ s: 1, c: 1, z: 0, x: 32, y: 12, w: 1, h: 1 });
    assert.ok(peak[0]! > 150, `ring peak blurred away: ${peak[0]}`);
  });
});

const PLATE_DIR = join(process.cwd(), 'samples', 'plate_demo.zarr');

/** File-backed fetch over the vendored plate (mirrors diskFetch above). */
function plateFetch(base: string): FetchFn {
  return (async (url: string) => {
    if (!url.startsWith(`${base}/`)) return new Response('nope', { status: 404 });
    const rel = url.slice(base.length + 1);
    if (rel.includes('..')) return new Response('nope', { status: 404 });
    try {
      const bytes = Uint8Array.from(readFileSync(join(PLATE_DIR, rel)));
      return new Response(bytes as unknown as BodyInit);
    } catch {
      return new Response('nope', { status: 404 });
    }
  }) as FetchFn;
}

describe('omezarr vendored plate', () => {
  it('plate root resolves both wells to openable image stores', async () => {
    const base = 'file://plate';
    const za = await (await plateFetch(base)(`${base}/.zattrs`)).json();
    const plate = parsePlateAttrs(za)!;
    assert.deepEqual(plate.wells.map((w) => w.path), ['A/01', 'B/02']);
    const means: Record<string, number> = {};
    for (const wellRef of plate.wells) {
      const wa = await (await plateFetch(base)(`${base}/${wellRef.path}/.zattrs`)).json();
      const well = parseWellAttrs(wa)!;
      const store = await OmeZarrStore.open(wellImageUrl(base, wellRef, well), plateFetch(base));
      const t = await store.getTile({ s: 0, c: 0, z: 0, x: 0, y: 0, w: 32, h: 32 });
      means[wellRef.path] = t.reduce((s, v) => s + v, 0) / t.length;
    }
    // Generator fingerprints: corner block vs diagonal ramp.
    assert.equal(means['A/01'], 57.5);
    assert.equal(means['B/02'], 127.5);
  });
});

// V4 zarrita comparison (TOOLING): the MIT reference reader decodes the
// same vendored cells_demo bytes. Byte-equality per chunk (both pyramid
// levels) + one seam tile proves our chunk math, edge truncation, and
// gzip path against an independent implementation. Disagreements would
// become goldens; today there are none. zarrita + FileSystemStore stay
// test-only — io ships dependency-free.
describe('omezarr vs zarrita reference', () => {
  it('every chunk byte-equal on both levels + seam tile agrees', async () => {
    const zarr = await import('zarrita');
    const { FileSystemStore } = await import('@zarrita/storage');
    const store = await OmeZarrStore.open('file://cells_demo', diskFetch('file://cells_demo'));
    for (let s = 0; s < 2; s++) {
      const lv = store.levels[s]!;
      const ref = (await zarr.open.v2(
        new FileSystemStore(join(ZARR_DIR, lv.path)) as never, { kind: 'array' } as never,
      )) as unknown as { shape: number[]; getChunk: (idx: number[]) => Promise<{ data: Uint8Array }> };
      assert.deepEqual(ref.shape, lv.meta.shape, `level ${s} shape drift`);
      const n = lv.meta.shape.map((len, d) => Math.ceil(len / lv.meta.chunks[d]!));
      for (let c = 0; c < n[0]!; c++) {
        for (let z = 0; z < n[1]!; z++) {
          for (let y = 0; y < n[2]!; y++) {
            for (let x = 0; x < n[3]!; x++) {
              const idx = [c, z, y, x];
              const mine = await store.getChunk(idx, s);
              const theirs = (await ref.getChunk(idx)).data;
              assert.deepEqual([...mine], [...theirs], `level ${s} chunk ${chunkKey(idx)} drifted`);
            }
          }
        }
      }
    }
    // seam tile through our assembler vs zarrita full-read slice
    const seam = await store.getTile({ s: 0, c: 0, z: 0, x: 63, y: 64, w: 2, h: 1 });
    assert.deepEqual([...seam], [97, 100]);
  });
});
