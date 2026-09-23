// Geometry journeys: the image is where the patient is, at its true
// proportions, and what leaves the viewer lands back on the source grid.
// Everything here runs on the vendored real samples and reads persistent
// signals — canvas pixels, toasts, the overlay, a downloaded file's header.
//   A. radiological orientation: the liver (patient right) is on screen left
//   B. true aspect: a 5 mm-slice CT's coronal is 480×290 mm, not 512×58 px
//   C. a multi-file DICOM drop opens as the series it contains
//   D. an exported mask carries the source affine and matches the source seg
//   E. a NIfTI upload (parse worker) decodes to the same data as the catalog
//   F. the volume render is in mm too: that CT's side view spans ~290 mm
// Fails loud, prints PASS. Run: npm run test:geometry (chained into test:e2e)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeNiftiBuffer, readHeader, readImage } from '../../packages/io/dist/index.js';
import { launchChromium } from './browser.mjs';

const PORT = Number(process.env.E2E_PORT || 8134);
const BASE = `http://localhost:${PORT}/packages/app/dist/index.html`;
const SAMPLES = join(process.cwd(), 'samples');
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

let failed = 0;
const fail = (msg) => {
  failed = 1;
  console.error(`GEOMETRY FAIL: ${msg}`);
};

/** Open a catalog series by name through the palette; wait until it paints. */
async function openSeries(page, name) {
  await page.click('#openpal');
  await page.fill('#palinput', name);
  await page.waitForSelector('#pallist li', { timeout: 10000 });
  await page.click('#pallist li');
  await page.waitForFunction(
    (n) => {
      const st = document.getElementById('status-text')?.textContent ?? '';
      return st.includes(n) && !/fetching|loading/.test(st);
    }, name, { timeout: 120000 },
  );
  await page.waitForTimeout(400);
}

const ARRAYS = {
  uint8: Uint8Array, int8: Int8Array, uint16: Uint16Array, int16: Int16Array,
  uint32: Uint32Array, int32: Int32Array, float32: Float32Array, float64: Float64Array,
};
const readNifti = (bytes) => {
  const buf = decodeNiftiBuffer(new Uint8Array(bytes));
  const h = readHeader(buf);
  const frame = readImage(h, buf);
  return { h, frame, voxels: new ARRAYS[h.dtype](frame) };
};

