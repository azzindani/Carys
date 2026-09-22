import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OmeZarrStore, type FetchFn } from '../omezarr.js';

// V3 neuroglancer-precomputed translator (TOOLING): samples/precomputed_demo
// is generated from the vendored cells_demo bytes (npm run gen:precomputed,
// gitignored). These tests validate the generated tree against the
// precomputed spec (info shape + unsharded raw-chunk addressing) and prove
// byte-agreement with our own tiled lane: every chunk decodes to the same
// pixels our getTile serves. The translator output is regeneration, not
// fixture — delete the dir and rerun; these tests skip loud if absent.
const ROOT = process.cwd();
const DEMO = join(ROOT, 'samples', 'precomputed_demo');
const ZARR_DIR = join(ROOT, 'samples', 'cells_demo.zarr');

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

// A generated tree, not a vendored one: absent until `npm run gen:precomputed`.
// This used to return early with a console.log, which node:test scores as a
// PASS — the run looked green while three checks never executed.
const genDemo = existsSync(join(DEMO, 'info'))
  ? {}
  : { skip: 'needs samples/precomputed_demo (npm run gen:precomputed)' };

describe('precomputed translator output', () => {
  it('info validates: multiscale image, uint8, raw, one scale', genDemo, () => {
    const info = JSON.parse(readFileSync(join(DEMO, 'info'), 'utf8'));
    assert.equal(info['@type'], 'neuroglancer_multiscale_volume');
    assert.equal(info.data_type, 'uint8');
    assert.equal(info.num_channels, 2);
    assert.equal(info.type, 'image');
    assert.equal(info.scales.length, 1);
    const s = info.scales[0];
    assert.deepEqual(s.size, [128, 128, 1]);
    assert.deepEqual(s.chunk_sizes, [[64, 64, 64]]);
    assert.equal(s.encoding, 'raw');
  });
  it('chunk files byte-agree with our tiled lane (Fortran [x,y,z,ch])', genDemo, async () => {
    const store = await OmeZarrStore.open('file://cells_demo', diskFetch('file://cells_demo'));
    for (const [gx, gy] of [[0, 0], [64, 0], [0, 64], [64, 64]]) {
      const raw = readFileSync(join(DEMO, '64_64_64', `${gx}-${gx + 64}_${gy}-${gy + 64}_0-1`));
      assert.equal(raw.length, 64 * 64 * 1 * 2);
      // Fortran order: all of channel 0 first, then channel 1.
      for (const c of [0, 1]) {
        const tile = await store.getTile({ s: 0, c, z: 0, x: gx, y: gy, w: 64, h: 64 });
        for (let y = 0; y < 64; y++) {
          for (let x = 0; x < 64; x++) {
            const want = tile[y * 64 + x]!;
            const got = raw[(c * 64 * 64) + y * 64 + x]!;
            assert.equal(got, want, `ch${c} (${gx + x},${gy + y})`);
          }
        }
      }
    }
  });
  it('chunk addressing follows begin-end naming (unsharded spec)', genDemo, () => {
    // 128/64 = 2 per x/y, 1 z: grid names must be exactly these four.
    for (const name of ['0-64_0-64_0-1', '64-128_0-64_0-1', '0-64_64-128_0-1', '64-128_64-128_0-1']) {
      assert.ok(existsSync(join(DEMO, '64_64_64', name)), `missing chunk ${name}`);
    }
  });
});
