import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OmeZarrStore, type FetchFn } from '../omezarr.js';
import { brickBytes, streamBrick } from '../tiled-volume.js';

// 1 channel × 2 z × 8×8, chunked 4×4, raw uint8: value = z*64 + y*8 + x
function demoFetch(): FetchFn {
  const files = new Map<string, Uint8Array | object>();
  files.set('demo://brick/.zattrs', {
    multiscales: [{ axes: [{ name: 'c' }, { name: 'z' }, { name: 'y' }, { name: 'x' }], datasets: [{ path: '0' }] }],
  });
  files.set('demo://brick/0/.zarray', {
    zarr_format: 2, shape: [1, 2, 8, 8], chunks: [1, 1, 4, 4],
    dtype: '|u1', compressor: null, fill_value: 0, order: 'C', filters: null,
  });
  for (let z = 0; z < 2; z++) {
    for (let cy = 0; cy < 2; cy++) {
      for (let cx = 0; cx < 2; cx++) {
        const bytes = new Uint8Array(16);
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            bytes[y * 4 + x] = z * 64 + (cy * 4 + y) * 8 + (cx * 4 + x);
          }
        }
        files.set(`demo://brick/0/0.${z}.${cy}.${cx}`, bytes);
      }
    }
  }
  return (async (url: string) => {
    const f = files.get(url);
    if (f === undefined) {
      return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
    }
    const body = f instanceof Uint8Array ? f : new TextEncoder().encode(JSON.stringify(f));
    return {
      ok: true, status: 200,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      json: async () => JSON.parse(new TextDecoder().decode(body)),
    } as unknown as Response;
  }) as FetchFn;
}

describe('tiled streaming', () => {
  it('streams a brick band by band with progress + exact voxels', async () => {
    const store = await OmeZarrStore.open('demo://brick', demoFetch());
    const seen: string[] = [];
    const { dims, data } = await streamBrick(store, {
      c: 0, z0: 0, z1: 1, bandRows: 4,
      onProgress: (p) => seen.push(p.label),
    });
    assert.deepEqual(dims, [8, 8, 2]);
    assert.equal(data.length, 128);
    assert.equal(data[0], 0);
    assert.equal(data[8 * 8 - 1], 63); // z0 last pixel
    assert.equal(data[8 * 8], 64); // z1 first pixel
    assert.deepEqual(seen, ['z0 band 1/2', 'z0 band 2/2', 'z1 band 1/2', 'z1 band 2/2']);
    assert.equal(brickBytes(8, 8, 2), 1024);
  });
  it('abort lands between bands, bad ranges loud', async () => {
    const store = await OmeZarrStore.open('demo://brick', demoFetch());
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(
      streamBrick(store, { c: 0, z0: 0, z1: 1, signal: ctrl.signal }),
      /tiled-abort/,
    );
    await assert.rejects(streamBrick(store, { c: -1, z0: 0, z1: 0 }), /tiled-channel/);
    await assert.rejects(streamBrick(store, { c: 0, z0: 2, z1: 1 }), /tiled-zrange/);
    await assert.rejects(streamBrick(store, { c: 0, z0: 0, z1: 0, level: 9 }), /tiled-level/);
  });
});
