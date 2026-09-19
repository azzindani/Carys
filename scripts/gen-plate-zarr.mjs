// Generate the vendored NGFF plate sample (deterministic — rerunning yields
// byte-identical output). Two wells with distinct fingerprints so the well
// picker is provable in-browser:
//   samples/plate_demo.zarr/
//     .zgroup, .zattrs (plate v0.4: rows A/B, columns 01/02, wells A/01 B/02)
//     A/01/.zgroup, .zattrs (well -> images [0]), A/01/0/ (1ch x 1z x 32x32 raw)
//     B/02/... same layout, different pixels
// Run: npm run gen:plate
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'samples', 'plate_demo.zarr');
const N = 32;

const json = (o) => JSON.stringify(o, null, 2);
const w = (rel, data) => {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
};

// A/01: bright corner block; B/02: diagonal ramp (fingerprints differ).
function pixel(well, x, y) {
  if (well === 'A/01') return x < 16 && y < 16 ? 200 : 10;
  return (x + y * N) % 256;
}

w('.zgroup', json({ zarr_format: 2 }));
w('.zattrs', json({
  plate: {
    version: '0.4',
    name: 'plate_demo',
    rows: [{ name: 'A' }, { name: 'B' }],
    columns: [{ name: '01' }, { name: '02' }],
    wells: [
      { path: 'A/01', rowIndex: 0, columnIndex: 0 },
      { path: 'B/02', rowIndex: 1, columnIndex: 1 },
    ],
  },
}));

for (const well of ['A/01', 'B/02']) {
  w(`${well}/.zgroup`, json({ zarr_format: 2 }));
  w(`${well}/.zattrs`, json({ well: { images: [{ path: '0' }] } }));
  // Image group: multiscales datasets live one level down (NGFF layout:
  // well -> image '0' -> resolution '0'), so arrays sit at <well>/0/0/.
  w(`${well}/0/.zgroup`, json({ zarr_format: 2 }));
  w(`${well}/0/.zattrs`, json({
    multiscales: [{
      version: '0.4',
      name: well,
      axes: [
        { name: 'c', type: 'channel' },
        { name: 'z', type: 'space' },
        { name: 'y', type: 'space' },
        { name: 'x', type: 'space' },
      ],
      datasets: [{ path: '0' }],
    }],
  }));
  w(`${well}/0/0/.zarray`, json({
    zarr_format: 2, shape: [1, 1, N, N], chunks: [1, 1, N, N],
    dtype: '|u1', compressor: null, fill_value: 0, order: 'C', filters: null,
  }));
  const bytes = Buffer.alloc(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) bytes[y * N + x] = pixel(well, x, y);
  }
  w(`${well}/0/0/0.0.0.0`, bytes);
}
console.log('plate_demo.zarr written');
