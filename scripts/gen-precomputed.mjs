// V3 neuroglancer-precomputed translator (TOOLING only — never shipped).
// Convert one pinned sample volume to a neuroglancer "precomputed" tree
// (info + raw unsharded chunks) so our tiled streaming lane's chunk math
// validates against the petascale reference design. Source: the OME-NGFF
// cells_demo bytes via our own OmeZarrStore (no new vendored input);
// output lands under samples/precomputed_demo/ (gitignored, regenerated).
//
// Reference: google/neuroglancer src/datasource/precomputed/volume.md
// (Apache-2.0, read 2026-09-18): info {data_type, num_channels, type,
// scales[{key, size[x,y,z], resolution, voxel_offset, chunk_sizes,
// encoding}]}; unsharded chunk files named "x0-x1_y0-y1_z0-z1" holding
// raw little-endian [x,y,z,channel] Fortran-order bytes. Sharded format,
// meshes, skeletons, jpeg/compresso/crackle encodings stay out (raw only);
// uint8 source only (cells_demo c0/c1); one scale (no downsampling pyramid
// — the comparison is chunk addressing, not multiresolution).
//
// Run: npm run gen:precomputed
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { samplesDir } from './samples-dir.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(samplesDir(ROOT), 'precomputed_demo');

const { OmeZarrStore } = await import('../packages/io/dist/omezarr.js');
const { readFileSync } = await import('node:fs');

const ZARR_DIR = join(samplesDir(ROOT), 'cells_demo.zarr');
const diskFetch = (base) => (async (url) => {
  if (!url.startsWith(`${base}/`)) return new Response('nope', { status: 404 });
  const rel = url.slice(base.length + 1);
  try {
    return new Response(Uint8Array.from(readFileSync(join(ZARR_DIR, rel))));
  } catch {
    return new Response('nope', { status: 404 });
  }
});

const store = await OmeZarrStore.open('file://cells_demo', diskFetch('file://cells_demo'));
const lv = store.levels[0];
const [nc, nz, ny, nx] = lv.meta.shape;
if (nc !== 2 || lv.meta.dtype !== 'uint8') throw new Error('cells_demo L0 drifted: want 2ch uint8');
const CHUNK = 64;

const w = (rel, data) => {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
};

// info: x,y,z voxel order (note: zarr shape is c,z,y,x — transposed here).
w('info', JSON.stringify({
  '@type': 'neuroglancer_multiscale_volume',
  data_type: 'uint8',
  num_channels: nc,
  type: 'image',
  scales: [{
    key: '64_64_64',
    size: [nx, ny, nz],
    resolution: [1000, 1000, 1000],
    voxel_offset: [0, 0, 0],
    chunk_sizes: [[CHUNK, CHUNK, CHUNK]],
    encoding: 'raw',
  }],
}, null, 2));

// chunks: for each [x,y,z] brick, gather Fortran-order [x,y,z,channel]
// bytes via getTile per channel (one 64x64 z-row tile per z), then write.
let n = 0;
for (let gz = 0; gz < nz; gz += CHUNK) {
  for (let gy = 0; gy < ny; gy += CHUNK) {
    for (let gx = 0; gx < nx; gx += CHUNK) {
      const ex = Math.min(gx + CHUNK, nx), ey = Math.min(gy + CHUNK, ny), ez = Math.min(gz + CHUNK, nz);
      const bw = ex - gx, bh = ey - gy, bd = ez - gz;
      const buf = Buffer.alloc(bw * bh * bd * nc);
      for (let c = 0; c < nc; c++) {
        for (let z = gz; z < ez; z++) {
          const tile = await store.getTile({ s: 0, c, z, x: gx, y: gy, w: bw, h: bh });
          // tile is C-order [y,x]; precomputed wants Fortran [x,y,z,channel]:
          // offset = ((c*bd + (z-gz))*bh + (y-gy))*bw + (x-gx)
          for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
              buf[((c * bd + (z - gz)) * bh + y) * bw + x] = tile[y * bw + x];
            }
          }
        }
      }
      w(`64_64_64/${gx}-${ex}_${gy}-${ey}_${gz}-${ez}`, buf);
      n++;
    }
  }
}
console.log(`precomputed_demo: info + ${n} raw chunks (${nx}x${ny}x${nz}x${nc})`);