try {
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );

  // ---- A. liver-ct-seg is stored RAS; shown radiologically the liver
  // (mask tint) sits in the left half of the axial pane.
  await openSeries(page, 'liver-ct-seg');
  const halves = await page.evaluate(() => {
    const cv = document.getElementById('c-axial');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let left = 0, right = 0;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const o = (y * cv.width + x) * 4;
        if (d[o] > 200 && d[o + 1] < 110 && d[o + 2] < 110) { if (x < cv.width / 2) left++; else right++; }
      }
    }
    return { left, right };
  });
  if (!(halves.left > 3 * Math.max(1, halves.right))) fail(`liver not on screen left: ${JSON.stringify(halves)}`);
  else console.log(`orientation: liver on screen left (${halves.left} vs ${halves.right} tinted px)`);

  // ---- B. covid chest: 512×512×58 at 0.938×0.938×5 mm. The coronal image
  // is 480 mm wide and 290 mm tall on screen (ratio 1.66), not 512:58.
  await openSeries(page, 'covid-chest-seg');
  const ratio = await page.evaluate(() => {
    // Image extent, measured through the image only: a row and a column a
    // third of the way in, clear of the mid-edge letters, the centred scale
    // bar and the corner readouts (all chrome, not anatomy).
    const cv = document.getElementById('c-coronal');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const opaque = (x, y) => d[(y * cv.width + x) * 4 + 3] === 255;
    const run = (n, at) => {
      let a = -1, b = -1;
      for (let i = 0; i < n; i++) if (at(i)) { if (a < 0) a = i; b = i; }
      return b - a + 1;
    };
    const w = run(cv.width, (x) => opaque(x, Math.round(cv.height * 0.4)));
    const h = run(cv.height, (y) => opaque(Math.round(cv.width * 0.35), y));
    return w / h;
  });
  const want = (512 * 0.938) / (58 * 5);
  if (!(Math.abs(ratio - want) / want < 0.06)) fail(`coronal aspect ${ratio.toFixed(2)}, want ≈${want.toFixed(2)}`);
  else console.log(`aspect: coronal ${ratio.toFixed(2)} ≈ physical ${want.toFixed(2)}`);

  // ---- F. the same CT volume-rendered from the side (orbit 90°: head–foot
  // runs across the screen). The frame fits the 480 mm width, so the 58 × 5
  // mm scan must span ~290 mm of it; marched in voxels it spanned 58.
  await page.click('#renderseg button[data-r="volume"]');
  await page.click('#srcseg button[data-s="image"]');
  await page.locator('input[aria-label="Orbit"]').fill('1.57');
  await page.locator('input[aria-label="Tilt"]').fill('0');
  await page.waitForFunction(
    () => /^VR \d+×\d+/.test(document.getElementById('ro-3d')?.textContent ?? ''),
    null, { timeout: 120000 },
  );
  await page.waitForTimeout(1500); // a draft may be superseded by the settled orbit
  const vrMm = await page.evaluate(() => {
    const cv = document.getElementById('view3d');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const y = Math.round(cv.height / 2);
    let a = -1, b = -1;
    for (let x = 0; x < cv.width; x++) {
      const o = (y * cv.width + x) * 4;
      if (Math.abs(d[o] - 17) + Math.abs(d[o + 1] - 17) + Math.abs(d[o + 2] - 17) > 12) { if (a < 0) a = x; b = x; }
    }
    const zoom = parseFloat(document.getElementById('zoom3d')?.textContent ?? '100') / 100;
    // the raycaster's frame: min(w, h) × 0.92 spans the longest extent
    const pxPerMm = (Math.min(cv.width, cv.height) * 0.92 * zoom) / (512 * 0.938);
    return (b - a + 1) / pxPerMm;
  });
  if (!(Math.abs(vrMm - 290) / 290 < 0.06)) fail(`volume render spans ${vrMm.toFixed(0)} mm head–foot, want ≈290`);
  else console.log(`3D: volume render spans ${vrMm.toFixed(0)} mm head–foot ≈ 58 × 5 mm`);
  await page.click('#renderseg button[data-r="surface"]');

  // ---- C. five lung_ct files are five exams; four cardiac files are one
  // sparse series whose gaps are called out on the image.
  const lung = [1, 2, 3, 4, 5].map((i) => join(SAMPLES, `lung_ct_0${i}.dcm`));
  await page.setInputFiles('input#upload', lung);
  await page.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => /5 files → 5 series/.test(t.textContent ?? '')),
    null, { timeout: 60000 },
  );
  const lungSeries = await page.evaluate(() =>
    [...document.querySelectorAll('select[aria-label="Series"] option')].filter((o) => o.value.startsWith('uploaded: 5 files ·')).length);
  if (lungSeries !== 5) fail(`lung upload registered ${lungSeries} series, want 5`);
  else console.log('dicom set: 5 lung files open as 5 series');
  const cardiac = [1, 2, 4, 5].map((i) => join(SAMPLES, `cardiac_0${i}.dcm`));
  await page.setInputFiles('input#upload', cardiac);
  await page.waitForFunction(
    () => [...document.querySelectorAll('.vp-ov-caution')].some((c) => /not contiguous/.test(c.textContent ?? '')),
    null, { timeout: 60000 },
  );
  console.log('dicom set: sparse cardiac pick warns on the image');

  // ---- D. mask export lands on the source grid with the source affine,
  // and is exactly the source segmentation (the mask is its editing copy).
  await openSeries(page, 'liver-ct-seg');
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#dock-tune button[title="Export mask as .nii"]'),
  ]);
  const out = readNifti(readFileSync(await dl.path()));
  const img = readNifti(readFileSync(join(SAMPLES, 'liver_33_seg.nii'))); // the CT (names swapped upstream)
  const seg = readNifti(readFileSync(join(SAMPLES, 'liver_33_img.nii'))); // the labels
  if (out.h.dims.join() !== img.h.dims.join()) fail(`export dims ${out.h.dims} vs source ${img.h.dims}`);
  if (!(out.h.sform_code > 0)) fail('export has no sform');
  const affErr = Math.max(...out.h.affine.flatMap((row, r) => row.map((v, c) => Math.abs(v - img.h.affine[r][c]))));
  if (!(affErr < 1e-3)) fail(`export affine differs from source by ${affErr}`);
  const mask = out.voxels;
  const labels = seg.voxels;
  let diff = 0, fg = 0;
  for (let i = 0; i < mask.length; i++) {
    const want1 = labels[i] > 0 ? 1 : 0;
    if (mask[i] !== want1) diff++;
    if (want1) fg++;
  }
  if (diff !== 0) fail(`exported mask differs from source seg in ${diff} voxels`);
  else console.log(`export: mask .nii on the source grid, affine within ${affErr.toExponential(1)}, ${fg.toLocaleString()} voxels match the source seg`);

  // ---- E. the upload path (parse worker) decodes a real int16 NIfTI to
  // the same data the catalog path does: same auto window on both.
  const wlOf = () => page.evaluate(() => document.querySelector('#pane-axial .vp-ov-br span')?.textContent ?? '');
  await openSeries(page, 'brats-flair-seg');
  const wlCatalog = await wlOf();
  await page.setInputFiles('input#upload', join(SAMPLES, 'brain_tumor_BraTS19_CBICA_AQN_1_flair.nii'));
  await page.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent?.includes('Loaded brain_tumor_BraTS19_CBICA_AQN_1_flair.nii')),
    null, { timeout: 60000 },
  );
  await page.waitForTimeout(500);
  const wlUpload = await wlOf();
  if (!/^W \d+ · C \d+$/.test(wlUpload) || wlUpload !== wlCatalog) fail(`upload window "${wlUpload}" vs catalog "${wlCatalog}"`);
  else console.log(`upload: worker decode matches catalog (${wlUpload})`);

  await browser.close();
} catch (e) {
  fail(`exception: ${(e.stack || String(e)).slice(0, 800)}`);
} finally {
  server.kill();
}
if (!failed) console.log('GEOMETRY PASS');
process.exit(failed ? 1 : 0);
