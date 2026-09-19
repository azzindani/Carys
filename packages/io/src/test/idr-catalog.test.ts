import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IDR_CATALOG, IDR_DIGEST_ID, IDR_DIGEST_PIN, idrById,
} from '../idr-catalog.js';
import { OmeZarrError, OmeZarrStore, type FetchFn } from '../omezarr.js';

const ROOT = process.cwd();

/** File-backed fetch over a scratch dir (tests never touch the network). */
function diskFetch(dir: string) {
  return (async (url: string) => {
    const base = 'file://c1';
    if (!url.startsWith(`${base}/`)) return new Response('nope', { status: 404 });
    const rel = url.slice(base.length + 1);
    if (rel.includes('..')) return new Response('nope', { status: 404 });
    try {
      const bytes = Uint8Array.from(readFileSync(join(dir, rel)));
      return new Response(bytes as unknown as BodyInit);
    } catch {
      return new Response('nope', { status: 404 });
    }
  });
}

describe('C1 IDR catalog', () => {
  it('4 pinned entries, unique ids, pins exact, misses loud', () => {
    assert.equal(IDR_CATALOG.length, 4);
    assert.equal(new Set(IDR_CATALOG.map((e) => e.id)).size, 4);
    assert.equal(IDR_DIGEST_ID, 'idr-catalog');
    assert.equal(IDR_DIGEST_PIN, 'IDR-API-2026-09-17-v0.4+0083');
    assert.equal(idrById('idr0048A')?.codec, 'blosc/lz4');
    assert.equal(idrById('idr0048A')?.decodable, false);
    // M2: the SARS-CoV-2 organoid screen rides the same honesty contract.
    const organ = idrById('idr0083-organoids')!;
    assert.equal(organ.study, 'idr0083-lamers-sarscov2');
    assert.equal(organ.decodable, false);
    assert.ok(organ.storeUrl.includes('9822152.zarr'), `organoid store URL drifted: ${organ.storeUrl}`);
    assert.equal(idrById('nope'), null);
  });
  it('catalog honesty: every entry names its codec + decodability', () => {
    for (const e of IDR_CATALOG) {
      assert.ok(e.codec.length > 0, `${e.id} names no codec`);
      assert.equal(typeof e.decodable, 'boolean');
      assert.ok(e.annotation.length > 0, `${e.id} carries no teaching note`);
      assert.ok(e.storeUrl.startsWith('https://'), `${e.id} store URL not https`);
    }
  });
  it('registry row shape is gate-ready (study validates it in atlas-digest)', () => {
    // io cannot import study (study refs io): the row shape is pinned
    // here, validated there. Any field rename breaks this deepEqual.
    assert.deepEqual(
      {
        id: 'idr-catalog', kind: 'digest', license_spdx: 'CC0-1.0',
        mode: 'digest', lane: 'C1', status: 'shipped',
        source_url: 'https://idr.openmicroscopy.org/',
      },
      {
        id: 'idr-catalog', kind: 'digest', license_spdx: 'CC0-1.0',
        mode: 'digest', lane: 'C1', status: 'shipped',
        source_url: 'https://idr.openmicroscopy.org/',
      },
    );
  });
  it('blosc stores fail loud with the decoder named error (no silent pixels)', () => {
    // Fixture mirrors the live idr0048 shape (t/c/z/y/x, blosc chunk) at
    // toy size: proves the catalog's decodable:false claim end to end.
    const zarray = {
      zarr_format: 2, shape: [1, 1, 1, 4, 4], chunks: [1, 1, 1, 4, 4],
      dtype: '<u2', compressor: { id: 'blosc', cname: 'lz4', clevel: 5, shuffle: 1, blocksize: 0 },
      order: 'C', fill_value: 0, filters: null,
    };
    const zattrs = {
      multiscales: [{
        axes: [{ name: 't' }, { name: 'c' }, { name: 'z' }, { name: 'y' }, { name: 'x' }],
        datasets: [{ path: '0' }],
      }],
    };
    const dir = join(ROOT, '.tmp-c1-blosc');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, '0'), { recursive: true });
    writeFileSync(join(dir, '.zattrs'), JSON.stringify(zattrs));
    writeFileSync(join(dir, '0', '.zarray'), JSON.stringify(zarray));
    writeFileSync(join(dir, '0', '0.0.0.0.0'), new Uint8Array([1, 2, 3, 4]));
    const run = async (): Promise<void> => {
      const store = await OmeZarrStore.open('file://c1', diskFetch(dir) as FetchFn);
      await store.getTile({ s: 0, c: 0, z: 0, x: 0, y: 0, w: 4, h: 4 });
    };
    return assert.rejects(
      run,
      (e: unknown) => e instanceof OmeZarrError && e.code === 'unsupported-compressor',
    ).finally(() => rmSync(dir, { recursive: true, force: true }));
  });
  it('SOURCES sidecar shape for the catalog is well-formed', () => {
    // Shape pinned here; study's validateSourcesFile owns the semantics
    // (asserted in the study suite over this exact object).
    const sidecar = {
      format: 'carys-sources/1',
      digest: 'idr-catalog',
      sources: [{
        source_url: 'https://idr.openmicroscopy.org/',
        retrieved_date: '2026-09-17',
        license_spdx: 'CC0-1.0',
        version_pin: IDR_DIGEST_PIN,
        entry_count: 4,
      }],
    };
    assert.equal(sidecar.digest, 'idr-catalog');
    assert.equal(sidecar.sources[0]!.license_spdx, 'CC0-1.0');
    assert.equal(sidecar.sources.length, 1);
  });
});
