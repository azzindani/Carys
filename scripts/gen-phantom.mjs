// Synthetic preview volumes, written with the repo's own NIfTI-1 writer.
//
// `samples/` holds real study data and is gitignored, so a fresh clone has
// nothing to show and nothing to drive the UI with. These phantoms give the
// viewer something anatomically shaped to render — a head with skull, brain,
// ventricles and a lesion, plus the matching segmentation — without any
// patient data ever entering the repo (README privacy note).
//
//   node scripts/gen-phantom.mjs        → samples/*.nii
//   node scripts/gen-ct-series.mjs      → samples/ct-head-series/*.dcm
//
// The anatomy lives in ./phantom.mjs so both generators emit the same head.
//
// Deterministic: a fixed LCG seed, fixed geometry, no timestamps. Rerunning
// yields byte-identical files: hand-rolled bytes, every value intentional
// (docs/TESTING.md, fixtures).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeNifti1 } from '../packages/io/dist/nifti-write.js';
import { head } from './phantom.mjs';
import { samplesDir } from './samples-dir.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = samplesDir(ROOT);
mkdirSync(OUT, { recursive: true });

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
