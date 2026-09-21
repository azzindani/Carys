// Synthetic preview volumes, written with the repo's own NIfTI-1 writer.
//
// `samples/` holds real study data and is gitignored, so a fresh clone has
// nothing to show and nothing to drive the UI with. These phantoms give the
// viewer something anatomically shaped to render — a head with skull, brain,
// ventricles and a lesion, plus the matching segmentation — without any
// patient data ever entering the repo (README privacy note).
//
//   node scripts/gen-phantom.mjs        → samples/*.nii
//
// Deterministic: a fixed LCG seed, fixed geometry, no timestamps. Rerunning
// yields byte-identical files. Rung 1 of the fixture ladder
// (docs/FIXTURE-FOUNDARY.md): hand-rolled bytes, every value intentional.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeNifti1 } from '../packages/io/dist/nifti-write.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'samples');
mkdirSync(OUT, { recursive: true });

/** Deterministic noise: a plain LCG, so reruns are byte-identical. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Squared normalised distance inside an axis-aligned ellipsoid. */
const ell = (x, y, z, cx, cy, cz, rx, ry, rz) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;

/**
 * A head-shaped phantom: skull shell, brain, paired ventricles and one
 * off-centre lesion.
 *
 * Intensities are real Hounsfield-ish values (air -1000, CSF ~10, white
 * ~30, grey ~42, lesion ~72, bone ~1100) so the stock window/level presets
 * land on actual contrast. An earlier pass used arbitrary values around 300
 * and every soft tissue clipped to white under a soft-tissue window.
 */
function head(nx, ny, nz, seed) {
  const img = new Float32Array(nx * ny * nz);
  const seg = new Uint8Array(nx * ny * nz);
  const rand = rng(seed);
  const cx = nx / 2, cy = ny / 2, cz = nz / 2;
  // Anterior-right so it is obvious which way the volume faces, and at the
  // depth the catalog's axialFrac opens on, so the mask overlay is on screen
  // the moment the study loads rather than a slider hunt away.
  const lx = cx + nx * 0.14, ly = cy - ny * 0.1, lz = nz * 0.72;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = z * nx * ny + y * nx + x;
        const skull = ell(x, y, z, cx, cy, cz, nx * 0.44, ny * 0.38, nz * 0.42);
        if (skull > 1) { img[i] = -1000; continue; }   // air outside the head
        const brain = ell(x, y, z, cx, cy, cz, nx * 0.39, ny * 0.33, nz * 0.37);
        let v;
        if (brain > 1) {
          v = 1050 + rand() * 150;                     // cortical bone
        } else {
          // grey/white contrast from a smooth field, plus scanner-ish noise
          const gw = Math.sin(x * 0.19) * Math.cos(y * 0.17) * Math.sin(z * 0.15);
          v = 36 + gw * 7 + (rand() - 0.5) * 3;        // white ~30, grey ~43
          const vent = Math.min(
            ell(x, y, z, cx - nx * 0.06, cy, cz, nx * 0.05, ny * 0.14, nz * 0.07),
            ell(x, y, z, cx + nx * 0.06, cy, cz, nx * 0.05, ny * 0.14, nz * 0.07),
          );
          if (vent <= 1) v = 8 + rand() * 6;           // CSF
        }
        if (ell(x, y, z, lx, ly, lz, nx * 0.09, ny * 0.08, nz * 0.08) <= 1) {
          v = 72 + rand() * 10;                        // enhancing lesion
          seg[i] = 1;
        }
        img[i] = v;
      }
    }
  }
  return { img, seg };
}

const write = (name, data, dims, spacing, dtype) => {
  const buf = writeNifti1({ dims, spacing, origin: [0, 0, 0], dtype, data });
  writeFileSync(join(OUT, name), Buffer.from(buf));
  const mb = (buf.byteLength / 1e6).toFixed(1);
  console.log(`  ${name.padEnd(52)} ${dims.join('x').padEnd(14)} ${mb} MB`);
};

console.log('synthetic preview volumes → samples/');

// The catalog's first entry is what the app opens on boot.
{
  const dims = [176, 176, 140];
  const { img, seg } = head(...dims, 12345);
  write('brain_tumor_BraTS19_CBICA_AQN_1_flair.nii', img, dims, [1, 1, 1.2], 'float32');
  write('brain_tumor_BraTS19_CBICA_AQN_1_seg.nii', seg, dims, [1, 1, 1.2], 'uint8');
}
// A second series so the file tabs, compare and hanging protocols have
// something to switch between.
{
  const dims = [160, 160, 120];
  const { img, seg } = head(...dims, 777);
  write('skull_case_0001_img.nii', img, dims, [1.1, 1.1, 1.4], 'float32');
  write('skull_case_0001_seg.nii', seg, dims, [1.1, 1.1, 1.4], 'uint8');
}

console.log('done — synthetic only, no patient data (README privacy note)');
