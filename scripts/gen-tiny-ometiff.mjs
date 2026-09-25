// Generate the vendored OME-TIFF sample (deterministic — rerunning yields
// byte-identical output): 8x8x4 uint8 ramp in 2 strips/plane + OME-XML.
//   samples/tiny.ome.tif
// Run: npm run gen:ometiff
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeOmeTiff, parseOmeTiff } from '../packages/io/dist/ome-tiff.js';
import { samplesDir } from './samples-dir.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 8, H = 8, Z = 4;

const planes = [];
for (let z = 0; z < Z; z++) {
  const values = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) values.push((x + y * W + z * 64) % 256);
  }
  planes.push({ w: W, h: H, values, rowsPerStrip: 4 });
}
const buf = makeOmeTiff(planes, { channels: ['tiny'] });
// Self-check before writing: every voxel must survive the round trip.
const back = parseOmeTiff(buf);
if (back.planes.length !== Z) throw new Error(`planes ${back.planes.length} != ${Z}`);
back.planes.forEach((p, z) => {
  for (let i = 0; i < W * H; i++) {
    if (p.data[i] !== planes[z].values[i]) throw new Error(`plane ${z} pixel ${i} mismatch`);
  }
});
writeFileSync(join(samplesDir(ROOT), 'tiny.ome.tif'), Buffer.from(buf));
console.log('tiny.ome.tif written', buf.byteLength, 'bytes');
