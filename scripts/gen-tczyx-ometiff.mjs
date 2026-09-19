// Generate the vendored 5D OME-TIFF sample (deterministic — rerunning
// yields byte-identical output): 2 timepoints x 2 channels x 3 z, 8x8
// uint8, explicit FirstT/FirstC/FirstZ TiffData so the (t,c,z) map is
// pinned, not positional. samples/tczyx.ome.tif
// Run: node scripts/gen-tczyx-ometiff.mjs
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeOmeTiff, parseOmeTiff } from '../packages/io/dist/ome-tiff.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 8, H = 8, T = 2, C = 2, Z = 3;

const planes = [];
const order = []; // (t, c, z) per plane index
for (let t = 0; t < T; t++) {
  for (let c = 0; c < C; c++) {
    for (let z = 0; z < Z; z++) {
      const values = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          // per-plane signature: t*100 + c*40 + z*8 + ramp (decodable identity)
          values.push((t * 100 + c * 40 + z * 8 + x + y * W) % 256);
        }
      }
      planes.push({ w: W, h: H, values, rowsPerStrip: 4 });
      order.push([t, c, z]);
    }
  }
}
const td = order.map(([t, c, z], i) => `<TiffData IFD="${i}" PlaneCount="1" FirstT="${t}" FirstC="${c}" FirstZ="${z}"/>`).join('');
const omexml = `<?xml version="1.0" encoding="UTF-8"?><OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06"><Image ID="Image:0"><Pixels DimensionOrder="XYZCT" ID="Pixels:0" SizeC="${C}" SizeT="${T}" SizeX="${W}" SizeY="${H}" SizeZ="${Z}" Type="uint8"><Channel ID="Channel:0:0" Name="ch0" SamplesPerPixel="1"/><Channel ID="Channel:0:1" Name="ch1" SamplesPerPixel="1"/>${td}</Pixels></Image></OME>`;
const buf = makeOmeTiff(planes, { omexml });
// Self-check: every plane decodes with the right (t, c, z) + pixels.
const back = parseOmeTiff(buf);
if (back.planes.length !== T * C * Z) throw new Error(`planes ${back.planes.length} != ${T * C * Z}`);
back.planes.forEach((p, i) => {
  const [t, c, z] = order[i];
  if (p.t !== t || p.c !== c || p.z !== z) throw new Error(`plane ${i} map (${p.t},${p.c},${p.z}) != (${t},${c},${z})`);
  for (let k = 0; k < W * H; k++) {
    if (p.data[k] !== planes[i].values[k]) throw new Error(`plane ${i} pixel ${k} mismatch`);
  }
});
writeFileSync(join(ROOT, 'samples', 'tczyx.ome.tif'), Buffer.from(buf));
console.log('tczyx.ome.tif written', buf.byteLength, 'bytes');
