import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needs } from '@carys/testkit';
import { renderGolden, type GoldenSpec } from './goldens.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // dist/test
const PNG_DIR = join(HERE, 'goldens');
const ROOT = process.cwd();
const FROZEN = join(ROOT, 'packages/render-cpu/src/test/goldens.json');

const SPECS: GoldenSpec[] = [
  {
    // tumor sits at z~100-130 (verified by sweep); mid-slice is clean
    name: 'brats-flair-seg',
    img: join(ROOT, 'samples/brain_tumor_BraTS19_CBICA_AQN_1_flair.nii'),
    seg: join(ROOT, 'samples/brain_tumor_BraTS19_CBICA_AQN_1_seg.nii'),
    sliceFrac: 0.72,
  },
  {
    // SWAPPED naming (verified by sweep): liver_33_img.nii holds labels
    // {0,1,2}; liver_33_seg.nii holds the HU CT image. Render CT + mask.
    name: 'liver-ct-seg',
    img: join(ROOT, 'samples/liver_33_seg.nii'),
    seg: join(ROOT, 'samples/liver_33_img.nii'),
  },
  {
    // lung_ct DICOM has no pixel decoder yet; covid chest CT stands in
    name: 'covid-chest-seg',
    img: join(ROOT, 'samples/volume-covid19-A-0329.nii'),
    seg: join(ROOT, 'samples/volume-covid19-A-0329_seg.nii'),
  },
  {
    name: 'cardiac-frame01',
    img: join(ROOT, 'samples/cardiac_patient021_frame01.nii'),
  },
  {
    // first real-DICOM golden: thin lung_ct series via dicom-parse + stack
    name: 'lung-ct-dicom',
    dicomSeries: [1, 2, 3, 4, 5].map((i) => join(ROOT, `samples/lung_ct_0${i}.dcm`)),
  },
];

describe('validation goldens', () => {
  it('renders 5 mid-axial goldens (4 NIfTI + 1 DICOM); hashes match frozen', needs(
    'brain_tumor_BraTS19_CBICA_AQN_1_flair.nii', 'brain_tumor_BraTS19_CBICA_AQN_1_seg.nii',
    'liver_33_seg.nii', 'liver_33_img.nii',
    'volume-covid19-A-0329.nii', 'volume-covid19-A-0329_seg.nii',
    'cardiac_patient021_frame01.nii',
    'lung_ct_01.dcm', 'lung_ct_02.dcm', 'lung_ct_03.dcm', 'lung_ct_04.dcm', 'lung_ct_05.dcm',
  ), () => {
    mkdirSync(PNG_DIR, { recursive: true });
    const got: Record<string, string> = {};
    for (const s of SPECS) {
      const r = renderGolden(s);
      writeFileSync(join(PNG_DIR, `${s.name}.png`), r.png);
      got[s.name] = r.sha256;
    }
    if (process.env.FREEZE === '1') {
      writeFileSync(FROZEN, JSON.stringify(got, null, 2) + '\n');
      console.log('froze goldens.json — PNGs eyeballed in dist/test/goldens/');
      return;
    }
    if (!existsSync(FROZEN)) {
      assert.fail(`no frozen goldens yet. PNGs written to ${PNG_DIR}; eyeball them, then re-run with FREEZE=1`);
    }
    const frozen = JSON.parse(readFileSync(FROZEN, 'utf8')) as Record<string, string>;
    assert.deepEqual(got, frozen);
  });
});
