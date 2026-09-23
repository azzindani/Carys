// Wiring proof: engine features unreachable from the UI now are — NRRD
// open, MZ3 mesh import, rotating MIP, MolQL search, genome tracks, TCK
// tracts + fiber render, GIFTI import, plate wells, OME-TIFF volumes,
// DICOMDIR series open, ellipse ROI stats, cine transport, invert,
// TRK/TRX tracts, DICOM tags, rect ROI, Cobb angle, colormaps,
// GSPS presentation save/load.
// Fails loud, prints PASS. Run: npm run test:wire (chained into test:e2e)
// NOTE: waitForSelector takes (selector, options) — TWO args. Passing a
// null second arg (as waitForFunction does) throws an instant,
// misleading TypeError inside Playwright. Do not "fix" these to 3 args.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';

const PORT = Number(process.env.E2E_PORT || 8130);
const BASE = `http://localhost:${PORT}/packages/app/dist/index.html`;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

let failed = 0;
/**
 * The details drawer now starts closed — it overlays the image rather than
 * holding a column, so chrome costs the viewport nothing. Legs that read the
 * readouts inside it (#maskinfo, #dcm-meta, #volinfo, #measureinfo, …) open
 * it first. No-op on routes that have no drawer.
 */
// Waits for the route to mount, then decides. It used to give #instoggle
// 1.5 s and read a slow mount as "this route has no drawer" — on a loaded
// machine the drawer then never opened and a later assertion timed out.
const openDetails = async (pg) => {
  await pg.waitForFunction(
    () => document.querySelector('#root .main') && !document.querySelector('.route-stub'),
    null, { timeout: 60000 },
  );
  const t = await pg.$('#instoggle');
  if (!t) return; // route has no details drawer (report, cells, tracks, …)
  if ((await t.getAttribute('aria-pressed')) !== 'true') await t.click();
  await pg.waitForSelector('#instoggle[aria-pressed="true"]', { timeout: 10000 });
};

const fail = (msg) => {
  failed = 1;
  console.error(`WIRE FAIL: ${msg}`);
};

// ---- fixtures (hand-rolled bytes, no samples needed)
const dir = mkdtempSync(join(tmpdir(), 'wire-'));
const nrrdHead = 'NRRD0004\ntype: uchar\ndimension: 3\nsizes: 8 8 4\nendian: little\nencoding: raw\n\n';
const nrrdBytes = Buffer.concat([Buffer.from(nrrdHead), Buffer.from(Array.from({ length: 256 }, (_, i) => i % 256))]);
const nrrdPath = join(dir, 'wire.nrrd');
writeFileSync(nrrdPath, nrrdBytes);

const mz3 = Buffer.alloc(16 + 2 * 12 + 4 * 12);
mz3.writeUInt16LE(23117, 0);
mz3.writeUInt16LE(3, 2);
mz3.writeUInt32LE(2, 4);
mz3.writeUInt32LE(4, 8);
mz3.writeUInt32LE(0, 12);
[0, 1, 2, 0, 1, 3].forEach((v, i) => mz3.writeUInt32LE(v, 16 + i * 4));
[0, 0, 0, 4, 0, 0, 0, 3, 0, 0, 0, 2].forEach((v, i) => mz3.writeFloatLE(v, 40 + i * 4));
const mz3Path = join(dir, 'wire.mz3');
writeFileSync(mz3Path, mz3);

const bed = [
  'chr1\t100\t200\tgeneA\t0\t+',
  'chr1\t300\t400\tgeneB\t0\t+',
  'chr1\t500\t600\tgeneC\t0\t-',
  'chr2\t100\t200\tgeneD\t0\t+',
  'chr2\t300\t400\tgeneE\t0\t-',
].join('\n');
const bedPath = join(dir, 'wire.bed');
writeFileSync(bedPath, bed);

// TCK: header (padded to offset 64) + an 8-point streamline near the
// cardiac-frame01 center (120,128,5) + Inf end. Center-placed so the default
// orbit still projects it onto the canvas.
const tckHead = 'mrtrix tracks\ndatatype: Float32LE\nfile: ' + '.'.repeat(16) + ' 64\nEND\n';
const tckHeadBytes = Buffer.from(tckHead);
if (tckHeadBytes.length !== 64) throw new Error(`tck header ${tckHeadBytes.length} != 64`);
const tckPts = [];
for (let i = 0; i < 8; i++) tckPts.push(112 + i * 2, 120 + i * 2, 5);
const tck = Buffer.alloc(64 + tckPts.length * 4 + 12);
tckHeadBytes.copy(tck, 0);
tckPts.forEach((v, i) => tck.writeFloatLE(v, 64 + i * 4));
// Terminator is a full triplet (parseTck reads x,y,z): +Inf ends the file.
tck.writeFloatLE(Infinity, 64 + tckPts.length * 4);
const tckPath = join(dir, 'wire.tck');
writeFileSync(tckPath, tck);

// TRK: 1000B header (TRAC magic, version 2, no matrix/scalars/props) +
// one 8-point streamline at the same center as the TCK leg.
const trk = Buffer.alloc(1000 + 4 + 8 * 12);
trk.writeUInt32LE(1128354388, 0); // 'TRAC' LE
trk.writeInt16LE(0, 36); // nScalars
trk.writeInt16LE(0, 238); // nProps
trk.writeUInt32LE(2, 992); // version
trk.writeUInt32LE(1000, 996); // header size
trk.writeInt32LE(8, 1000); // one streamline, 8 points
for (let i = 0; i < 8; i++) {
  trk.writeFloatLE(112 + i * 2, 1004 + i * 12);
  trk.writeFloatLE(120 + i * 2, 1008 + i * 12);
  trk.writeFloatLE(5, 1012 + i * 12);
}
const trkPath = join(dir, 'wire.trk');
writeFileSync(trkPath, trk);

// TRX: zip with float32 positions + uint64 offsets (same 8 points).
const trxPts = new Float32Array(8 * 3);
for (let i = 0; i < 8; i++) { trxPts[i * 3] = 112 + i * 2; trxPts[i * 3 + 1] = 120 + i * 2; trxPts[i * 3 + 2] = 5; }
const trxOff = Buffer.alloc(16);
trxOff.writeBigUInt64LE(0n, 0);
trxOff.writeBigUInt64LE(8n, 8);
const trxPath = join(dir, 'wire.trx');
writeFileSync(trxPath, Buffer.from(zipSync({
  'positions.3.float32': new Uint8Array(trxPts.buffer),
  'offsets.uint64': new Uint8Array(trxOff.buffer, trxOff.byteOffset, trxOff.byteLength),
  'header.json': new TextEncoder().encode('{"DIMENSIONS":[256,256,10]}'),
})));

// GIFTI ASCII: tetrahedron corners, two triangles.
const gii = `<?xml version="1.0" encoding="UTF-8"?>
<GIFTI Version="1.0" NumberOfDataArrays="2">
<DataArray Intent="NIFTI_INTENT_POINTSET" DataType="NIFTI_TYPE_FLOAT32" ArrayIndexingOrder="RowMajorOrder" Dimensionality="2" Dim0="4" Dim1="3" Encoding="ASCII" Endian="LittleEndian">
<Data>0 0 0 4 0 0 0 3 0 0 0 2</Data>
</DataArray>
<DataArray Intent="NIFTI_INTENT_TRIANGLE" DataType="NIFTI_TYPE_INT32" ArrayIndexingOrder="RowMajorOrder" Dimensionality="2" Dim0="2" Dim1="3" Encoding="ASCII" Endian="LittleEndian">
<Data>0 1 2 0 1 3</Data>
</DataArray>
</GIFTI>`;
const giiPath = join(dir, 'wire.gii');
writeFileSync(giiPath, gii);

// Detached .nhdr + .raw pair (8x8x4, same bytes as wire.nrrd).
const nhdrPath = join(dir, 'wire.nhdr');
writeFileSync(nhdrPath, 'NRRD0004\ntype: uchar\ndimension: 3\nsizes: 8 8 4\nendian: little\nencoding: raw\ndata file: wire.raw\n');
const rawPath = join(dir, 'wire.raw');
writeFileSync(rawPath, Buffer.from(Array.from({ length: 256 }, (_, i) => i % 256)));

try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  const status = () => page.locator('#status-text').textContent().catch(() => null);
  // ---- 1. NRRD upload renders as a volume (8x8x4 -> axial max index 3)
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page);
  await page.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page.setInputFiles('input#upload', nrrdPath);
  await page.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page.setInputFiles('input#upload', nrrdPath);
  await page.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent?.includes('Loaded wire.nrrd')),
    null, { timeout: 30000 },
  );
  await page.waitForFunction(
    () => document.getElementById('ro-axial')?.textContent === '2 / 3',
    null, { timeout: 30000 },
  );
  console.log('nrrd upload renders 8x8x4 volume (sliders reset to it)');

  // ---- 1c. A4 plane atlas: the teaching card names the axial third from
  // the live slider; switching to Cor retitles, and the badge stays on.
  await page.waitForSelector('#dock-plane', { timeout: 90000 });
  await page.waitForFunction(
    () => /Axial/.test(document.getElementById('ro-plane')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('plane card teaches:', await page.locator('#ro-plane').textContent());
  await page.click('#dock-plane #planeseg button[data-planecard="coronal"]');
  await page.waitForFunction(
    () => /Coronal/.test(document.getElementById('ro-plane')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('plane card switches:', await page.locator('#ro-plane').textContent());

  // ---- 1b. Detached .nhdr + .raw pair resolves by data-file name.
  await page.setInputFiles('input#upload', [nhdrPath, rawPath]);
  await page.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent?.includes('Loaded pair wire.nhdr + wire.raw')),
    null, { timeout: 30000 },
  );
  await page.waitForFunction(
    () => document.getElementById('ro-axial')?.textContent === '2 / 3',
    null, { timeout: 30000 },
  );
  console.log('detached nhdr pair renders 8x8x4 volume');

  // ---- 2. MZ3 mesh import pins into the open series viewBox.
  // NOTE: assert on the toast, NOT #status-text — importMeshFile ends with
  // bump(), whose repaint overwrites status within a frame. A 200ms poll
  // loop misses the transient every time (learned the hard way).
  const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page2.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page2.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page2);
  await page2.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page2.setInputFiles('input#upload', mz3Path);
  await page2.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent?.includes('Mesh imported')),
    null, { timeout: 60000 },
  );
  console.log('mz3 import toast:', await page2.locator('#toasts .toast').first().textContent());
  await page2.close();

  // Fresh page for the TCK/GIFTI legs (used below at legs 6-7).
  const page3 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page3.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page3.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page3);
  await page3.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );

  // ---- 3. rotating MIP: proj=mip + oblique angles tags the axial pane.
  // Real key events (a user nudging the slider): synthetic input/change
  // dispatches don't reach this React build's range handlers either.
  await page.click('#projseg button[data-proj="mip"]');
  await page.locator('input[aria-label="Obl A"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(
    () => document.getElementById('ro-axial')?.textContent?.includes('obl'),
    null, { timeout: 60000 },
  );
  console.log('rotating mip tags axial:', await page.locator('#ro-axial').textContent());
  // Oblique Min/Mean take the same rotating path (used to silently reslice).
  await page.click('#projseg button[data-proj="mean"]');
  await page.waitForFunction(
    () => document.getElementById('ro-axial')?.textContent?.includes('MEAN obl'),
    null, { timeout: 60000 },
  );
  console.log('rotating mean tags axial:', await page.locator('#ro-axial').textContent());

  // ---- 4. MolQL search selects residues, bad queries report loudly
  await page.goto(`${BASE}#/protein`, { waitUntil: 'networkidle' });
  await openDetails(page);
  await page.waitForSelector('#seqstrip button[data-res]', { timeout: 90000 });
  await page.fill('#molq', 'resi 1:10');
  await page.click('#dock-protein button[title="Select matching residues"]');
  await page.waitForFunction(
    () => document.getElementById('ro-sel')?.textContent?.includes('10 selected'),
    null, { timeout: 30000 },
  );
  console.log('molql resi 1:10 selects 10');
  await page.fill('#molq', 'frobnicate');
  await page.click('#dock-protein button[title="Select matching residues"]');
  await page.waitForFunction(
    () => document.getElementById('status-text')?.textContent?.includes('bad query'),
    null, { timeout: 30000 },
  );
  console.log('molql garbage reports bad query');

  // ---- 5. genome tracks: upload BED, locus filter narrows rows
  await page.goto(`${BASE}#/tracks`, { waitUntil: 'networkidle' });
  await openDetails(page);
  await page.waitForSelector('#title-tracks', { timeout: 90000 });
  const types = await page.locator('#ro-tracktypes').textContent();
  if (!types || !types.includes('bed')) fail(`track classes missing bed: ${types}`);
  await page.setInputFiles('#track-upload', bedPath);
  await page.waitForFunction(
    () => document.getElementById('ro-tracks')?.textContent?.includes('5 features'),
    null, { timeout: 30000 },
  );
  await page.fill('#locus', 'chr1:1-1000');
  await page.click('#dock-tracks button[title="Filter features to this locus"]');
  await page.waitForFunction(
    () => document.getElementById('ro-tracks')?.textContent?.includes('3 in locus'),
    null, { timeout: 30000 },
  );
  const rows = await page.locator('#track-list .mrow').count();
  if (rows !== 3) fail(`tracks rows expected 3, got ${rows}`);
  console.log('tracks bed locus filter narrows to 3 rows');

  // ---- 6. TCK tracts import + fiber render on the 3D canvas (page3,
  // fibers only: switch to a seg-less series first so no anatomy mesh is
  // displayed — the import then proves the lines alone).
  await page3.selectOption('.top select.dark', 'cardiac-frame01');
  await page3.waitForFunction(
    () => document.querySelector('#filetabs [data-tab="cardiac-frame01"][data-active="true"]'),
    null, { timeout: 60000 },
  );
  // Cardiac must finish loading first (axial 10 slices): uploads mid-load
  // find no volume yet and bail with 'open a series first'.
  await page3.waitForFunction(
    () => /\/ 9(\s|·|$)/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page3.setInputFiles('input#upload', tckPath);
  await page3.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent?.includes('Tracts imported: 1 streamline')),
    null, { timeout: 60000 },
  );
  console.log('tck import toasts 1 streamline');
  // Combined viewer: the 3D viewport is already live on #/ (no view switch).
  await page3.waitForFunction(
    () => document.getElementById('ro-3d')?.textContent?.includes('tract'),
    null, { timeout: 90000 },
  );
  const hist = await page3.evaluate(() => {
    const cv = document.getElementById('view3d');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let bg = 0, transparent = 0, other = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) transparent++;
      else if (d[i] === 17 && d[i + 1] === 19 && d[i + 2] === 20) bg++;
      else other++;
    }
    return { bg, transparent, other, ro: document.getElementById('ro-3d')?.textContent };
  });
  console.log('fiber canvas hist:', JSON.stringify(hist));
  if (hist.ro.includes('tris')) fail(`mesh leaked into fibers-only page: ${hist.ro}`);
  else if (hist.transparent > 0) fail(`canvas has ${hist.transparent} transparent pixels (not painted)`);
  else if (hist.other < 10 || hist.other > 100000) fail(`fiber pixel count implausible: ${JSON.stringify(hist)}`);
  else console.log(`fiber canvas renders ${hist.other} non-bg pixels over background`);
  // N2 tract preset: the picker filters the 1-streamline import. The TCK
  // leg's streamline sits near the cardiac-frame01 center, so midline
  // selection is data-dependent — assert the contract instead: the chip
  // names kept + preset id, and clearing restores the full import.
  await page3.locator('#dock-3d select[aria-label="Tract preset"]').selectOption('two-hop');
  await page3.waitForFunction(
    () => (document.getElementById('ro-preset')?.textContent ?? '').includes('two-hop'),
    null, { timeout: 30000 },
  );
  console.log('preset chip:', await page3.locator('#ro-preset').textContent());
  await page3.locator('#dock-3d select[aria-label="Tract preset"]').selectOption('');
  await page3.waitForFunction(
    () => (document.getElementById('ro-preset')?.textContent ?? '').includes('no filter'),
    null, { timeout: 30000 },
  );
  console.log('preset clear restores:', await page3.locator('#ro-preset').textContent());

  // ---- 7. GIFTI import through the same mesh path.
  await page3.setInputFiles('input#upload', giiPath);
  await page3.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent?.includes('Mesh imported: 2 triangles')),
    null, { timeout: 60000 },
  );
  console.log('gii import toasts 2 triangles');
  await page3.close();
  await page3.close();

  // ---- 8. plate wells: open the plate root, switch wells by picker.
  await page.goto(`${BASE}#/cells`, { waitUntil: 'networkidle' });
  await openDetails(page);
  await page.waitForSelector('#chaninfo .mrow', { timeout: 90000 });
  await page.fill('#zurl', '/samples/plate_demo.zarr');
  await page.click('#dock-cells button[title^="Open a remote"]');
  await page.waitForFunction(
    () => document.getElementById('ro-plate')?.textContent?.includes('2 wells'),
    null, { timeout: 60000 },
  );
  console.log('plate opens with well picker:', await page.locator('#ro-plate').textContent());
  await page.click('#wellseg button[data-well="B/02"]');
  await page.waitForFunction(
    () => document.getElementById('ro-plate')?.textContent?.includes('B02'),
    null, { timeout: 60000 },
  );
  // Wait for the stats themselves, not the well name: rows land a beat
  // after ro-plate (async tile fetch), and the name alone proves nothing.
  await page.waitForFunction(
    () => [...document.querySelectorAll('#chaninfo .mrow dd')].some((d) => d.textContent?.includes('127.5')),
    null, { timeout: 60000 },
  );
  console.log('well B/02 renders mean 127.5');

  // ---- 8b. Pyramid viewport: sample store paints auto L1 with bands.
  // The vendored store is L0 128px, L1 64px: the 1440px page paints L0
  // (covers the stage), the narrow phone viewport covers at L1. Auto pick
  // + progressive bands ride the persistent status + ro-level chips.
  await page.fill('#zurl', '/samples/cells_demo.zarr');
  await page.click('#dock-cells button[title^="Open a remote"]');
  await page.waitForFunction(
    () => document.getElementById('storeinfo')?.textContent?.includes('128'),
    null, { timeout: 60000 },
  );
  await page.waitForFunction(
    () => /band \d+\/\d+/.test(document.getElementById('status-text')?.textContent ?? ''),
    null, { timeout: 60000 },
  );
  console.log('pyramid auto paints bands:', await page.locator('#ro-level').textContent());
  const lvlText = await page.locator('#ro-level').textContent();
  if (!/auto L\d/.test(lvlText ?? '')) fail(`auto level chip missing: ${lvlText}`);
  else console.log(`pyramid pick resolves ${lvlText}`);
  // Manual pick leaves auto: L1 sticks on the chip + narrow canvas.
  await page.locator('#dock-cells select[aria-label="Pyramid level"]').selectOption('1');
  await page.waitForFunction(
    () => !(document.getElementById('ro-level')?.textContent ?? '').includes('auto'),
    null, { timeout: 30000 },
  );
  console.log('manual level leaves auto:', await page.locator('#ro-level').textContent());
  // ---- 8b2. F3 low-bandwidth: the Low-BW switch pins the smallest level
  // (L1 on the 2-level sample store); toggling back resumes auto.
  // Switch inputs sit opacity-0 under their track (real users click the
  // label), so toggles go through the label like the Invert leg does.
  // The manual L1 pick already satisfies the switch (checked derives from
  // level), so clicking the label unchecks → pickAuto(true) → auto L0.
  // The pin itself was already proven by the manual pick (L1 · 1 bands);
  // here the leg proves the switch's own path: off resumes auto + repaints.
  console.log('low-bandwidth pins smallest:', await page.locator('#ro-level').textContent());
  await page.click('#dock-cells label.switch[title="Low-BW"]');
  await page.waitForFunction(
    () => /auto/.test(document.getElementById('ro-level')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('low-bandwidth off resumes auto');
  // Off resumes auto → the 1440px stage repaints L0 (128×128): assert the
  // resume repaints, not the stale L1 frame (off must do work, not just
  // relabel the chip).
  const cellCanvas = await page.locator('#c-cells').evaluate((cv) => ({ w: cv.width, h: cv.height }));
  if (cellCanvas.w !== 128 || cellCanvas.h !== 128) fail(`auto resume expected 128x128, got ${cellCanvas.w}x${cellCanvas.h}`);
  else console.log('auto resume repaints the 128x128 level');

  // ---- 8c. Cell-table brushing: table rows both ways with the viewport.
  // Switch back to L0 (the table labels the painted level), enable Cells,
  // then row→viewport and viewport→row. Signals are persistent: #cellinfo
  // rows, the ro-cells-n count, and the status line — never transients.
  await page.locator('#dock-cells select[aria-label="Pyramid level"]').selectOption('0');
  await page.waitForFunction(
    () => document.querySelector('#c-cells')?.width === 128,
    null, { timeout: 30000 },
  );
  // Same opacity-0 switch input as 8b2: click the label (title="Cells").
  await page.click('#dock-cells label.switch[title="Cells"]');
  await page.waitForFunction(
    () => (document.getElementById('ro-cells-n')?.textContent ?? '').match(/\d+ cells/),
    null, { timeout: 60000 },
  );
  console.log('cell table labels:', await page.locator('#ro-cells-n').textContent());
  await page.waitForSelector('#cellinfo .mrow button[data-cell]', { timeout: 60000 });
  // CellProfiler-studied shape columns ride each row: perimeter + form
  // factor render inline (P + F), the rest in the button title.
  await page.waitForFunction(
    () => /P\d+ F\d\.\d\d/.test(document.querySelector('#cellinfo .mrow button[data-cell]')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('shape columns render:', await page.locator('#cellinfo .mrow button[data-cell]').first().textContent());
  // Row → viewport: click the first row, the button sticks pressed + the
  // status names the cell. Scroll into view first: page.click skips the
  // actionability scroll the locator click performs, and the row sits below
  // the fold after the low-BW cycle repainted the stage.
  await page.locator('#cellinfo .mrow button[data-cell]').first().scrollIntoViewIfNeeded();
  await page.locator('#cellinfo .mrow button[data-cell]').first().click();
  await page.waitForFunction(
    () => document.querySelector('#cellinfo .mrow button[data-cell].on') !== null,
    null, { timeout: 30000 },
  );
  await page.waitForFunction(
    () => /cell #\d+/.test(document.getElementById('status-text')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('row selects cell:', await page.locator('#status-text').textContent());
  // Viewport → table: click the same cell's centroid on the canvas. The
  // centroid rides the button title, canvas pixels map through the same
  // labelmap (L0 full-res: factor 1, canvas 1:1 with tile pixels).
  const picked = await page.evaluate(() => {
    const btn = document.querySelector('#cellinfo .mrow button[data-cell].on');
    const m = (btn?.textContent ?? '').match(/\(([-\d.]+),\s*([-\d.]+)\)/);
    const cv = document.querySelector('#c-cells');
    const r = cv.getBoundingClientRect();
    return { cx: Number(m?.[1]), cy: Number(m?.[2]), rx: r.left, ry: r.top, rw: r.width, rh: r.height, cw: cv.width, ch: cv.height };
  });
  await page.mouse.click(
    picked.rx + (picked.cx / picked.cw) * picked.rw,
    picked.ry + (picked.cy / picked.ch) * picked.rh,
  );
  await page.waitForFunction(
    () => /cell #\d+/.test(document.getElementById('status-text')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('canvas click selects cell:', await page.locator('#status-text').textContent());
  // Background click clears the selection (no .on row remains). Probe the
  // labelmap corners for a true background pixel first: the demo cell fills
  // most of the frame, so a fixed corner guess may land inside the cell and
  // re-select instead of clearing (that is correct hit-testing, not a bug).
  const bgPt = await page.evaluate(() => {
    const cv = document.querySelector('#c-cells');
    const r = cv.getBoundingClientRect();
    // corners of the 128×128 labelmap, mapped to screen px
    const corners = [[2, 2], [125, 2], [2, 125], [125, 125], [64, 2], [2, 64]];
    return { rx: r.left, ry: r.top, rw: r.width, rh: r.height, cw: cv.width, ch: cv.height, corners };
  });
  let cleared = false;
  for (const [lx, ly] of bgPt.corners) {
    await page.mouse.click(bgPt.rx + (lx / bgPt.cw) * bgPt.rw, bgPt.ry + (ly / bgPt.ch) * bgPt.rh);
    try {
      await page.waitForFunction(
        () => document.querySelector('#cellinfo .mrow button[data-cell].on') === null,
        null, { timeout: 4000 },
      );
      cleared = true;
      break;
    } catch { /* inside the cell: re-selected, try the next corner */ }
  }
  if (!cleared) fail('background click never cleared the selection (all corners hit the cell?)');
  else console.log('background click clears the selection');

  // ---- 8d. C1 IDR catalog: picker pins the catalog version, blosc stores
  // stay loud. The probe runs against the live EBI bucket, so the leg
  // tolerates offline sandboxes (pins assert, pixels don't): ro-idr must
  // name the entry + pin, and the status must name the blosc toolchain
  // gap — never a silent empty canvas.
  await page.locator('#dock-cells select[aria-label="IDR screen"]').selectOption('idr0048A');
  await page.waitForFunction(
    () => (document.getElementById('ro-idr')?.textContent ?? '').includes('idr0048A'),
    null, { timeout: 30000 },
  );
  const idrChip = await page.locator('#ro-idr').textContent();
  if (!idrChip.includes('IDR-API-2026-09-17-v0.4') || !idrChip.includes('education overlay')) {
    fail(`IDR chip wrong: ${idrChip}`);
  } else console.log(`IDR catalog pins ${idrChip}`);
  await page.waitForFunction(
    () => {
      const s = document.getElementById('status-text')?.textContent ?? '';
      return s.includes('blosc') || s.includes('zarr open failed');
    },
    null, { timeout: 90000 },
  );
  console.log('IDR blosc gate stays loud:', await page.locator('#status-text').textContent());

  // ---- 8e. M2 organoid screen: the catalog's fourth entry pins the
  // idr0083 store + pin; the open path stays loud on the blosc gate
  // (same contract as 8d — the teaching context is the catalog note).
  await page.locator('#dock-cells select[aria-label="IDR screen"]').selectOption('idr0083-organoids');
  await page.waitForFunction(
    () => (document.getElementById('ro-idr')?.textContent ?? '').includes('idr0083-organoids'),
    null, { timeout: 30000 },
  );
  const organChip = await page.locator('#ro-idr').textContent();
  if (!organChip.includes('IDR-API-2026-09-17-v0.4+0083') || !organChip.includes('education overlay')) {
    fail(`organoid chip wrong: ${organChip}`);
  } else console.log(`organoid catalog pins ${organChip}`);
  await page.waitForFunction(
    () => {
      const s = document.getElementById('status-text')?.textContent ?? '';
      return s.includes('idr0083') && (s.includes('blosc') || s.includes('zarr open failed'));
    },
    null, { timeout: 90000 },
  );
  console.log('organoid blosc gate stays loud:', await page.locator('#status-text').textContent());

  // ---- 9. OME-TIFF volume upload renders as a stack.
  // Same-document hash nav, not goto: the page is already loaded (only the
  // hash changes #/cells → #/), so goto revalidates subresources against a
  // network kept busy by the IDR legs' in-flight EBI fetches. Setting the
  // hash in-page skips the navigation entirely — the hashchange listener
  // swaps the route synchronously.
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  console.log('home after cells:', await page.locator('#ro-axial').textContent());
  // Leg 3 left proj=mean + obl angles on the shared UI store (route swaps
  // don't reset it): picking Slice straightens the view too (the proj
  // handler zeroes oblA/oblB and repaints). The ro-axial tag is written by
  // the same repaint — but paint() early-returns without session.wl, and
  // the NRRD upload's WL state can lag the route swap, so wait on the
  // projseg button state (React, always fresh) instead of the canvas tag.
  await page.click('#projseg button[data-proj="slice"]');
  await page.waitForFunction(
    () => document.querySelector('#projseg button[data-proj="slice"]')?.className.includes('on') ?? false,
    null, { timeout: 30000 },
  );
  await page.setInputFiles('input#upload', join('samples', 'tiny.ome.tif'));
  await page.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent?.includes('Loaded tiny.ome.tif')),
    null, { timeout: 60000 },
  );
  await page.waitForFunction(
    () => document.getElementById('ro-axial')?.textContent?.includes('/ 3'),
    null, { timeout: 30000 },
  );
  console.log('ome-tiff upload renders 8x8x4 stack');

  // ---- 9b. DICOMDIR: directory + slices multi-select opens the series.
  // Hand-rolled Explicit VR LE files via raw bytes (the repo writer is
  // TS-side; the wire authors bytes): DICOMDIR with STUDY→SERIES→2 IMAGE
  // records pointing at SL1/SL2, plus two 2x2 uint8 CT slices (instance
  // 1/2). Persistent signals: #ro-dir counts, worklist row, axial tag.
  const dicomdirFiles = () => {
    const enc = (s) => Buffer.from(s, 'ascii');
    const L32 = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN', 'UV']);
    const el16 = (g, e, vr, v) => {
      const long = L32.has(vr);
      const h = Buffer.alloc(long ? 12 : 8);
      h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2);
      h.write(vr, 4, 2, 'ascii');
      let pad = Buffer.alloc(0);
      if (long) {
        h.writeUInt16LE(0, 6);
        h.writeUInt32LE(v.length, 8);
      } else {
        h.writeUInt16LE(v.length + (v.length % 2), 6);
        if (v.length % 2) pad = Buffer.from([vr === 'UI' ? 0 : 0x20]);
      }
      return Buffer.concat([h, v, pad]);
    };
    const el32 = (g, e, vr, v) => {
      const h = Buffer.alloc(12);
      h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2);
      h.write(vr, 4, 2, 'ascii');
      h.writeUInt32LE(v.length, 8);
      return Buffer.concat([h, v]);
    };
    const ui = (s) => Buffer.concat([enc(s), Buffer.from([0])]);
    const item = (els) => {
      const body = Buffer.concat(els);
      const h = Buffer.alloc(8);
      h.writeUInt16LE(0xfffe, 0); h.writeUInt16LE(0xe000, 2);
      h.writeUInt32LE(body.length, 4);
      return Buffer.concat([h, body]);
    };
    const seqOf = (items) => {
      const body = Buffer.concat(items);
      const h = Buffer.alloc(12);
      h.writeUInt16LE(0x0004, 0); h.writeUInt16LE(0x1220, 2);
      h.write('SQ', 4, 2, 'ascii'); h.writeUInt16LE(0, 6);
      h.writeUInt32LE(body.length, 8);
      return Buffer.concat([h, body]);
    };
    const rec = (type, els) => item([
      el16(0x0004, 0x1430, 'CS', enc(type)), ...els,
    ]);
    const records = Buffer.concat([
      rec('PATIENT', [el16(0x0010, 0x0010, 'PN', enc('WIRE^D'))]),
      rec('STUDY', [
        el16(0x0020, 0x000d, 'UI', ui('1.2.9')),
        el16(0x0008, 0x1030, 'LO', enc('Wire Study')),
      ]),
      rec('SERIES', [
        el16(0x0008, 0x0060, 'CS', enc('CT')),
        el16(0x0020, 0x0011, 'IS', enc('7')),
        el16(0x0020, 0x000e, 'UI', ui('1.2.9.5')),
      ]),
      rec('IMAGE', [
        el16(0x0004, 0x1500, 'CS', enc('SL1')),
        el16(0x0020, 0x0013, 'IS', enc('1')),
      ]),
      rec('IMAGE', [
        el16(0x0004, 0x1500, 'CS', enc('SL2')),
        el16(0x0020, 0x0013, 'IS', enc('2')),
      ]),
    ]);
    const fileMeta = Buffer.concat([
      el16(0x0002, 0x0001, 'OB', Buffer.from([0, 1])),
      el16(0x0002, 0x0002, 'UI', ui('1.2.840.10008.1.3.10')),
      el16(0x0002, 0x0003, 'UI', ui('1.2.9.0')),
      el16(0x0002, 0x0010, 'UI', ui('1.2.840.10008.1.2.1')),
    ]);
    const metaLen = Buffer.alloc(8);
    metaLen.writeUInt16LE(0x0002, 0); metaLen.writeUInt16LE(0x0000, 2);
    metaLen.write('UL', 4, 2, 'ascii'); metaLen.writeUInt16LE(4, 6);
    const metaLenV = Buffer.alloc(4);
    metaLenV.writeUInt32LE(fileMeta.length, 0);
    const dirBytes = Buffer.concat([
      Buffer.alloc(128), enc('DICM'), metaLen, metaLenV, fileMeta,
      el16(0x0008, 0x0016, 'UI', ui('1.2.840.10008.1.3.10')),
      seqOf([records].flatMap((r) => [r])),
    ]);
    const slice = (inst, px) => {
      const head = Buffer.concat([
        Buffer.alloc(128), enc('DICM'), metaLen, metaLenV, Buffer.concat([
          el16(0x0002, 0x0001, 'OB', Buffer.from([0, 1])),
          el16(0x0002, 0x0002, 'UI', ui('1.2.840.10008.5.1.4.1.1.2')),
          el16(0x0002, 0x0003, 'UI', ui(`1.2.9.${inst}`)),
          el16(0x0002, 0x0010, 'UI', ui('1.2.840.10008.1.2.1')),
        ]),
        el16(0x0008, 0x0016, 'UI', ui('1.2.840.10008.5.1.4.1.1.2')),
        el16(0x0008, 0x0060, 'CS', enc('CT')),
        el16(0x0020, 0x000d, 'UI', ui('1.2.9')),
        el16(0x0020, 0x000e, 'UI', ui('1.2.9.5')),
        el16(0x0020, 0x0013, 'IS', enc(String(inst))),
        el16(0x0028, 0x0010, 'US', (() => { const b = Buffer.alloc(2); b.writeUInt16LE(2, 0); return b; })()),
        el16(0x0028, 0x0011, 'US', (() => { const b = Buffer.alloc(2); b.writeUInt16LE(2, 0); return b; })()),
        el16(0x0028, 0x0100, 'US', (() => { const b = Buffer.alloc(2); b.writeUInt16LE(8, 0); return b; })()),
        el16(0x0028, 0x0101, 'US', (() => { const b = Buffer.alloc(2); b.writeUInt16LE(8, 0); return b; })()),
        el16(0x0028, 0x0103, 'US', (() => { const b = Buffer.alloc(2); b.writeUInt16LE(0, 0); return b; })()),
        el16(0x0028, 0x0002, 'US', (() => { const b = Buffer.alloc(2); b.writeUInt16LE(1, 0); return b; })()),
        el16(0x0028, 0x0004, 'CS', enc('MONOCHROME2')),
      ]);
      // Pixel data: OB is a length-32 VR (12B header), built inline.
      const pxb = Buffer.from(px);
      const pxh = Buffer.alloc(12);
      pxh.writeUInt16LE(0x7fe0, 0); pxh.writeUInt16LE(0x0010, 2);
      pxh.write('OB', 4, 2, 'ascii'); pxh.writeUInt16LE(0, 6);
      pxh.writeUInt32LE(pxb.length, 8);
      return Buffer.concat([head, pxh, pxb]);
    };
    const dirPath = join(dir, 'DICOMDIR');
    const sl1 = join(dir, 'SL1');
    const sl2 = join(dir, 'SL2');
    writeFileSync(dirPath, dirBytes);
    writeFileSync(sl1, slice(1, [10, 20, 30, 40]));
    writeFileSync(sl2, slice(2, [50, 60, 70, 80]));
    return { dirPath, sl1, sl2 };
  };
  const { dirPath: ddPath, sl1: ddSl1, sl2: ddSl2 } = dicomdirFiles();
  await page.goto(`${BASE}#/worklist`, { waitUntil: 'networkidle' });
  await openDetails(page);
  await page.waitForSelector('#dock-worklist', { timeout: 90000 });
  await page.setInputFiles('#dicomdir-upload', [ddPath, ddSl1, ddSl2]);
  await page.waitForFunction(
    () => (document.getElementById('ro-dir')?.textContent ?? '').includes('2 refs'),
    null, { timeout: 60000 },
  );
  console.log('dicomdir parses:', await page.locator('#ro-dir').textContent());
  await page.click('#dir-open');
  await page.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => /DICOMDIR: 2 file\(s\)/.test(t.textContent ?? '')),
    null, { timeout: 60000 },
  );
  console.log('dicomdir series opens 2 files');
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page);
  await page.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page.waitForFunction(
    () => (document.getElementById('series-big')?.textContent ?? '').includes('dicomdir:'),
    null, { timeout: 60000 },
  );
  console.log('dicomdir series renders:', await page.locator('#series-big').textContent());

  // ---- 9c. US cine upload: native YBR_FULL_422 multiframe + regions.
  // Hand-rolled Explicit VR LE US file on the 9b byte builders (4x2,
  // 2 frames, 2 region rows + FrameTime 38.714 + RecommendedDisplayFrameRate
  // 26). The #upload path sniffs .dcm into the DICOM importer: frames land
  // on the cine rail (#cine-play appears), the fps seeds from the file,
  // and the tag browser names the regions. Persistent signals only.
  const usFile = () => {
    const US_SOP = '1.2.840.10008.5.1.4.1.1.6.1';
    const u16v = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); return b; };
    const u32v = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v, 0); return b; };
    const fdv = (v) => { const b = Buffer.alloc(8); b.writeDoubleLE(v, 0); return b; };
    const enc = (t) => Buffer.from(t, 'ascii');
    const ui = (t) => Buffer.concat([enc(t), Buffer.from([0])]);
    const el16 = (g, e, vr, v) => {
      const L32 = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN', 'UV']);
      const long = L32.has(vr);
      const h = Buffer.alloc(long ? 12 : 8);
      h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2);
      h.write(vr, 4, 2, 'ascii');
      let pad = Buffer.alloc(0);
      if (long) { h.writeUInt16LE(0, 6); h.writeUInt32LE(v.length, 8); }
      else { h.writeUInt16LE(v.length + (v.length % 2), 6); if (v.length % 2) pad = Buffer.from([vr === 'UI' ? 0 : 0x20]); }
      return Buffer.concat([h, v, pad]);
    };
    const item = (els) => {
      const body = Buffer.concat(els);
      const h = Buffer.alloc(8);
      h.writeUInt16LE(0xfffe, 0); h.writeUInt16LE(0xe000, 2);
      h.writeUInt32LE(body.length, 4);
      return Buffer.concat([h, body]);
    };
    const regions = Buffer.concat([
      (() => {
        const t1 = item([
          el16(0x0018, 0x6012, 'US', u16v(1)), el16(0x0018, 0x6014, 'US', u16v(1)),
          el16(0x0018, 0x6018, 'UL', u32v(11)), el16(0x0018, 0x601a, 'UL', u32v(30)),
          el16(0x0018, 0x601c, 'UL', u32v(788)), el16(0x0018, 0x601e, 'UL', u32v(592)),
          el16(0x0018, 0x6024, 'US', u16v(3)), el16(0x0018, 0x6026, 'US', u16v(3)),
          el16(0x0018, 0x602c, 'FD', fdv(0.0412587)), el16(0x0018, 0x602e, 'FD', fdv(0.0412587)),
        ]);
        const t2 = item([
          el16(0x0018, 0x6012, 'US', u16v(1)), el16(0x0018, 0x6014, 'US', u16v(2)),
          el16(0x0018, 0x6024, 'US', u16v(7)), el16(0x0018, 0x6026, 'US', u16v(7)),
          el16(0x0018, 0x602c, 'FD', fdv(0.1)), el16(0x0018, 0x602e, 'FD', fdv(0.2)),
        ]);
        const body = Buffer.concat([t1, t2]);
        const h = Buffer.alloc(12);
        h.writeUInt16LE(0x0018, 0); h.writeUInt16LE(0x6011, 2);
        h.write('SQ', 4, 2, 'ascii'); h.writeUInt16LE(0, 6);
        h.writeUInt32LE(body.length, 8);
        return Buffer.concat([h, body]);
      })(),
    ]);
    const frame = (seed) => {
      const f = Buffer.alloc(4 * 2 * 2);
      for (let i = 0; i < f.length; i++) f[i] = (i * 37 + seed) & 0xff;
      return f;
    };
    const px = Buffer.concat([frame(0), frame(7)]);
    const pxh = Buffer.alloc(12);
    pxh.writeUInt16LE(0x7fe0, 0); pxh.writeUInt16LE(0x0010, 2);
    pxh.write('OB', 4, 2, 'ascii'); pxh.writeUInt16LE(0, 6);
    pxh.writeUInt32LE(px.length, 8);
    // file meta reuses the 9b shape: group-length + Explicit LE dataset
    const fileMeta = Buffer.concat([
      el16(0x0002, 0x0001, 'OB', Buffer.from([0, 1])),
      el16(0x0002, 0x0002, 'UI', ui(US_SOP)),
      el16(0x0002, 0x0003, 'UI', ui('1.2.9.8.1')),
      el16(0x0002, 0x0010, 'UI', ui('1.2.840.10008.1.2.1')),
    ]);
    const metaLen = Buffer.alloc(8);
    metaLen.writeUInt16LE(0x0002, 0); metaLen.writeUInt16LE(0x0000, 2);
    metaLen.write('UL', 4, 2, 'ascii'); metaLen.writeUInt16LE(4, 6);
    const metaLenV = Buffer.alloc(4);
    metaLenV.writeUInt32LE(fileMeta.length, 0);
    const bytes = Buffer.concat([
      Buffer.alloc(128), enc('DICM'), metaLen, metaLenV, fileMeta,
      el16(0x0008, 0x0016, 'UI', ui(US_SOP)),
      el16(0x0008, 0x0060, 'CS', enc('US')),
      el16(0x0020, 0x000d, 'UI', ui('1.2.9.8')),
      el16(0x0020, 0x000e, 'UI', ui('1.2.9.8.1')),
      el16(0x0028, 0x0010, 'US', u16v(2)),
      el16(0x0028, 0x0011, 'US', u16v(4)),
      el16(0x0028, 0x0100, 'US', u16v(8)),
      el16(0x0028, 0x0101, 'US', u16v(8)),
      el16(0x0028, 0x0102, 'US', u16v(7)),
      el16(0x0028, 0x0103, 'US', u16v(0)),
      el16(0x0028, 0x0002, 'US', u16v(3)),
      el16(0x0028, 0x0004, 'CS', enc('YBR_FULL_422')),
      el16(0x0028, 0x0008, 'IS', enc('2')),
      el16(0x0018, 0x1063, 'DS', enc('38.714')),
      el16(0x0008, 0x2144, 'IS', enc('26')),
      regions, pxh, px,
    ]);
    const p = join(dir, 'wire-us.dcm');
    writeFileSync(p, bytes);
    return p;
  };
  const usPath = usFile();
  await page.setInputFiles('input#upload', usPath);
  try {
    await page.waitForFunction(
      () => (document.getElementById('status-text')?.textContent ?? '').includes('US cine wire-us.dcm: 2 frames @ 26 fps'),
      null, { timeout: 60000 },
    );
  } catch {
    fail(`us cine status wrong: ${await page.locator('#status-text').textContent()} | toasts: ${await page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' || ') || '(none)')}`);
  }
  console.log('us cine opens:', await page.locator('#status-text').textContent());
  await page.waitForSelector('#cine-play', { timeout: 30000 });
  const usT = await page.locator('#ro-time').textContent();
  if (!usT || !usT.startsWith('t=0/1')) fail(`us cine time rail wrong: ${usT}`);
  else console.log(`us cine time rail ${usT}`);
  await page.click('#cine-play');
  await page.waitForFunction(
    (before) => document.getElementById('ro-time')?.textContent !== before,
    usT, { timeout: 15000 },
  );
  console.log(`us cine plays: ${usT} -> ${await page.locator('#ro-time').textContent()}`);
  await page.click('#cine-play');
  const usFps = await page.locator('#cine-fps').inputValue();
  if (usFps !== '26') fail(`us cine fps should seed 26 from the file, got ${usFps}`);
  else console.log('us cine fps seeds 26 from RecommendedDisplayFrameRate');
  await page.waitForSelector('#dcm-meta', { timeout: 30000 });
  const usMeta = await page.locator('#dcm-meta').textContent();
  if (!usMeta || !usMeta.includes('Ultrasound Image') || !usMeta.includes('2 frames @ 26 fps')
    || !usMeta.includes('Tissue + Color Flow')) {
    fail(`us tag browser missing cine/region rows: ${(usMeta ?? '').slice(0, 220)}`);
  } else console.log('us tag browser shows SOP + cine + region rows');

  // ---- 9d. Tomo upload: BTO multiframe stack + laterality/view.
  // Hand-rolled Explicit VR LE BTO file on the 9c byte builders (4x4,
  // 3 frames, imager spacing only + slice interval 1.0 + L/CC): the
  // #upload path stacks frames in file order with imager-spacing
  // fallback, the status names slices + laterality/view, and the tag
  // browser shows the tomo row. Persistent signals only.
  const tomoFile = () => {
    const BTO = '1.2.840.10008.5.1.4.1.1.13.1.3';
    const u16v = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); return b; };
    const enc = (t) => Buffer.from(t, 'ascii');
    const ui = (t) => Buffer.concat([enc(t), Buffer.from([0])]);
    const el16 = (g, e, vr, v) => {
      const L32 = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN', 'UV']);
      const long = L32.has(vr);
      const h = Buffer.alloc(long ? 12 : 8);
      h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2);
      h.write(vr, 4, 2, 'ascii');
      let pad = Buffer.alloc(0);
      if (long) { h.writeUInt16LE(0, 6); h.writeUInt32LE(v.length, 8); }
      else { h.writeUInt16LE(v.length + (v.length % 2), 6); if (v.length % 2) pad = Buffer.from([vr === 'UI' ? 0 : 0x20]); }
      return Buffer.concat([h, v, pad]);
    };
    const px = Buffer.alloc(4 * 4 * 3);
    for (let i = 0; i < px.length; i++) px[i] = (i * 13) & 0xff;
    const pxh = Buffer.alloc(12);
    pxh.writeUInt16LE(0x7fe0, 0); pxh.writeUInt16LE(0x0010, 2);
    pxh.write('OB', 4, 2, 'ascii'); pxh.writeUInt16LE(0, 6);
    pxh.writeUInt32LE(px.length, 8);
    const fileMeta = Buffer.concat([
      el16(0x0002, 0x0001, 'OB', Buffer.from([0, 1])),
      el16(0x0002, 0x0002, 'UI', ui(BTO)),
      el16(0x0002, 0x0003, 'UI', ui('1.2.9.9.1')),
      el16(0x0002, 0x0010, 'UI', ui('1.2.840.10008.1.2.1')),
    ]);
    const metaLen = Buffer.alloc(8);
    metaLen.writeUInt16LE(0x0002, 0); metaLen.writeUInt16LE(0x0000, 2);
    metaLen.write('UL', 4, 2, 'ascii'); metaLen.writeUInt16LE(4, 6);
    const metaLenV = Buffer.alloc(4);
    metaLenV.writeUInt32LE(fileMeta.length, 0);
    const bytes = Buffer.concat([
      Buffer.alloc(128), enc('DICM'), metaLen, metaLenV, fileMeta,
      el16(0x0008, 0x0016, 'UI', ui(BTO)),
      el16(0x0008, 0x0060, 'CS', enc('MG')),
      el16(0x0020, 0x000d, 'UI', ui('1.2.9.9')),
      el16(0x0020, 0x000e, 'UI', ui('1.2.9.9.5')),
      el16(0x0028, 0x0010, 'US', u16v(4)),
      el16(0x0028, 0x0011, 'US', u16v(4)),
      el16(0x0028, 0x0100, 'US', u16v(8)),
      el16(0x0028, 0x0101, 'US', u16v(8)),
      el16(0x0028, 0x0103, 'US', u16v(0)),
      el16(0x0028, 0x0002, 'US', u16v(1)),
      el16(0x0028, 0x0004, 'CS', enc('MONOCHROME2')),
      el16(0x0028, 0x0008, 'IS', enc('3')),
      el16(0x0018, 0x1164, 'DS', enc('0.07\\0.07')),
      el16(0x0018, 0x0088, 'DS', enc('1.0')),
      el16(0x0018, 0x0050, 'DS', enc('1.0')),
      el16(0x0020, 0x0060, 'CS', enc('L')),
      el16(0x0020, 0x0062, 'CS', enc('L')),
      el16(0x0018, 0x5101, 'CS', enc('CC')),
      pxh, px,
    ]);
    const q = join(dir, 'wire-tomo.dcm');
    writeFileSync(q, bytes);
    return q;
  };
  const tomoPath = tomoFile();
  await page.setInputFiles('input#upload', tomoPath);
  await page.waitForFunction(
    () => (document.getElementById('status-text')?.textContent ?? '').includes('Tomo wire-tomo.dcm: 3 slice(s) · L CC · Δ 1 mm'),
    null, { timeout: 60000 },
  );
  console.log('tomo opens:', await page.locator('#status-text').textContent());
  await page.waitForFunction(
    () => document.getElementById('ro-axial')?.textContent === '1 / 2',
    null, { timeout: 30000 },
  );
  console.log('tomo stacks 3 slices (mid-slice 1 / 2)');
  await page.waitForSelector('#dcm-meta', { timeout: 30000 });
  const tomoMeta = await page.locator('#dcm-meta').textContent();
  if (!tomoMeta || !tomoMeta.includes('Breast Tomosynthesis') || !tomoMeta.includes('L CC')
    || !tomoMeta.includes('0.070×0.070 mm/px')) {
    fail(`tomo tag browser missing SOP/tomo rows: ${(tomoMeta ?? '').slice(0, 220)}`);
  } else console.log('tomo tag browser shows SOP + tomo rows');

  // ---- 9e. RTPLAN + RTDOSE uploads: plan summary + Gy grid.
  // Hand-rolled Explicit VR LE files on the 9d byte builders: a 2-beam
  // plan (label + 39 fx + Rx 78 Gy + metersets) and a 4x4x2 16-bit dose
  // grid (scaling 0.01, DVH row ROI 1). The #upload path sniffs SOP
  // class first: the plan lands as a series row with a loud status, the
  // dose opens as a Gy volume with max/mean on the status and both RT
  // rows in the tag browser. Persistent signals only.
  const rtFiles = () => {
    const RPLAN = '1.2.840.10008.5.1.4.1.1.481.5';
    const RDOSE = '1.2.840.10008.5.1.4.1.1.481.2';
    const u16v = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); return b; };
    const enc = (t) => Buffer.from(t, 'ascii');
    const ui = (t) => Buffer.concat([enc(t), Buffer.from([0])]);
    const el16 = (g, e, vr, v) => {
      const L32 = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN', 'UV']);
      const long = L32.has(vr);
      const h = Buffer.alloc(long ? 12 : 8);
      h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2);
      h.write(vr, 4, 2, 'ascii');
      let pad = Buffer.alloc(0);
      if (long) { h.writeUInt16LE(0, 6); h.writeUInt32LE(v.length, 8); }
      else { h.writeUInt16LE(v.length + (v.length % 2), 6); if (v.length % 2) pad = Buffer.from([vr === 'UI' ? 0 : 0x20]); }
      return Buffer.concat([h, v, pad]);
    };
    const item = (els) => {
      const body = Buffer.concat(els);
      const h = Buffer.alloc(8);
      h.writeUInt16LE(0xfffe, 0); h.writeUInt16LE(0xe000, 2);
      h.writeUInt32LE(body.length, 4);
      return Buffer.concat([h, body]);
    };
    const seq = (g, e, items) => {
      const body = Buffer.concat(items);
      const h = Buffer.alloc(12);
      h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2);
      h.write('SQ', 4, 2, 'ascii'); h.writeUInt16LE(0, 6);
      h.writeUInt32LE(body.length, 8);
      return Buffer.concat([h, body]);
    };
    const meta = (sop, inst) => {
      const fileMeta = Buffer.concat([
        el16(0x0002, 0x0001, 'OB', Buffer.from([0, 1])),
        el16(0x0002, 0x0002, 'UI', ui(sop)),
        el16(0x0002, 0x0003, 'UI', ui(inst)),
        el16(0x0002, 0x0010, 'UI', ui('1.2.840.10008.1.2.1')),
      ]);
      const metaLen = Buffer.alloc(8);
      metaLen.writeUInt16LE(0x0002, 0); metaLen.writeUInt16LE(0x0000, 2);
      metaLen.write('UL', 4, 2, 'ascii'); metaLen.writeUInt16LE(4, 6);
      const metaLenV = Buffer.alloc(4);
      metaLenV.writeUInt32LE(fileMeta.length, 0);
      return Buffer.concat([Buffer.alloc(128), enc('DICM'), metaLen, metaLenV, fileMeta]);
    };
    const planBytes = Buffer.concat([
      meta(RPLAN, '1.2.9.10.1'),
      el16(0x0008, 0x0016, 'UI', ui(RPLAN)),
      el16(0x0008, 0x0060, 'CS', enc('RTPLAN')),
      el16(0x300a, 0x0002, 'SH', enc('Prostate-78Gy')),
      el16(0x300a, 0x0003, 'LO', enc('Prostate VMAT')),
      el16(0x300a, 0x000a, 'CS', enc('CURATIVE')),
      seq(0x300a, 0x0070, [item([
        el16(0x300a, 0x0071, 'IS', enc('1')),
        el16(0x300a, 0x0078, 'IS', enc('39')),
        seq(0x300a, 0x0080, [
          item([el16(0x300a, 0x00c0, 'IS', enc('1')), el16(0x300a, 0x0086, 'DS', enc('198.5'))]),
          item([el16(0x300a, 0x00c0, 'IS', enc('2')), el16(0x300a, 0x0086, 'DS', enc('201.5'))]),
        ]),
      ])]),
      seq(0x300a, 0x00b0, [
        item([
          el16(0x300a, 0x00c0, 'IS', enc('1')), el16(0x300a, 0x00c2, 'LO', enc('Arc1')),
          el16(0x300a, 0x00c6, 'CS', enc('PHOTON')),
          seq(0x300a, 0x0111, [item([
            el16(0x300a, 0x0112, 'IS', enc('0')), el16(0x300a, 0x0114, 'DS', enc('6')),
            el16(0x300a, 0x011e, 'DS', enc('181.0')),
          ])]),
        ]),
        item([
          el16(0x300a, 0x00c0, 'IS', enc('2')), el16(0x300a, 0x00c2, 'LO', enc('Arc2')),
          el16(0x300a, 0x00c6, 'CS', enc('PHOTON')),
          seq(0x300a, 0x0111, [item([
            el16(0x300a, 0x0112, 'IS', enc('0')), el16(0x300a, 0x0114, 'DS', enc('6')),
            el16(0x300a, 0x011e, 'DS', enc('179.0')),
          ])]),
        ]),
      ]),
      seq(0x300a, 0x0010, [item([
        el16(0x300a, 0x0012, 'IS', enc('1')), el16(0x300a, 0x0026, 'DS', enc('78.0')),
      ])]),
    ]);
    const dpx = Buffer.alloc(4 * 4 * 2 * 2);
    for (let i = 0; i < 32; i++) dpx.writeUInt16LE((i * 100) % 7000, i * 2);
    const dpxh = Buffer.alloc(12);
    dpxh.writeUInt16LE(0x7fe0, 0); dpxh.writeUInt16LE(0x0010, 2);
    dpxh.write('OB', 4, 2, 'ascii'); dpxh.writeUInt16LE(0, 6);
    dpxh.writeUInt32LE(dpx.length, 8);
    const doseBytes = Buffer.concat([
      meta(RDOSE, '1.2.9.10.2'),
      el16(0x0008, 0x0016, 'UI', ui(RDOSE)),
      el16(0x0008, 0x0060, 'CS', enc('RTDOSE')),
      el16(0x0028, 0x0010, 'US', u16v(4)),
      el16(0x0028, 0x0011, 'US', u16v(4)),
      el16(0x0028, 0x0008, 'IS', enc('2')),
      el16(0x0028, 0x0100, 'US', u16v(16)),
      el16(0x0028, 0x0101, 'US', u16v(16)),
      el16(0x0028, 0x0103, 'US', u16v(0)),
      el16(0x0028, 0x0002, 'US', u16v(1)),
      el16(0x0028, 0x0004, 'CS', enc('MONOCHROME2')),
      el16(0x0020, 0x0032, 'DS', enc('0\\0\\0')),
      el16(0x0028, 0x0030, 'DS', enc('2.5\\2.5')),
      el16(0x3004, 0x000c, 'DS', enc('0\\2.5')),
      el16(0x3004, 0x000e, 'DS', enc('0.01')),
      el16(0x3004, 0x0002, 'CS', enc('GY')),
      seq(0x3004, 0x0050, [item([
        el16(0x3004, 0x0056, 'IS', enc('10')),
        el16(0x3004, 0x0070, 'DS', enc('5.0')),
        el16(0x3004, 0x0072, 'DS', enc('70.0')),
        el16(0x3004, 0x0074, 'DS', enc('60.0')),
        seq(0x3004, 0x0060, [item([el16(0x3006, 0x0084, 'IS', enc('1'))])]),
      ])]),
      dpxh, dpx,
    ]);
    const planPath = join(dir, 'wire-plan.dcm');
    const dosePath = join(dir, 'wire-dose.dcm');
    writeFileSync(planPath, planBytes);
    writeFileSync(dosePath, doseBytes);
    return { planPath, dosePath };
  };
  const { planPath, dosePath } = rtFiles();
  await page.setInputFiles('input#upload', planPath);
  await page.waitForFunction(
    () => (document.getElementById('status-text')?.textContent ?? '').includes('RTPLAN wire-plan.dcm: Prostate-78Gy · 2 beam(s) · 39 fx · Rx 78 Gy'),
    null, { timeout: 60000 },
  );
  console.log('rtplan opens:', await page.locator('#status-text').textContent());
  await page.waitForSelector('#dcm-meta', { timeout: 30000 });
  const planMeta = await page.locator('#dcm-meta').textContent();
  if (!planMeta || !planMeta.includes('RT Plan') || !planMeta.includes('Prostate-78Gy')
    || !planMeta.includes('2 beam(s)') || !planMeta.includes('Rx 78 Gy')) {
    fail(`rtplan tag browser missing RT rows: ${(planMeta ?? '').slice(0, 220)}`);
  } else console.log('rtplan tag browser shows SOP + plan rows');
  await page.setInputFiles('input#upload', dosePath);
  await page.waitForFunction(
    () => (document.getElementById('status-text')?.textContent ?? '').includes('RTDOSE wire-dose.dcm: max 31.00 Gy'),
    null, { timeout: 60000 },
  );
  console.log('rtdose opens:', await page.locator('#status-text').textContent());
  // Two frames stack into a 2-slice grid: the readout's max index is 1.
  // Which slice it opens on is the start-slice rule's business, not RT's
  // (this leg pinned '0 / 1' while the NRRD leg pins floor(nz/2) = '2 / 3').
  await page.waitForFunction(
    () => /^\d+ \/ 1$/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log(`rtdose grid stacks 2 frames (axial ${await page.locator('#ro-axial').textContent()})`);
  await page.waitForSelector('#dcm-meta', { timeout: 30000 });
  const doseMeta = await page.locator('#dcm-meta').textContent();
  if (!doseMeta || !doseMeta.includes('RT Dose') || !doseMeta.includes('max 31.00 Gy')
    || !doseMeta.includes('1 ROI(s)')) {
    fail(`rtdose tag browser missing RT rows: ${(doseMeta ?? '').slice(0, 220)}`);
  } else console.log('rtdose tag browser shows SOP + dose rows');

  // ---- 9f. VL whole-slide + encapsulated PDF uploads.
  // Hand-rolled Explicit VR LE files on the 9e byte builders: a VL
  // microscopic file (64x48 tile + 192x96 matrix + 6 offsets + focus +
  // 2 optical paths) and an encapsulated PDF (title + MIME + 256
  // bytes). The #upload path sniffs SOP first: the slide opens its
  // representative tile with the grid on the status, the document
  // lands as a metadata row with bytes + MIME. Persistent signals only.
  const vlDocFiles = () => {
    const VLM = '1.2.840.10008.5.1.4.1.1.77.1.2';
    const PDF = '1.2.840.10008.5.1.4.1.1.104.1';
    const u16v = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); return b; };
    const u32v = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v, 0); return b; };
    const s32v = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v, 0); return b; };
    const enc = (t) => Buffer.from(t, 'ascii');
    const ui = (t) => Buffer.concat([enc(t), Buffer.from([0])]);
    const el16 = (g, e, vr, v) => {
      const L32 = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN', 'UV']);
      const long = L32.has(vr);
      const h = Buffer.alloc(long ? 12 : 8);
      h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2);
      h.write(vr, 4, 2, 'ascii');
      let pad = Buffer.alloc(0);
      if (long) { h.writeUInt16LE(0, 6); h.writeUInt32LE(v.length, 8); }
      else { h.writeUInt16LE(v.length + (v.length % 2), 6); if (v.length % 2) pad = Buffer.from([vr === 'UI' ? 0 : 0x20]); }
      return Buffer.concat([h, v, pad]);
    };
    const item = (els) => {
      const body = Buffer.concat(els);
      const h = Buffer.alloc(8);
      h.writeUInt16LE(0xfffe, 0); h.writeUInt16LE(0xe000, 2);
      h.writeUInt32LE(body.length, 4);
      return Buffer.concat([h, body]);
    };
    const seq = (g, e, items) => {
      const body = Buffer.concat(items);
      const h = Buffer.alloc(12);
      h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2);
      h.write('SQ', 4, 2, 'ascii'); h.writeUInt16LE(0, 6);
      h.writeUInt32LE(body.length, 8);
      return Buffer.concat([h, body]);
    };
    const meta = (sop, inst) => {
      const fileMeta = Buffer.concat([
        el16(0x0002, 0x0001, 'OB', Buffer.from([0, 1])),
        el16(0x0002, 0x0002, 'UI', ui(sop)),
        el16(0x0002, 0x0003, 'UI', ui(inst)),
        el16(0x0002, 0x0010, 'UI', ui('1.2.840.10008.1.2.1')),
      ]);
      const metaLen = Buffer.alloc(8);
      metaLen.writeUInt16LE(0x0002, 0); metaLen.writeUInt16LE(0x0000, 2);
      metaLen.write('UL', 4, 2, 'ascii'); metaLen.writeUInt16LE(4, 6);
      const metaLenV = Buffer.alloc(4);
      metaLenV.writeUInt32LE(fileMeta.length, 0);
      return Buffer.concat([Buffer.alloc(128), enc('DICM'), metaLen, metaLenV, fileMeta]);
    };
    const offsets = [];
    for (let k = 0; k < 6; k++) {
      offsets.push(item([
        el16(0x0048, 0x021e, 'SL', s32v(Math.floor(k / 3) * 48)),
        el16(0x0048, 0x021f, 'SL', s32v((k % 3) * 64)),
      ]));
    }
    const vpx = Buffer.alloc(64 * 48);
    for (let i = 0; i < vpx.length; i++) vpx[i] = (i * 7) & 0xff;
    const vpxh = Buffer.alloc(12);
    vpxh.writeUInt16LE(0x7fe0, 0); vpxh.writeUInt16LE(0x0010, 2);
    vpxh.write('OB', 4, 2, 'ascii'); vpxh.writeUInt16LE(0, 6);
    vpxh.writeUInt32LE(vpx.length, 8);
    const vlBytes = Buffer.concat([
      meta(VLM, '1.2.9.11.1'),
      el16(0x0008, 0x0016, 'UI', ui(VLM)),
      el16(0x0008, 0x0060, 'CS', enc('SM')),
      el16(0x0028, 0x0010, 'US', u16v(48)),
      el16(0x0028, 0x0011, 'US', u16v(64)),
      el16(0x0028, 0x0100, 'US', u16v(8)),
      el16(0x0028, 0x0101, 'US', u16v(8)),
      el16(0x0028, 0x0103, 'US', u16v(0)),
      el16(0x0028, 0x0002, 'US', u16v(1)),
      el16(0x0028, 0x0004, 'CS', enc('MONOCHROME2')),
      el16(0x0048, 0x0006, 'UL', u32v(192)),
      el16(0x0048, 0x0007, 'UL', u32v(96)),
      seq(0x0048, 0x0008, [item([
        el16(0x0048, 0x021e, 'SL', s32v(0)),
        el16(0x0048, 0x021f, 'SL', s32v(0)),
      ])]),
      seq(0x0048, 0x021a, offsets),
      el16(0x0048, 0x0013, 'US', u16v(1)),
      seq(0x0048, 0x0105, [
        item([el16(0x0048, 0x0106, 'SH', enc('1'))]),
        item([el16(0x0048, 0x0106, 'SH', enc('2'))]),
      ]),
      vpxh, vpx,
    ]);
    const pdf = Buffer.alloc(256);
    pdf[0] = 0x25; pdf[1] = 0x50; pdf[2] = 0x44; pdf[3] = 0x46;
    const pdfBytes = Buffer.concat([
      meta(PDF, '1.2.9.11.2'),
      el16(0x0008, 0x0016, 'UI', ui(PDF)),
      el16(0x0008, 0x0060, 'CS', enc('DOC')),
      el16(0x0042, 0x0010, 'ST', enc('Pathology report')),
      el16(0x0042, 0x0012, 'LO', enc('application/pdf')),
      el16(0x0042, 0x0011, 'OB', pdf),
    ]);
    const vlPath = join(dir, 'wire-vl.dcm');
    const pdfPath = join(dir, 'wire-report.pdf.dcm');
    writeFileSync(vlPath, vlBytes);
    writeFileSync(pdfPath, pdfBytes);
    return { vlPath, pdfPath };
  };
  const { vlPath, pdfPath } = vlDocFiles();
  await page.setInputFiles('input#upload', vlPath);
  await page.waitForFunction(
    () => (document.getElementById('status-text')?.textContent ?? '').includes('VL wire-vl.dcm: tile 64×48 · 192×96 total · 6 located'),
    null, { timeout: 60000 },
  );
  console.log('vl opens:', await page.locator('#status-text').textContent());
  await page.waitForSelector('#dcm-meta', { timeout: 30000 });
  const vlMeta = await page.locator('#dcm-meta').textContent();
  if (!vlMeta || !vlMeta.includes('VL Microscopic') || !vlMeta.includes('192×96 total')) {
    fail(`vl tag browser missing VL rows: ${(vlMeta ?? '').slice(0, 220)}`);
  } else console.log('vl tag browser shows SOP + grid rows');
  await page.setInputFiles('input#upload', pdfPath);
  await page.waitForFunction(
    () => (document.getElementById('status-text')?.textContent ?? '').includes('Document wire-report.pdf.dcm: PDF · Pathology report · 256 bytes'),
    null, { timeout: 60000 },
  );
  console.log('encapsulated pdf opens:', await page.locator('#status-text').textContent());
  await page.waitForSelector('#dcm-meta', { timeout: 30000 });
  const pdfMeta = await page.locator('#dcm-meta').textContent();
  if (!pdfMeta || !pdfMeta.includes('Encapsulated PDF') || !pdfMeta.includes('256 bytes')
    || !pdfMeta.includes('application/pdf')) {
    fail(`pdf tag browser missing document rows: ${(pdfMeta ?? '').slice(0, 220)}`);
  } else console.log('pdf tag browser shows SOP + document rows');
  // C2 teaching annotations: re-open the VL slide (the doc has no
  // grid, so the table hides there), assert empty, load the demo set.
  await page.setInputFiles('input#upload', vlPath);
  await page.waitForFunction(
    () => (document.getElementById('status-text')?.textContent ?? '').includes('representative'),
    null, { timeout: 60000 },
  );
  await page.waitForSelector('#dcm-meta', { timeout: 30000 });
  const wsiEmpty = await page.locator('#dcm-meta').textContent();
  // The teaching-regions row is always there on a VL tile (it holds the
  // Demo button this leg clicks next); "annotation-free" means no regions in it.
  if (wsiEmpty.includes('Gradient field') || wsiEmpty.includes('shown')) fail('real upload should start with no teaching regions');
  else console.log('real VL upload starts annotation-free');
  await page.click('#wsi-demo');
  await page.waitForFunction(
    () => (document.getElementById('dcm-meta')?.textContent ?? '').includes('Gradient field'),
    null, { timeout: 30000 },
  );
  const wsiRows = await page.locator('#dcm-meta').textContent();
  for (const needle of ['Gradient field · H&E', '[0,0]–[31,23]', 'Banding band', 'Whole-tile context', '3 shown', 'education overlay']) {
    if (!wsiRows.includes(needle)) fail(`teaching region row missing ${needle}: ${wsiRows.slice(0, 300)}`);
  }
  console.log('demo annotations render with clipped rects + badge');

  // ---- 9g. JPEG-LS upload: CharLS-encoded 8-bit frame opens as pixels.
  // Hand-rolled Explicit VR LE file on the 9f byte builders: the LS
  // stream is generated at author time by the CharLS reference encoder
  // (imagecodecs) over a 16x16 ramp and pasted below as bytes — no
  // patient data, exact pixels pinned. Status names the decode.
  const lsFile = () => {
    const LS80 = '1.2.840.10008.1.2.4.80';
    const u16v = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); return b; };
    const enc = (t) => Buffer.from(t, 'ascii');
    const ui = (t) => Buffer.concat([enc(t), Buffer.from([0])]);
    const el16 = (g, e, vr, v) => {
      const L32 = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN', 'UV']);
      const long = L32.has(vr);
      const h = Buffer.alloc(long ? 12 : 8);
      h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2);
      h.write(vr, 4, 2, 'ascii');
      let pad = Buffer.alloc(0);
      if (long) { h.writeUInt16LE(0, 6); h.writeUInt32LE(v.length, 8); }
      else { h.writeUInt16LE(v.length + (v.length % 2), 6); if (v.length % 2) pad = Buffer.from([vr === 'UI' ? 0 : 0x20]); }
      return Buffer.concat([h, v, pad]);
    };
    // 16x16 ramp 0..255, CharLS jpegls_encode (see fixtures-jpegls.ts).
    const LS_RAMP_PASTE_ME = [255,216,255,232,0,32,83,80,73,70,70,0,2,0,0,1,0,0,0,16,0,0,0,16,8,8,6,1,0,0,1,44,0,0,1,44,255,232,0,8,0,0,0,1,255,216,255,247,0,11,8,0,16,0,16,1,1,17,0,255,218,0,8,1,1,0,0,0,0,173,182,253,191,254,1,52,175,255,0,39,255,120,247,255,121,207,255,115,95,255,108,127,255,45,255,126,167,255,122,95,255,104,127,255,123,255,127,159,255,124,255,127,215,255,126,191,255,64,255,217];
    const lsJpg = Buffer.from(LS_RAMP_PASTE_ME);
    const BOT = Buffer.alloc(0); // empty basic offset table (zero-length item)
    const both = (b) => { const h = Buffer.alloc(8); h.writeUInt16LE(0xfffe, 0); h.writeUInt16LE(0xe000, 2); h.writeUInt32LE(b.length, 4); return Buffer.concat([h, b]); };
    const pxh = Buffer.alloc(12);
    pxh.writeUInt16LE(0x7fe0, 0); pxh.writeUInt16LE(0x0010, 2);
    pxh.write('OB', 4, 2, 'ascii'); pxh.writeUInt16LE(0, 6);
    pxh.writeUInt32LE(0xffffffff, 8); // undefined length: encapsulated
    const fileMeta = Buffer.concat([
      el16(0x0002, 0x0001, 'OB', Buffer.from([0, 1])),
      el16(0x0002, 0x0002, 'UI', ui(LS80)),
      el16(0x0002, 0x0003, 'UI', ui('1.2.9.12.1')),
      el16(0x0002, 0x0010, 'UI', ui(LS80)),
    ]);
    const metaLen = Buffer.alloc(8);
    metaLen.writeUInt16LE(0x0002, 0); metaLen.writeUInt16LE(0x0000, 2);
    metaLen.write('UL', 4, 2, 'ascii'); metaLen.writeUInt16LE(4, 6);
    const metaLenV = Buffer.alloc(4);
    metaLenV.writeUInt32LE(fileMeta.length, 0);
    const seqEnd = Buffer.alloc(8);
    seqEnd.writeUInt16LE(0xfffe, 0); seqEnd.writeUInt16LE(0xe0dd, 2); seqEnd.writeUInt32LE(0, 4);
    const bytes = Buffer.concat([
      Buffer.alloc(128), enc('DICM'), metaLen, metaLenV, fileMeta,
      el16(0x0008, 0x0016, 'UI', ui('1.2.840.10008.5.1.4.1.1.2')),
      el16(0x0008, 0x0060, 'CS', enc('CT')),
      el16(0x0020, 0x000d, 'UI', ui('1.2.9.12')),
      el16(0x0020, 0x000e, 'UI', ui('1.2.9.12.5')),
      el16(0x0028, 0x0010, 'US', u16v(16)),
      el16(0x0028, 0x0011, 'US', u16v(16)),
      el16(0x0028, 0x0100, 'US', u16v(8)),
      el16(0x0028, 0x0101, 'US', u16v(8)),
      el16(0x0028, 0x0103, 'US', u16v(0)),
      el16(0x0028, 0x0002, 'US', u16v(1)),
      el16(0x0028, 0x0004, 'CS', enc('MONOCHROME2')),
      pxh, both(BOT), both(lsJpg), seqEnd,
    ]);
    const q = join(dir, 'wire-ls.dcm');
    writeFileSync(q, bytes);
    return q;
  };
  const lsPath = lsFile();
  await page.setInputFiles('input#upload', lsPath);
  await page.waitForFunction(
    () => (document.getElementById('status-text')?.textContent ?? '').includes('Loaded wire-ls.dcm'),
    null, { timeout: 60000 },
  );
  console.log('jpeg-ls opens:', await page.locator('#status-text').textContent());
  await page.waitForFunction(
    () => document.getElementById('ro-axial')?.textContent === '0 / 0',
    null, { timeout: 30000 },
  );
  console.log('jpeg-ls renders 16x16 single frame');


  // ---- 10. Appearance: 5 text levels, 5 layout levels, reload persistence.
  await page.click('#appearance');
  await page.waitForSelector('#appear-text', { timeout: 30000 });
  const bodyPx = () => page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  // Expectations follow tokens.css: body text is --fs-md (13.5px) × the --ts
  // ramp, and rhythm is --sp-2 (6px) × the --sp ramp, read off the file-tab
  // row's bottom padding. (The dock this leg used to measure lost its
  // padding in the UI rebuild, and the ramp's base moved from 13px to 13.5px;
  // the leg sat unreached behind earlier failures while both drifted.)
  const dockPadTop = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ftop')).paddingBottom));
  const textLevels = [['xs', 11.07], ['s', 12.285], ['m', 13.5], ['l', 14.985], ['xl', 16.74]];
  for (const [lv, px] of textLevels) {
    await page.click(`#appear-text button[data-tsize="${lv}"]`);
    await page.waitForFunction((v) => document.documentElement.dataset.text === v, lv, { timeout: 30000 });
    const got = await bodyPx();
    if (Math.abs(got - px) > 0.01) fail(`text ${lv}: body ${got}px, want ${px}px`);
  }
  console.log('text scale hits all 5 levels (11.07/12.285/13.5/14.985/16.74px)');
  const layoutLevels = [['xs', 4.08], ['s', 5.04], ['m', 6], ['l', 7.2], ['xl', 8.4]];
  for (const [lv, pad] of layoutLevels) {
    await page.click(`#appear-density button[data-density="${lv}"]`);
    await page.waitForFunction((v) => document.documentElement.dataset.density === v, lv, { timeout: 30000 });
    const got = await dockPadTop();
    if (Math.abs(got - pad) > 0.01) fail(`layout ${lv}: rhythm ${got}px, want ${pad}px`);
  }
  console.log('layout size hits all 5 levels (rhythm 4.08/5.04/6/7.2/8.4px)');
  // Reload: chrome prefs survive via localStorage (parked at the extremes).
  await page.click('#appear-text button[data-tsize="xl"]');
  await page.click('#appear-density button[data-density="xs"]');
  await page.waitForFunction(
    () => document.documentElement.dataset.text === 'xl' && document.documentElement.dataset.density === 'xs',
    null, { timeout: 30000 },
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => document.documentElement.dataset.text === 'xl' && document.documentElement.dataset.density === 'xs',
    null, { timeout: 30000 },
  );
  const persisted = await bodyPx();
  if (Math.abs(persisted - 16.74) > 0.01) fail(`text scale not persisted: ${persisted} vs 16.74`);
  else console.log('appearance persists across reload');
  // Restore defaults so later runs start balanced/medium.
  await page.click('#appearance');
  await page.click('#appear-text button[data-tsize="m"]');
  await page.click('#appear-density button[data-density="m"]');
  await page.waitForFunction(
    () => document.documentElement.dataset.text === 'm' && document.documentElement.dataset.density === 'm',
    null, { timeout: 30000 },
  );

  // ---- 11. File tabs: open file, switch, close; per-viewport fullscreen.
  const activeTab = () => page.evaluate(
    () => document.querySelector('#filetabs [data-active="true"]')?.getAttribute('data-tab'),
  );
  const t0 = await activeTab();
  if (!t0) fail('no active file tab');
  const other = t0 === 'liver-ct-seg' ? 'brats-flair-seg' : 'liver-ct-seg';
  await page.selectOption('.top select.dark', other);
  await page.waitForFunction(
    (t) => document.querySelector(`#filetabs [data-tab="${t}"][data-active="true"]`),
    other, { timeout: 60000 },
  );
  const nTabs = await page.evaluate(() => document.querySelectorAll('#filetabs [data-tab]').length);
  if (nTabs !== 2) fail(`opening a series should pin a second tab, got ${nTabs}`);
  else console.log(`file tab opens: ${t0} + ${other}`);
  await page.click(`#filetabs [data-tab="${t0}"]`);
  await page.waitForFunction(
    (t) => document.querySelector('#filetabs [data-active="true"]')?.getAttribute('data-tab') === t,
    t0, { timeout: 60000 },
  );
  console.log('file tab switches back');
  await page.click('#full-axial');
  await page.waitForFunction(() => document.getElementById('viewgrid')?.dataset.full === 'axial', null, { timeout: 30000 });
  // Fullscreen means: the other column hidden, this pane spanning the stage.
  await page.waitForFunction(
    () => getComputedStyle(document.getElementById('vp-3d')).display === 'none',
    null, { timeout: 30000 },
  );
  const axialVisible = await page.evaluate(() => {
    const r = document.getElementById('pane-axial')?.getBoundingClientRect();
    return r && r.width > 200;
  });
  if (!axialVisible) fail('axial fullscreen did not take the stage');
  else console.log('axial fullscreen spans the grid');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('viewgrid')?.dataset.full, null, { timeout: 30000 });
  console.log('Escape exits fullscreen');
  // Toolbar toggle. The toolbar now floats over the image like a site's nav
  // instead of pushing it down, so the assertion is the stronger one: the
  // stage already owns the full work area, and showing or hiding chrome must
  // not cost the image a single pixel of height.
  const gridH = () => page.evaluate(() => document.getElementById('viewgrid')?.getBoundingClientRect().height);
  const hOpen = await gridH();
  await page.click('#docktoggle');
  await page.waitForFunction(() => !document.getElementById('dockrow-2d'), null, { timeout: 30000 });
  const hHidden = await gridH();
  if (Math.abs(hHidden - hOpen) > 1) fail(`toolbar is not an overlay — it changed stage height: ${hOpen} -> ${hHidden}`);
  else console.log(`toolbar overlays the stage, costing it no height: ${Math.round(hOpen)} == ${Math.round(hHidden)}`);
  await page.click('#docktoggle');
  await page.waitForSelector('#dockrow-2d', { timeout: 30000 });
  await page.click(`#filetabs [data-closetab="${other}"]`);
  await page.waitForFunction(() => document.querySelectorAll('#filetabs [data-tab]').length === 1, null, { timeout: 30000 });
  const tEnd = await activeTab();
  if (tEnd !== t0) fail(`closing a tab should leave ${t0} active, got ${tEnd}`);
  else console.log('file tab closes, original stays active');

  // ---- 12. Ellipse ROI: two taps on the axial canvas record area + HU stats.
  const page4 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page4.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page4.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page4);
  await page4.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page4.click('#modeseg button[data-mode="measure"]');
  await page4.click('#kindseg button[data-kind="ellipse"]');
  const cbox = await page4.locator('#c-axial').boundingBox();
  await page4.mouse.click(cbox.x + cbox.width / 2 - 60, cbox.y + cbox.height / 2 - 40);
  await page4.mouse.click(cbox.x + cbox.width / 2 + 60, cbox.y + cbox.height / 2 + 40);
  await page4.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => /ellipse: [\d.]+ mm² · μ/.test(t.textContent ?? '')),
    null, { timeout: 30000 },
  );
  console.log('ellipse toast:', await page4.locator('#toasts .toast').first().textContent());
  const measInfo = await page4.locator('#measureinfo').textContent();
  if (!measInfo || !/Ellipse[\s\S]*mm²/.test(measInfo)) fail(`ellipse missing from measure panel: ${measInfo}`);
  else console.log('ellipse area lands in the measure panel');
  await page4.close();

  // ---- 13. Cine transport: play advances frames, FPS slider retimes, pause holds.
  const page5 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page5.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page5.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page5);
  await page5.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page5.click('#openpal');
  await page5.waitForSelector('#palinput', { timeout: 30000 });
  await page5.fill('#palinput', 'cardiac-4d-cine');
  await page5.waitForSelector('#pallist li', { timeout: 30000 });
  await page5.click('#pallist li');
  await page5.waitForFunction(
    () => document.getElementById('status-text')?.textContent?.includes('cardiac-4d-cine'),
    null, { timeout: 90000 },
  );
  await page5.waitForSelector('#cine-play', { timeout: 30000 });
  const tBefore = await page5.locator('#ro-time').textContent();
  await page5.click('#cine-play');
  await page5.waitForFunction(
    (before) => document.getElementById('ro-time')?.textContent !== before,
    tBefore, { timeout: 15000 },
  );
  console.log(`cine plays: ${tBefore} -> ${await page5.locator('#ro-time').textContent()}`);
  await page5.locator('#cine-fps').focus();
  await page5.keyboard.press('ArrowRight');
  await page5.keyboard.press('ArrowRight');
  const fps = await page5.locator('#cine-fps').inputValue();
  if (fps !== '6') fail(`cine fps expected 6, got ${fps}`);
  else console.log('cine fps retimes to 6');
  await page5.click('#cine-play');
  const paused = await page5.locator('#cine-play').getAttribute('title');
  if (paused !== 'Play cine') fail(`cine did not pause: title=${paused}`);
  else console.log('cine pauses');

  // ---- 14. Invert flips axial pixels (pre-overlay, alpha untouched).
  const pxBefore = await page5.evaluate(() => {
    const cv = document.getElementById('c-axial');
    const d = cv.getContext('2d').getImageData(
      Math.floor(cv.width / 2) - 2, Math.floor(cv.height / 2) - 2, 5, 5).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return s;
  });
  // The switch track covers the checkbox (real users click the label).
  await page5.click('label.switch[title="Invert"]');
  await page5.waitForFunction(
    (before) => {
      const cv = document.getElementById('c-axial');
      const d = cv.getContext('2d').getImageData(
        Math.floor(cv.width / 2) - 2, Math.floor(cv.height / 2) - 2, 5, 5).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return s !== before;
    },
    pxBefore, { timeout: 30000 },
  );
  console.log(`invert flips axial patch sum ${pxBefore} -> different`);
  await page5.close();

  // ---- 15. TRK + TRX tracts import through the same fiber path as TCK.
  const page6 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page6.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page6.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page6);
  await page6.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page6.selectOption('.top select.dark', 'cardiac-frame01');
  await page6.waitForFunction(
    () => /\/ 9(\s|·|$)/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page6.setInputFiles('input#upload', trkPath);
  await page6.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent?.includes('Tracts imported: 1 streamline')),
    null, { timeout: 60000 },
  );
  console.log('trk import toasts 1 streamline');
  await page6.setInputFiles('input#upload', trxPath);
  await page6.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent?.includes('Tracts imported: 1 streamline')),
    null, { timeout: 60000 },
  );
  console.log('trx import toasts 1 streamline');
  await page6.close();

  // ---- 16. DICOM tag browser: catalog CT series shows SOP + matrix rows.
  const page7 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page7.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page7.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page7);
  await page7.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page7.click('#openpal');
  await page7.waitForSelector('#palinput', { timeout: 30000 });
  await page7.fill('#palinput', 'lung-ct-dicom');
  await page7.waitForSelector('#pallist li', { timeout: 30000 });
  await page7.click('#pallist li');
  await page7.waitForFunction(
    () => document.getElementById('status-text')?.textContent?.includes('lung-ct-dicom'),
    null, { timeout: 90000 },
  );
  await page7.waitForSelector('#dcm-meta', { timeout: 30000 });
  const meta = await page7.locator('#dcm-meta').textContent();
  if (!meta || !meta.includes('CT Image') || !meta.includes('matrix')) {
    fail(`tag browser missing SOP/matrix rows: ${(meta ?? '').slice(0, 200)}`);
  } else console.log('tag browser shows CT Image + matrix rows');
  await page7.close();

  // ---- 17. Rectangle ROI: two taps record area mm² + HU stats.
  const page8 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page8.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page8.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page8);
  await page8.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page8.click('#modeseg button[data-mode="measure"]');
  await page8.click('#kindseg button[data-kind="roi"]');
  const rbox = await page8.locator('#c-axial').boundingBox();
  await page8.mouse.click(rbox.x + rbox.width / 2 - 60, rbox.y + rbox.height / 2 - 40);
  await page8.mouse.click(rbox.x + rbox.width / 2 + 60, rbox.y + rbox.height / 2 + 40);
  await page8.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => /roi: [\d.]+ mm² · μ/.test(t.textContent ?? '')),
    null, { timeout: 30000 },
  );
  console.log('rect toast:', await page8.locator('#toasts .toast').first().textContent());
  const rectInfo = await page8.locator('#measureinfo').textContent();
  if (!rectInfo || !/ROI[\s\S]*mm²/.test(rectInfo)) fail(`rect missing from measure panel: ${rectInfo}`);
  else console.log('rect area lands in the measure panel');

  // ---- 18. Cobb angle: four taps draw two lines, acute angle tracked.
  // Line 1 horizontal; line 2 slants atan(40/120) ≈ 18° — a real value pin.
  // Axial-emphasis layout first: the tri-stack panes are short and taps
  // near the edge fall into the neighbor pane (plane reset, toast never).
  await page8.click('#kindseg button[data-kind="cobb"]');
  await page8.click('#layoutseg button[data-layout="axial"]');
  await page8.waitForTimeout(600);
  const abox = await page8.locator('#c-axial').boundingBox();
  const cx = abox.x + abox.width / 2, cy = abox.y + abox.height / 2;
  await page8.mouse.click(cx - 80, cy - 40);
  await page8.mouse.click(cx + 80, cy - 40);
  await page8.mouse.click(cx - 60, cy + 50);
  await page8.mouse.click(cx + 60, cy + 10);
  await page8.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => /cobb: (1\d|20)°/.test(t.textContent ?? '')),
    null, { timeout: 30000 },
  );
  console.log('cobb toast:', await page8.evaluate(() =>
    [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).find((t) => /cobb: /.test(t ?? ''))));
  const cobbInfo = await page8.locator('#measureinfo').textContent();
  if (!cobbInfo || !/Cobb[\s\S]*°/.test(cobbInfo)) fail(`cobb missing from measure panel: ${cobbInfo}`);
  else console.log('cobb angle lands in the measure panel');
  await page8.close();

  // ---- 19. Colormap: Fire LUT repaints axial canvas in color, back to gray.
  const page9 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page9.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page9.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page9);
  await page9.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  // Seg-less series: the default brain mask tints the center patch red,
  // which would fail the grayscale baseline below.
  await page9.selectOption('.top select.dark', 'cardiac-frame01');
  await page9.waitForFunction(
    () => /\/ 9(\s|·|$)/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  const patchHue = () => page9.evaluate(() => {
    const cv = document.getElementById('c-axial');
    const d = cv.getContext('2d').getImageData(
      Math.floor(cv.width / 2) - 2, Math.floor(cv.height / 2) - 2, 5, 5).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return { r: r / n, g: g / n, b: b / n };
  });
  const gray = await patchHue();
  if (Math.abs(gray.r - gray.g) > 2 || Math.abs(gray.g - gray.b) > 2) {
    fail(`default pane not grayscale: ${JSON.stringify(gray)}`);
  }
  await page9.selectOption('#dock-tune select[title="Colormap"]', 'Fire');
  await page9.waitForFunction(() => {
    const cv = document.getElementById('c-axial');
    const d = cv.getContext('2d').getImageData(
      Math.floor(cv.width / 2) - 2, Math.floor(cv.height / 2) - 2, 5, 5).data;
    let r = 0, g = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; n++; }
    return r / n > g / n + 5;
  }, null, { timeout: 30000 });
  console.log('fire LUT paints red-dominant axial patch');
  await page9.selectOption('#dock-tune select[title="Colormap"]', 'Grayscale');
  await page9.waitForFunction(() => {
    const cv = document.getElementById('c-axial');
    const d = cv.getContext('2d').getImageData(
      Math.floor(cv.width / 2) - 2, Math.floor(cv.height / 2) - 2, 5, 5).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    r /= n; g /= n; b /= n;
    return Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2;
  }, null, { timeout: 30000 });
  console.log('grayscale restores neutral patch');
  await page9.close();

  // ---- 21. Crosshair reference lines: an axial tap draws them on coronal.
  const page10 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page10.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page10.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page10);
  await page10.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  // Teal accent pixels (lines) vs red mask tint vs near-white chrome text.
  const tealCount = () => page10.evaluate(() => {
    const cv = document.getElementById('c-coronal');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 1] - d[i] > 60 && d[i + 1] > 80) n++;
    }
    return n;
  });
  const tealBefore = await tealCount();
  const xbox = await page10.locator('#c-axial').boundingBox();
  await page10.mouse.click(xbox.x + xbox.width / 2, xbox.y + xbox.height / 2);
  await page10.waitForFunction((before) => {
    const cv = document.getElementById('c-coronal');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 1] - d[i] > 60 && d[i + 1] > 80) n++;
    }
    return n > Math.max(100, before + 50);
  }, tealBefore, { timeout: 30000 });
  console.log(`crosshair lines appear on coronal (teal px ${tealBefore} -> up)`);

  // ---- 22. Shift-drag window/level: ro-wl readout + pixels follow.
  const wlBefore = await page10.locator('#ro-wl').textContent();
  await page10.keyboard.down('Shift');
  await page10.mouse.move(xbox.x + xbox.width / 2, xbox.y + xbox.height / 2);
  await page10.mouse.down();
  await page10.mouse.move(xbox.x + xbox.width / 2 + 100, xbox.y + xbox.height / 2 - 60, { steps: 10 });
  await page10.mouse.up();
  await page10.keyboard.up('Shift');
  await page10.waitForFunction(
    (before) => document.getElementById('ro-wl')?.textContent !== before,
    wlBefore, { timeout: 30000 },
  );
  console.log(`WL drag moves readout: ${wlBefore} -> ${await page10.locator('#ro-wl').textContent()}`);
  const preset = await page10.locator('#dock-tune select[title="Preset"]').inputValue();
  if (preset !== 'custom') fail(`WL drag should flip preset to custom, got ${preset}`);
  else console.log('WL drag flips preset to custom');
  await page10.close();

  // ---- 23. Calibration: spacing override lands in volinfo + toast.
  const page11 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page11.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page11.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page11);
  await page11.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page11.fill('#cal-sx', '2.5');
  await page11.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => (t.textContent ?? '').includes('Spacing calibrated: 2.500')),
    null, { timeout: 30000 },
  );
  const volinfo = await page11.locator('#volinfo').textContent();
  if (!volinfo || !volinfo.includes('2.50')) fail(`volinfo missing calibrated spacing: ${volinfo}`);
  else console.log('calibrated spacing lands in volinfo');
  // Numeric but not a positive mm value: fill replaces (key chords race).
  await page11.fill('#cal-sx', '0');
  await page11.waitForFunction(
    () => (document.getElementById('status-text')?.textContent ?? '').includes('spacing rejected'),
    null, { timeout: 30000 },
  );
  console.log('non-positive spacing rejected loudly');
  await page11.close();

  // ---- 24. Reproducibility sidecar: JSON download pins the figure state.
  const page12 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page12.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page12.goto(`${BASE}#/report`, { waitUntil: 'networkidle' });
  await openDetails(page12);
  await page12.waitForFunction(
    () => /measurement\(s\)/.test(document.querySelector('#title-report p')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  const [sdl] = await Promise.all([
    page12.waitForEvent('download', { timeout: 30000 }),
    page12.click('#report-sidecar'),
  ]);
  const sname = sdl.suggestedFilename();
  if (!sname.startsWith('repro-') || !sname.endsWith('.json')) fail(`sidecar filename wrong: ${sname}`);
  else console.log(`sidecar downloads ${sname}`);
  const sidecar = JSON.parse(readFileSync(await sdl.path(), 'utf8'));
  const pinned = (cond, msg) => { if (!cond) fail(`sidecar field ${msg}: ${JSON.stringify(sidecar[msg])}`); };
  pinned(sidecar.format === 'carys-repro/1', 'format');
  pinned(typeof sidecar.series === 'string' && sidecar.series.length > 0, 'series');
  pinned(Array.isArray(sidecar.dims) && sidecar.dims.length === 3, 'dims');
  pinned(Number.isFinite(sidecar.wl?.width) && Number.isFinite(sidecar.wl?.center), 'wl');
  for (const p of ['axial', 'coronal', 'sagittal']) pinned(Number.isInteger(sidecar.slices?.[p]), 'slices');
  pinned(typeof sidecar.preset === 'string' && typeof sidecar.lut === 'string', 'preset');
  pinned(typeof sidecar.proj === 'string' && Number.isInteger(sidecar.slab), 'proj');
  pinned(typeof sidecar.src === 'string' && typeof sidecar.method === 'string', 'src');
  pinned(Number.isFinite(sidecar.threshold) && typeof sidecar.meshKey === 'string' && sidecar.meshKey.length > 0, 'meshKey');
  pinned(Number.isInteger(sidecar.maskVer) && sidecar.maskVer >= 0, 'maskVer');
  pinned(sidecar.digestPins && typeof sidecar.digestPins === 'object' && !Array.isArray(sidecar.digestPins), 'digestPins');
  pinned(Array.isArray(sidecar.measurements), 'measurements');
  console.log(`sidecar pins ${sidecar.series} · mask v${sidecar.maskVer} · ${sidecar.measurements.length} measurement(s)`);
  await page12.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => (t.textContent ?? '').includes('Sidecar saved')),
    null, { timeout: 30000 },
  );
  console.log('sidecar toast confirms the save');
  // X4 attribution: the HTML report carries the provenance + attribution
  // tables (pins render even when empty — the section never goes silent).
  const [hdl] = await Promise.all([
    page12.waitForEvent('download', { timeout: 30000 }),
    page12.click('#report-download'),
  ]);
  const hpath = await hdl.path();
  const htext = readFileSync(hpath, 'utf8');
  for (const needle of ['Provenance', 'Attribution', 'bodyparts3d-longbones', 'CC-BY-4.0', 'idr-screens', 'openanatomy-brain']) {
    if (!htext.includes(needle)) fail(`report HTML missing ${needle}`);
  }
  console.log('report HTML carries provenance + attribution tables');
  // F2 teaching sheet: downloads standalone printable HTML with quiz
  // checkboxes and no embedded answers.
  const [shdl] = await Promise.all([
    page12.waitForEvent('download', { timeout: 30000 }),
    page12.click('#report-sheet'),
  ]);
  const shname = shdl.suggestedFilename();
  if (!shname.startsWith('sheet-') || !shname.endsWith('.html')) fail(`sheet filename wrong: ${shname}`);
  const shtext = readFileSync(await shdl.path(), 'utf8');
  // The quiz is built from the session's measurements; this page opened
  // straight on the report, so it has none and the sheet has no boxes.
  const sheetNeedles = ['Teaching sheet', 'education overlay', ...(sidecar.measurements.length > 0 ? ['☐'] : [])];
  for (const needle of sheetNeedles) {
    if (!shtext.includes(needle)) fail(`sheet HTML missing ${needle}`);
  }
  if (shtext.includes('Correct.')) fail('sheet HTML leaks answers');
  else console.log(`teaching sheet downloads ${shname} with quiz + no answers`);
  await page12.close();

  // ---- 25. Oblique measure: tilted axial taps measure through the paint frame.
  const page13 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page13.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page13.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page13);
  await page13.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page13.click('#modeseg button[data-mode="measure"]');
  await page13.click('#kindseg button[data-kind="length"]');
  const obox = await page13.locator('#c-axial').boundingBox();
  // mid-stroke tilt restarts the stroke: tap once, tilt, tap again → no value yet
  await page13.mouse.click(obox.x + obox.width / 2 - 60, obox.y + obox.height / 2);
  await page13.locator('input[aria-label="Obl A"]').focus();
  await page13.keyboard.press('ArrowRight');
  await page13.keyboard.press('ArrowRight');
  await page13.waitForFunction(
    () => document.getElementById('ro-axial')?.textContent?.includes('obl'),
    null, { timeout: 60000 },
  );
  await page13.mouse.click(obox.x + obox.width / 2 + 60, obox.y + obox.height / 2);
  const early = await page13.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => /length: [\d.]+ mm/.test(t.textContent ?? '')),
    null, { timeout: 5000 },
  ).then(() => true).catch(() => false);
  if (early) fail('mid-stroke tilt should restart the pending stroke, but a length toasted');
  else console.log('mid-stroke tilt restarts the pending stroke');
  // complete the stroke on the tilted frame: the value lands with the oblique flag
  await page13.mouse.click(obox.x + obox.width / 2 + 60, obox.y + obox.height / 2);
  await page13.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => /length: [\d.]+ mm · oblique/.test(t.textContent ?? '')),
    null, { timeout: 30000 },
  );
  console.log('oblique length toast:', await page13.locator('#toasts .toast').first().textContent());
  const oblInfo = await page13.locator('#measureinfo').textContent();
  if (!oblInfo || !/Length[\s\S]*mm/.test(oblInfo)) fail(`oblique length missing from measure panel: ${oblInfo}`);
  else console.log('oblique length lands in the measure panel');
  await page13.close();

  // ---- 26. Dual-volume compare: fused overlay tags the axial pane.
  const page14 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page14.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page14.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page14);
  await page14.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page14.locator('#dock-tune select[aria-label="Compare overlay series"]').selectOption('covid-chest-seg');
  await page14.waitForFunction(
    () => (document.getElementById('ro-axial')?.textContent ?? '').includes('checker'),
    null, { timeout: 90000 },
  );
  console.log('compare checker tags axial:', await page14.locator('#ro-axial').textContent());
  await page14.click('#cmpseg button[data-cmp="subtract"]');
  await page14.waitForFunction(
    () => (document.getElementById('ro-axial')?.textContent ?? '').includes('Δ'),
    null, { timeout: 60000 },
  );
  console.log('compare subtract tags axial:', await page14.locator('#ro-axial').textContent());
  await page14.close();

  // ---- 27. Multi-label: seg op splits islands into a segments table.
  const page15 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page15.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page15.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page15);
  await page15.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page15.click('#dock-seg button[title="Split mask into per-component label values"]');
  await page15.waitForFunction(
    () => document.getElementById('seginfo')?.textContent?.includes('vox'),
    null, { timeout: 60000 },
  );
  console.log('segments table:', await page15.locator('#seginfo').textContent());
  await page15.close();

  // ---- 28. VCF upload lands annotated variants in the tracks table.
  const vcfPath = join(dir, 'wire.vcf');
  writeFileSync(vcfPath, [
    '##fileformat=VCFv4.2',
    '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tsample',
    'chr1\t100\t.\tA\tG\t.\t.\tDP=30\tGT:AD\t0/1:20,10',
    'chr1\t300\t.\tC\tT\t.\t.\t.\tGT\t0/1',
  ].join('\n'));
  const page16 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page16.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page16.goto(`${BASE}#/tracks`, { waitUntil: 'networkidle' });
  await openDetails(page16);
  await page16.waitForSelector('#title-tracks', { timeout: 90000 });
  await page16.setInputFiles('#track-upload', vcfPath);
  await page16.waitForFunction(
    () => (document.getElementById('ro-tracks')?.textContent ?? '').includes('2 features'),
    null, { timeout: 30000 },
  );
  const vcfRows = await page16.locator('#track-list .mrow').count();
  if (vcfRows !== 2) fail(`vcf rows expected 2, got ${vcfRows}`);
  const vcfText = await page16.locator('#track-list').textContent();
  if (!vcfText || !vcfText.includes('A>G') || !vcfText.includes('DP30') || !vcfText.includes('DP?')) {
    fail(`vcf depth labels missing: ${vcfText}`);
  } else console.log('vcf variants land with depth labels');

  // ---- 28b. Variant → residue: codon map chips link into the protein view.
  // Hand-rolled map: chr1:100 → chain A resSeq 1 (1CRN crambin chain A
  // opens at resSeq 1, so the jump lands on a real residue: THR1).
  // Without the map first: the jump refuses loudly on the visible status.
  const cmapPath = join(dir, 'wire-codon.json');
  writeFileSync(cmapPath, JSON.stringify({
    entries: [{ chrom: 'chr1', start: 100, end: 100, chain: 'A', resStart: 1, strand: 1 }],
  }));
  await page16.setInputFiles('#codon-upload', cmapPath);
  await page16.waitForFunction(
    () => (document.getElementById('ro-codonmap')?.textContent ?? '').includes('1 intervals'),
    null, { timeout: 30000 },
  );
  console.log('codon map loads:', await page16.locator('#ro-codonmap').textContent());
  await page16.waitForSelector('#track-list button[data-res="A:1"]', { timeout: 30000 });
  console.log('variant row carries the residue chip');
  await Promise.all([
    page16.waitForURL('**#/protein', { timeout: 30000 }),
    page16.click('#track-list button[data-res="A:1"]'),
  ]);
  await page16.waitForSelector('#seqstrip button[data-res]', { timeout: 90000 });
  await page16.waitForFunction(
    () => (document.getElementById('ro-sel')?.textContent ?? '').includes('1 selected'),
    null, { timeout: 60000 },
  );
  console.log('variant jump selects the residue:', await page16.locator('#ro-sel').textContent());
  await page16.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => /→ THR1/.test(t.textContent ?? '')),
    null, { timeout: 30000 },
  );
  console.log('variant toast names the landed residue');
  await page16.close();

  // ---- 28c. G1 GTF CDS translation: upload a GTF, CDS rows become a
  // transcript picker; the active transcript's codons drive the residue
  // chips (transcript-ordinal). Synthetic GTF (no patient data):
  // transcript T has one 9bp CDS (3 codons, chain T), so chr1:100
  // opens codon 1 → chip T:1. The jump hands off to #/protein, where the
  // consumer announces the miss loudly (chain T exists in no open model —
  // transcript-ordinal ≠ author seqId unless the structure covers the CDS
  // from its start; leg 28b already pins the resolved happy path).
  const gtfPath = join(dir, 'wire.gtf');
  writeFileSync(gtfPath, [
    'chr1\tsrc\tCDS\t100\t108\t.\t+\t0\tgene_id "G"; transcript_id "T";',
    'chr1\tsrc\texon\t100\t108\t.\t+\t.\tgene_id "G"; transcript_id "T";',
  ].join('\n'));
  const page16b = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page16b.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page16b.goto(`${BASE}#/tracks`, { waitUntil: 'networkidle' });
  await page16b.waitForSelector('#title-tracks', { timeout: 90000 });
  await page16b.setInputFiles('#track-upload', vcfPath);
  await page16b.waitForFunction(
    () => (document.getElementById('ro-tracks')?.textContent ?? '').includes('2 features'),
    null, { timeout: 30000 },
  );
  await page16b.setInputFiles('#gtf-upload', gtfPath);
  await page16b.waitForFunction(
    () => (document.getElementById('ro-codonmap')?.textContent ?? '').includes('transcript-ordinal'),
    null, { timeout: 30000 },
  );
  console.log('gtf translates:', await page16b.locator('#ro-codonmap').textContent());
  // A native <option> is never "visible" to Playwright: wait for it to exist.
  await page16b.waitForSelector('#dock-tracks select[aria-label="Transcript"] option[value="T"]', { state: 'attached', timeout: 30000 });
  console.log('transcript picker lists T');
  await page16b.waitForSelector('#track-list button[data-res="T:1"]', { timeout: 30000 });
  console.log('translated codons drive the residue chip');
  await Promise.all([
    page16b.waitForURL('**#/protein', { timeout: 30000 }),
    page16b.click('#track-list button[data-res="T:1"]'),
  ]);
  await page16b.waitForFunction(
    () => (document.getElementById('status-text')?.textContent ?? '').includes('T:1'),
    null, { timeout: 30000 },
  );
  console.log('transcript-ordinal miss lands loud:', await page16b.locator('#status-text').textContent());
  await page16b.close();

  // ---- 29. TID1500 export downloads the template-shaped report.
  const page17 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page17.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page17.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page17);
  await page17.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page17.click('#modeseg button[data-mode="measure"]');
  await page17.click('#kindseg button[data-kind="length"]');
  const tbox = await page17.locator('#c-axial').boundingBox();
  await page17.mouse.click(tbox.x + tbox.width / 2 - 40, tbox.y + tbox.height / 2);
  await page17.mouse.click(tbox.x + tbox.width / 2 + 40, tbox.y + tbox.height / 2);
  await page17.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => /length: [\d.]+ mm/.test(t.textContent ?? '')),
    null, { timeout: 30000 },
  );
  const [tdl] = await Promise.all([
    page17.waitForEvent('download', { timeout: 30000 }),
    page17.click('#meas-tid1500'),
  ]);
  const tname = tdl.suggestedFilename();
  if (!tname.endsWith('-tid1500.json')) fail(`tid1500 filename wrong: ${tname}`);
  const tid = JSON.parse(readFileSync(await tdl.path(), 'utf8'));
  if (tid.SOPClassUID !== '1.2.840.10008.5.1.4.1.1.88.11') fail('tid1500 SOP class wrong');
  else if (!JSON.stringify(tid).includes('Measurement Group')) fail('tid1500 groups missing');
  else console.log(`tid1500 downloads ${tname} with measurement groups`);
  // ---- 29b. I2 TID1500 import: re-upload the export, rows return tagged
  // SR import and the table grows (round-trip proof with our own shape).
  const tpath = await tdl.path();
  await page17.setInputFiles('input#tid1500-upload', tpath);
  await page17.waitForFunction(
    () => [...document.querySelectorAll('#measureinfo .mrow dt')].some((d) => (d.textContent ?? '').includes('SR import')),
    null, { timeout: 30000 },
  );
  console.log('tid1500 import returns tagged rows');
  await page17.close();

  // ---- 30. Pockets + RMSD: protein dock finds clefts on the demo model.
  const page18 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page18.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page18.goto(`${BASE}#/protein`, { waitUntil: 'networkidle' });
  await openDetails(page18);
  await page18.waitForSelector('#seqstrip button[data-res]', { timeout: 90000 });
  await page18.click('#dock-protein button[title^="Find ligand pockets"]');
  await page18.waitForFunction(
    () => (document.getElementById('ro-pocket')?.textContent ?? '').includes('pocket'),
    null, { timeout: 60000 },
  );
  console.log('pockets:', await page18.locator('#ro-pocket').textContent());

  // ---- 30b. Map fit stub: synthetic density at the map center docks the
  // demo model by centroid translation. Hand-rolled NIfTI-1 (LE, uint8,
  // 48³, vox 1mm): 348B header + 4B ext gap (vox_offset 352) + voxels.
  // The blob (r=20 at 24³) recenters the model centroid onto itself — the
  // dock IS the feature — and the wire asserts the docked translation is
  // real (status names it) plus the scored fraction. 1CRN's CA spread is
  // 15.3Å, so r=20 covers every CA: inclusion must read 100%.
  const MN = 48, MC = 24, MR = 20;
  const niiMap = Buffer.alloc(352 + MN * MN * MN);
  niiMap.writeInt32LE(348, 0);
  niiMap.writeInt16LE(3, 40);
  niiMap.writeInt16LE(MN, 42); niiMap.writeInt16LE(MN, 44); niiMap.writeInt16LE(MN, 46);
  niiMap.writeInt16LE(2, 70); niiMap.writeInt16LE(8, 72);
  niiMap.writeFloatLE(1, 80); niiMap.writeFloatLE(1, 84); niiMap.writeFloatLE(1, 88);
  niiMap.writeFloatLE(352, 108);
  niiMap.writeFloatLE(1, 112);
  niiMap[344] = 0x6e; niiMap[345] = 0x2b; niiMap[346] = 0x31;
  for (let z = 0; z < MN; z++) {
    for (let y = 0; y < MN; y++) {
      for (let x = 0; x < MN; x++) {
        const d = Math.hypot(x - MC, y - MC, z - MC);
        if (d <= MR) niiMap[352 + z * MN * MN + y * MN + x] = 100;
      }
    }
  }
  const mapPath = join(dir, 'wire-map.nii');
  writeFileSync(mapPath, niiMap);
  await page18.setInputFiles('#map-upload', mapPath);
  await page18.waitForFunction(
    () => (document.getElementById('ro-mapfit')?.textContent ?? '').includes('in density'),
    null, { timeout: 60000 },
  );
  console.log('map fit scores:', await page18.locator('#ro-mapfit').textContent());
  const mapChip = await page18.locator('#ro-mapfit').textContent();
  if (!/\(100%\)/.test(mapChip ?? '')) fail(`centered blob should include every CA, got: ${mapChip}`);
  else console.log('centered blob includes every demo CA');
  await page18.close();

  // ---- 30c. M1 pathogen digest: 6M0J spike–ACE2 opens with chain roles,
  // interface contacts select, variant sites highlight. All persistent
  // signals (term row, contact count, toast) — no canvas pixels asserted.
  const page18c = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page18c.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page18c.goto(`${BASE}#/protein`, { waitUntil: 'networkidle' });
  await page18c.waitForSelector('#seqstrip button[data-res]', { timeout: 90000 });
  await page18c.selectOption('#dock-protein select[aria-label="Pathogen structure"]', 'spike-ace2');
  await page18c.waitForFunction(
    () => /6M0J/.test(document.getElementById('ro-pathogen')?.textContent ?? ''),
    null, { timeout: 60000 },
  );
  const pcaption = await page18c.locator('#ro-pathogen').textContent();
  if (!pcaption.includes('spike RBD') || !pcaption.includes('education overlay')) {
    fail(`pathogen caption wrong: ${pcaption}`);
  } else console.log(`pathogen caption ${pcaption}`);
  await page18c.click('#dock-protein button[title^="Select the precomputed interface contacts"]');
  await page18c.waitForFunction(
    () => /15 selected/.test(document.getElementById('ro-sel')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('pathogen contacts:', await page18c.locator('#ro-sel').textContent());
  await page18c.click('#dock-protein button[title^="Highlight variant-note positions"]');
  await page18c.waitForFunction(
    () => /9 selected/.test(document.getElementById('ro-sel')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('pathogen variants:', await page18c.locator('#ro-sel').textContent());
  // capsid entry: 4 contacts, no variant sites (loud, never silent)
  await page18c.selectOption('#dock-protein select[aria-label="Pathogen structure"]', 'hbv-capsid');
  await page18c.waitForFunction(
    () => /1QGT/.test(document.getElementById('ro-pathogen')?.textContent ?? ''),
    null, { timeout: 60000 },
  );
  await page18c.click('#dock-protein button[title^="Select the precomputed interface contacts"]');
  await page18c.waitForFunction(
    () => /4 selected/.test(document.getElementById('ro-sel')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('capsid contacts:', await page18c.locator('#ro-sel').textContent());
  await page18c.click('#dock-protein button[title^="Highlight variant-note positions"]');
  await page18c.waitForFunction(
    () => (document.getElementById('status-text')?.textContent ?? '').includes('no variant-note sites'),
    null, { timeout: 30000 },
  );
  console.log('capsid variant-notes correctly loud');
  // M4 celiac tripartite: 4OZF opens with 5-chain roles, 25 contacts select
  await page18c.selectOption('#dock-protein select[aria-label="Pathogen structure"]', 'celiac-tcr');
  await page18c.waitForFunction(
    () => /4OZF/.test(document.getElementById('ro-pathogen')?.textContent ?? ''),
    null, { timeout: 60000 },
  );
  const celiacCap = await page18c.locator('#ro-pathogen').textContent();
  if (!celiacCap.includes('gliadin') && !celiacCap.includes('JR5.1')) {
    fail(`celiac caption wrong: ${celiacCap}`);
  } else console.log(`celiac caption ${celiacCap.slice(0, 110)}`);
  await page18c.click('#dock-protein button[title^="Select the precomputed interface contacts"]');
  await page18c.waitForFunction(
    () => /25 selected/.test(document.getElementById('ro-sel')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('celiac contacts:', await page18c.locator('#ro-sel').textContent());
  // M4 allergen: 1BV1 single chain, 3 landmarks, no variant sites
  await page18c.selectOption('#dock-protein select[aria-label="Pathogen structure"]', 'birch-allergen');
  await page18c.waitForFunction(
    () => /1BV1/.test(document.getElementById('ro-pathogen')?.textContent ?? ''),
    null, { timeout: 60000 },
  );
  await page18c.click('#dock-protein button[title^="Select the precomputed interface contacts"]');
  await page18c.waitForFunction(
    () => /3 selected/.test(document.getElementById('ro-sel')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('allergen landmarks:', await page18c.locator('#ro-sel').textContent());
  await page18c.close();

  // ---- 31. Double-oblique: tilt plane switch moves the obl tag panes.
  const page19 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page19.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page19.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page19);
  await page19.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page19.click('#oblplaneseg button[data-oblplane="coronal"]');
  await page19.locator('input[aria-label="Obl A"]').focus();
  await page19.keyboard.press('ArrowRight');
  await page19.keyboard.press('ArrowRight');
  await page19.waitForFunction(
    () => (document.getElementById('ro-coronal')?.textContent ?? '').includes('obl'),
    null, { timeout: 60000 },
  );
  console.log('coronal tilt tags coronal:', await page19.locator('#ro-coronal').textContent());
  const axTag = await page19.locator('#ro-axial').textContent();
  if (axTag.includes('obl')) fail(`axial should stay orthogonal, got: ${axTag}`);
  else console.log('axial stays orthogonal under coronal tilt');

  // ---- 32. Oblique paint: tilted strokes land voxels + undo restores.
  await page19.click('#modeseg button[data-mode="paint"]');
  const pbox = await page19.locator('#c-coronal').boundingBox();
  await page19.mouse.move(pbox.x + pbox.width / 2 - 20, pbox.y + pbox.height / 2);
  await page19.mouse.down();
  await page19.mouse.move(pbox.x + pbox.width / 2 + 20, pbox.y + pbox.height / 2, { steps: 5 });
  await page19.mouse.up();
  await page19.waitForFunction(
    () => (document.getElementById('mask-big')?.textContent ?? '').replace(/[^0-9]/g, '').length > 0,
    null, { timeout: 30000 },
  );
  console.log('oblique stroke paints:', await page19.locator('#mask-big').textContent());

  // ---- 33. Presentation save/load: read state round-trips onto the series.
  // Measure first so the file carries an annotation, then zoom one pane so
  // the restore has a transform to assert (zoom chips are persistent state).
  await page19.click('#modeseg button[data-mode="measure"]');
  await page19.click('#kindseg button[data-kind="length"]');
  const mbox = await page19.locator('#c-coronal').boundingBox();
  await page19.mouse.click(mbox.x + mbox.width / 2 - 40, mbox.y + mbox.height / 2);
  await page19.mouse.click(mbox.x + mbox.width / 2 + 40, mbox.y + mbox.height / 2);
  await page19.waitForFunction(
    () => [...document.querySelectorAll('#toasts .toast')].some((t) => /length: [\d.]+ mm/.test(t.textContent ?? '')),
    null, { timeout: 30000 },
  );
  await page19.click('#vp-2d .pane-head .vptools button[title^="Zoom in Coronal"]');
  const zoomBefore = await page19.locator('[data-zoom="coronal"]').textContent();
  if (zoomBefore !== '125%') fail(`coronal zoom step expected 125%, got ${zoomBefore}`);
  const [pdl] = await Promise.all([
    page19.waitForEvent('download', { timeout: 30000 }),
    page19.click('#dock-present button[title^="Save presentation"]'),
  ]);
  const pname = pdl.suggestedFilename();
  if (!pname.startsWith('present-') || !pname.endsWith('.json')) fail(`presentation filename wrong: ${pname}`);
  const present = JSON.parse(readFileSync(await pdl.path(), 'utf8'));
  const pinned33 = (cond, msg) => { if (!cond) fail(`present field ${msg}: ${(JSON.stringify(present[msg]) ?? '').slice(0, 120)}`); };
  pinned33(present.format === 'carys-present/1', 'format');
  pinned33(present.gspsSOPClass === '1.2.840.10008.5.1.4.1.1.11.1', 'gspsSOPClass');
  pinned33(Number.isFinite(present.wl?.width) && Number.isFinite(present.wl?.center), 'wl');
  for (const p of ['axial', 'coronal', 'sagittal']) pinned33(Number.isInteger(present.slices?.[p]), 'slices');
  for (const p of ['axial', 'coronal', 'sagittal']) {
    pinned33(Number.isFinite(present.view?.[p]?.zoom) && Number.isFinite(present.view?.[p]?.x), 'view');
  }
  pinned33(Array.isArray(present.annotations) && present.annotations.length >= 1, 'annotations');
  console.log(`presentation saves ${pname} · zoom ${present.view.coronal.zoom} · ${present.annotations.length} annotation(s)`);
  // Reset the pane transform, then load the file back: zoom chip + WL chip
  // must return to the saved values (persistent signals, not transients).
  await page19.locator('[data-zoom="coronal"]').click();
  const [upl] = await Promise.all([
    (async () => {
      // uploads reuse the real file input: no synthetic change dispatches
      await page19.setInputFiles('#present-upload', await pdl.path());
    })(),
    page19.waitForFunction(
      () => [...document.querySelectorAll('#toasts .toast')].some((t) => (t.textContent ?? '').includes('Presentation loaded')),
      null, { timeout: 30000 },
    ),
  ]);
  void upl;
  const zoomAfter = await page19.locator('[data-zoom="coronal"]').textContent();
  if (zoomAfter !== zoomBefore) fail(`presentation restore zoom ${zoomAfter} != saved ${zoomBefore}`);
  else console.log(`presentation restores coronal zoom ${zoomAfter}`);
  const roWl = await page19.locator('#ro-wl').textContent();
  if (!roWl.includes(`W ${Math.round(present.wl.width)}`)) fail(`presentation restore WL ${roWl} != saved W ${present.wl.width}`);
  else console.log(`presentation restores WL ${roWl}`);
  // Wrong-series file is a loud reject on the visible status, never silent.
  const wrongPath = join(dir, 'wire-present-wrong.json');
  // A file really saved on another series: its annotations name that series
  // too (a file whose two disagree is rejected earlier, as malformed).
  const otherSeries = 'not-this-series';
  writeFileSync(wrongPath, JSON.stringify({
    ...present, series: otherSeries, annotations: present.annotations.map((a) => ({ ...a, series: otherSeries })),
  }));
  await page19.setInputFiles('#present-upload', wrongPath);
  await page19.waitForFunction(
    () => (document.getElementById('status-text')?.textContent ?? '').includes('open the matching series'),
    null, { timeout: 30000 },
  );
  console.log('wrong-series presentation rejected loudly');
  await page19.close();

  // ---- 34. Atlas overlay: BodyParts3D femur renders with FMA term + pin.
  // Provenance UI before pixels: the quarantine badge, BP id, FMA term,
  // attribution footer, and digestPins all assert on persistent signals.
  const page20 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page20.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page20.goto(`${BASE}#/atlas`, { waitUntil: 'networkidle' });
  await openDetails(page20);
  await page20.waitForFunction(
    () => /femur/i.test(document.getElementById('ro-atlas-term')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  const atlasTerm = await page20.locator('#ro-atlas-term').textContent();
  if (!atlasTerm.includes('right femur') || !atlasTerm.includes('BP10053') || !atlasTerm.includes('FMA24474')) {
    fail(`atlas term row wrong: ${atlasTerm}`);
  } else console.log(`atlas term pins ${atlasTerm}`);
  const atlasSrc = await page20.locator('#atlas-src').textContent();
  if (!atlasSrc.includes('BodyParts3D') || !atlasSrc.includes('CC Attribution 4.0')) {
    fail(`atlas attribution missing: ${atlasSrc}`);
  } else console.log('atlas attribution footer present');
  const atlasTitle = await page20.locator('#title-atlas p').textContent();
  if (!atlasTitle.includes('education overlay')) fail(`atlas quarantine badge missing: ${atlasTitle}`);
  else console.log('atlas quarantine badge present');
  // switch bone: scapula lands its own term + BP id + tri count
  await page20.selectOption('#dock-atlas select[aria-label="Atlas structure"]', 'scapula-l');
  await page20.waitForFunction(
    () => /scapula/i.test(document.getElementById('ro-atlas-term')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  const scapTerm = await page20.locator('#ro-atlas-term').textContent();
  if (!scapTerm.includes('left scapula') || !scapTerm.includes('BP10159')) fail(`scapula switch wrong: ${scapTerm}`);
  else console.log(`atlas switches to ${scapTerm}`);
  const scapTris = await page20.locator('#ro-atlas').textContent();
  if (!scapTris.includes('tris') || !scapTris.includes('BP10159')) fail(`scapula tri row wrong: ${scapTris}`);
  else console.log(`atlas tri row ${scapTris}`);
  // K1 search: 'stern' finds sternum-area terms; Enter jumps nowhere new
  // (sternum is in the 20) — assert the hit chip + term row agree instead.
  await page20.fill('#atlas-search', 'tibia');
  await page20.click('#dock-atlas button[title="Search anatomy terms"]');
  await page20.waitForFunction(
    () => /hit\(s\)/.test(document.getElementById('ro-atlas-hits')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  const hits = await page20.locator('#ro-atlas-hits').textContent();
  if (!hits.includes('hit(s)') || !/tibia/i.test(hits)) fail(`atlas search hits wrong: ${hits}`);
  else console.log(`atlas search ${hits}`);
  // Enter-in-input repeats the jump (already on tibia: term row agrees)
  await page20.fill('#atlas-search', 'tibia');
  await page20.locator('#atlas-search').press('Enter');
  await page20.waitForFunction(
    () => /tibia/i.test(document.getElementById('ro-atlas-term')?.textContent ?? '')
      && /hit\(s\)/.test(document.getElementById('ro-atlas-hits')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  const tibiaTerm = await page20.locator('#ro-atlas-term').textContent();
  if (!tibiaTerm.includes('FMA24477') && !tibiaTerm.includes('FMA24478')) fail(`tibia jump wrong: ${tibiaTerm}`);
  else console.log(`atlas search jumps to ${tibiaTerm}`);
  // blank search never dumps the table: no hits chip, loud status instead
  await page20.fill('#atlas-search', '   ');
  await page20.click('#dock-atlas button[title="Search anatomy terms"]');
  await page20.waitForFunction(
    () => (document.getElementById('status-text')?.textContent ?? '').includes('no anatomy terms match'),
    null, { timeout: 30000 },
  );
  console.log('atlas blank search stays loud, never dumps');
  // A2 systems: skull compound renders with term + BP id; rib search
  // walks IS-A children (status names the child structures).
  await page20.selectOption('#dock-atlas select[aria-label="Atlas structure"]', 'skull');
  await page20.waitForFunction(
    () => /skull/i.test(document.getElementById('ro-atlas-term')?.textContent ?? ''),
    null, { timeout: 60000 },
  );
  const skullTerm = await page20.locator('#ro-atlas-term').textContent();
  if (!skullTerm.includes('skull') || !skullTerm.includes('BP9486') || !skullTerm.includes('FMA46565')) {
    fail(`skull term row wrong: ${skullTerm}`);
  } else console.log(`atlas skull pins ${skullTerm}`);
  const skullTris = await page20.locator('#ro-atlas').textContent();
  if (!skullTris.includes('tris') || !skullTris.includes('BP9486')) fail(`skull tri row wrong: ${skullTris}`);
  else console.log(`atlas skull tri row ${skullTris}`);
  // rib search: top hit (FMA20224 right side) has no single mesh —
  // status names the neighbourhood instead of failing silent
  await page20.fill('#atlas-search', 'rib cage');
  await page20.click('#dock-atlas button[title="Search anatomy terms"]');
  await page20.waitForFunction(
    () => (document.getElementById('status-text')?.textContent ?? '').includes('no single mesh'),
    null, { timeout: 30000 },
  );
  const ribWalk = await page20.locator('#status-text').textContent();
  if (!ribWalk.includes('FMA20224')) fail(`rib neighbourhood missing: ${ribWalk}`);
  else console.log(`atlas rib walk ${ribWalk.slice(0, 140)}`);
  // K2 glossary: tap the term chip -> card opens with parent/children/source;
  // re-tap closes (rule 23: Esc/✕/re-tap exits). The card is the open
  // structure's, and the skull steps above moved off the scapula.
  await page20.selectOption('#dock-atlas select[aria-label="Atlas structure"]', 'scapula-l');
  await page20.waitForFunction(
    () => /left scapula/i.test(document.getElementById('ro-atlas-term')?.textContent ?? ''),
    null, { timeout: 60000 },
  );
  await page20.click('#ro-atlas-term');
  await page20.waitForSelector('#gloss', { timeout: 30000 });
  const glossParent = await page20.locator('#gloss-parent').textContent();
  if (!glossParent.includes('scapula (FMA13394)')) {
    fail(`glossary parent wrong: ${glossParent}`);
  } else console.log(`glossary parent ${glossParent}`);
  const glossSrc = await page20.locator('#gloss-src').textContent();
  if (!glossSrc.includes('CC-BY-4.0') || !glossSrc.includes('BP3D-4.0')) {
    fail(`glossary source wrong: ${glossSrc}`);
  } else console.log(`glossary source ${glossSrc}`);
  const glossMesh = await page20.locator('#gloss-meshes').textContent();
  if (!glossMesh.includes('FJ')) fail(`glossary meshes wrong: ${glossMesh}`);
  else console.log(`glossary meshes ${glossMesh.slice(0, 80)}`);
  await page20.click('#ro-atlas-term');
  await page20.waitForFunction(
    () => document.getElementById('gloss') === null,
    null, { timeout: 30000 },
  );
  console.log('glossary re-tap closes the card');
  // search 'skull' lands the local compound (term row agrees, FMA46565)
  await page20.fill('#atlas-search', 'skull');
  await page20.click('#dock-atlas button[title="Search anatomy terms"]');
  await page20.waitForFunction(
    () => /skull/i.test(document.getElementById('ro-atlas-term')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('atlas search lands skull:', await page20.locator('#ro-atlas-term').textContent());
  // sacrum: shared file with pelvis renders on its own
  await page20.selectOption('#dock-atlas select[aria-label="Atlas structure"]', 'sacrum');
  await page20.waitForFunction(
    () => /sacrum/i.test(document.getElementById('ro-atlas-term')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('atlas sacrum renders:', await page20.locator('#ro-atlas-term').textContent());
  // A3 brain regions: SPL label search names the RadLex-backed hit; the
  // skeleton mesh view is untouched (brain geometry lives remote).
  await page20.fill('#atlas-brain-search', 'putamen');
  await page20.click('#dock-atlas button[title="Search brain labels"]');
  await page20.waitForFunction(
    () => /putamen/i.test(document.getElementById('ro-brain-hits')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('brain search hits:', await page20.locator('#ro-brain-hits').textContent());
  await page20.waitForFunction(
    () => /RID2101|label 1[12]/.test(document.getElementById('status-text')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('brain status names RadLex:', await page20.locator('#status-text').textContent());
  const brainSrc = await page20.locator('#atlas-brain-src').textContent();
  if (!brainSrc.includes('Surgical Planning Laboratory')) fail(`brain attribution wrong: ${brainSrc}`);
  else console.log('brain attribution pins SPL');
  // RadLex-id search lands the same row (left putamen, RID21015)
  await page20.fill('#atlas-brain-search', 'RID21015');
  await page20.click('#dock-atlas button[title="Search brain labels"]');
  await page20.waitForFunction(
    () => /left putamen/.test(document.getElementById('ro-brain-hits')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('RadLex search lands:', await page20.locator('#ro-brain-hits').textContent());
  await page20.close();

  // ---- 35. E2 learn bundles: story + pathway + quiz with audit.
  // Bundle picker lands the story, Open structure deep-links the protein
  // view onto the right pathogen entry, quiz answers score + log.
  const page21 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page21.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page21.goto(`${BASE}#/learn`, { waitUntil: 'networkidle' });
  await openDetails(page21);
  await page21.waitForFunction(
    () => /spike/i.test(document.getElementById('learn-pathway')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  const story = await page21.locator('#pane-learn-story p.hint').textContent();
  if (!story.includes('6M0J') || !story.includes('chain E')) fail(`bundle story wrong: ${story}`);
  else console.log('bundle story pins 6M0J chain E');
  const src = await page21.locator('#learn-src').textContent();
  if (!src.includes('rcsb-pathogens') || !src.includes('CC0')) fail(`provenance card wrong: ${src}`);
  else console.log(`provenance card ${src}`);
  // answer q2 correctly (15 contacts): score chip + rationale reveal
  await page21.click('#learn-quiz button[data-quiz="ace2-entry-q2"][data-opt="1"]');
  await page21.waitForFunction(
    () => /1\/3 correct/.test(document.getElementById('ro-learn-score')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('quiz scores:', await page21.locator('#ro-learn-score').textContent());
  await page21.waitForFunction(
    () => (document.querySelector('[data-why="ace2-entry-q2"]')?.textContent ?? '').includes('15 contacts'),
    null, { timeout: 30000 },
  );
  console.log('rationale reveals the 15-contact fact');
  // wrong answer on q1: score stays, rationale still teaches
  await page21.click('#learn-quiz button[data-quiz="ace2-entry-q1"][data-opt="0"]');
  await page21.waitForFunction(
    () => /1\/3 correct/.test(document.getElementById('ro-learn-score')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  const why = await page21.locator('[data-why="ace2-entry-q1"]').textContent();
  if (!why.includes('Not quite') || !why.includes('Chain E')) fail(`wrong-answer rationale wrong: ${why}`);
  else console.log('wrong answer still teaches');
  // bundle switch resets the score; capsid bundle carries 3 questions
  await page21.locator('#dock-learn select[aria-label="Disease bundle"]').selectOption('capsid-assembly');
  await page21.waitForFunction(
    () => /HBcAg/.test(document.getElementById('learn-pathway')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  const reset = await page21.locator('#ro-learn-score').textContent();
  if (!reset.includes('3 questions')) fail(`bundle switch score wrong: ${reset}`);
  else console.log('bundle switch resets quiz');
  // Open structure deep-links the protein view onto 1QGT
  await Promise.all([
    page21.waitForURL('**#/protein', { timeout: 30000 }),
    page21.click('#dock-learn button[title^="Open the hbv-capsid structure"]'),
  ]);
  await page21.waitForFunction(
    () => /1QGT/.test(document.getElementById('ro-pathogen')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  console.log('bundle deep-links protein view:', await page21.locator('#ro-pathogen').textContent());
  await page21.goto(`${BASE}#/learn`, { waitUntil: 'networkidle' });
  await openDetails(page21);
  // M2 organoid bundle: story pairs 6M0J with the idr0083 screen, quiz
  // scores the single-channel fact (options stay byte-pinned)
  await page21.locator('#dock-learn select[aria-label="Disease bundle"]').selectOption('organoid-context');
  await page21.waitForFunction(
    () => /organoid|hSIOs/.test(document.getElementById('learn-pathway')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  await page21.click('#learn-quiz button[data-quiz="organoid-context-q2"][data-opt="1"]');
  await page21.waitForFunction(
    () => /1\/3 correct/.test(document.getElementById('ro-learn-score')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('organoid quiz scores:', await page21.locator('#ro-learn-score').textContent());
  const oprov = await page21.locator('#learn-src').textContent();
  if (!oprov.includes('idr-screens') || !oprov.includes('CC-BY-4.0')) fail(`organoid provenance wrong: ${oprov}`);
  else console.log(`organoid provenance ${oprov}`);
  await page21.goto(`${BASE}#/learn`, { waitUntil: 'networkidle' });
  await openDetails(page21);
  // M4 celiac bundle: story pins 4OZF chains, quiz scores the 13-contact fact
  await page21.locator('#dock-learn select[aria-label="Disease bundle"]').selectOption('celiac-tcr');
  await page21.waitForFunction(
    () => /gliadin|HLA-DQ8/.test(document.getElementById('learn-pathway')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  await page21.click('#learn-quiz button[data-quiz="celiac-tcr-q2"][data-opt="1"]');
  await page21.waitForFunction(
    () => /1\/3 correct/.test(document.getElementById('ro-learn-score')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('celiac quiz scores:', await page21.locator('#ro-learn-score').textContent());
  // M4 deep-link: Open structure lands 4OZF in the protein view
  await Promise.all([
    page21.waitForURL('**#/protein', { timeout: 30000 }),
    page21.click('#dock-learn button[title^="Open the celiac-tcr structure"]'),
  ]);
  await page21.waitForFunction(
    () => /4OZF/.test(document.getElementById('ro-pathogen')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  console.log('celiac deep-links protein view:', await page21.locator('#ro-pathogen').textContent());
  await page21.close();

  // ---- 36. K3 teaching cohorts: picker + progress + case rows reuse the
  // read-status flow. Cohort opens a case (markReading), Read finishes it
  // (progress chip moves), provenance card names the sources.
  const page22 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page22.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page22.goto(`${BASE}#/worklist`, { waitUntil: 'networkidle' });
  await openDetails(page22);
  await page22.waitForSelector('#dock-cohort', { timeout: 90000 });
  const cohortChip = await page22.locator('#ro-cohort').textContent();
  if (!/0\/3 done/.test(cohortChip ?? '')) fail(`cohort progress wrong at start: ${cohortChip}`);
  else console.log(`cohort starts ${cohortChip}`);
  // open the first case: viewer loads the lung CT (markReading path)
  await page22.click('#cohort-cases button[data-cohort-case="lung-nodule"]');
  await page22.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  console.log('cohort case opens the series in the viewer');
  await page22.goto(`${BASE}#/worklist`, { waitUntil: 'networkidle' });
  await openDetails(page22);
  await page22.waitForSelector('#dock-cohort', { timeout: 90000 });
  await page22.waitForFunction(
    () => (document.getElementById('ro-case-lung-nodule')?.textContent ?? '').includes('reading'),
    null, { timeout: 30000 },
  );
  console.log('case row shows reading:', await page22.locator('#ro-case-lung-nodule').textContent());
  // finish the read from the cohort row: progress chip moves to 1/3
  await page22.click('#cohort-cases button.wl-read-btn');
  await page22.waitForFunction(
    () => /1\/3 done/.test(document.getElementById('ro-cohort')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('cohort progress moves:', await page22.locator('#ro-cohort').textContent());
  const csrc = await page22.locator('#cohort-src').textContent();
  if (!csrc.includes('catalog series')) fail(`cohort provenance wrong: ${csrc}`);
  else console.log(`cohort provenance ${csrc}`);
  // cohort switch: pathogen stories carry 6 bundle cases (M2 organoid last)
  await page22.locator('#dock-cohort select[aria-label="Teaching cohort"]').selectOption('pathogen-stories');
  await page22.waitForFunction(
    () => (document.getElementById('cohort-cases')?.textContent ?? '').includes('CR3022'),
    null, { timeout: 30000 },
  );
  console.log('cohort switches to pathogen stories');
  await page22.waitForFunction(
    () => (document.getElementById('cohort-cases')?.textContent ?? '').includes('organoid'),
    null, { timeout: 30000 },
  );
  console.log('cohort carries the M2 organoid case');
  // E3/X3 difficulty: rows carry D-chips, the ladder cohort spans 1-3.
  await page22.locator('#dock-cohort select[aria-label="Teaching cohort"]').selectOption('residency-ladder');
  await page22.waitForFunction(
    () => (document.getElementById('cohort-cases')?.textContent ?? '').includes('D3'),
    null, { timeout: 30000 },
  );
  console.log('ladder rows carry difficulty:', await page22.locator('#ro-case-ladder-clear').textContent());
  // ---- 36b. Q1–Q4 QC: phantom trends pass, dose/compression/de-id chips
  // stay loud about unrecorded headers + unvalidated syntaxes.
  await page22.waitForSelector('#dock-qc', { timeout: 30000 });
  await page22.waitForFunction(
    () => /pass/.test(document.getElementById('ro-qc-phantom')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('QC phantom trends:', await page22.locator('#ro-qc-phantom').textContent());
  await page22.click('#dock-qc div[aria-label="QC panel"] button:nth-child(2)');
  await page22.waitForFunction(
    () => /unrecorded/.test(document.getElementById('ro-qc-dose')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('QC dose registry:', await page22.locator('#ro-qc-dose').textContent());
  await page22.close();

  // ---- 37. K4 self-test: seeded deck over atlas + bundle banks.
  // Start builds the 95-question deck, answering scores + reveals the
  // rationale, Reseed reshuffles (new first question), Prev/Next walks.
  const page23 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page23.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page23.goto(`${BASE}#/learn`, { waitUntil: 'networkidle' });
  await openDetails(page23);
  await page23.waitForSelector('#dock-selftest', { timeout: 90000 });
  await page23.click('#dock-selftest button[title^="Start the 95-question"]');
  await page23.waitForFunction(
    () => /Q1\/95/.test(document.getElementById('ro-selftest')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  console.log('self-test deck starts:', await page23.locator('#ro-selftest').textContent());
  const firstQ = await page23.locator('#selftest-quiz button[data-selftest]').first().getAttribute('data-selftest');
  // answer the first question correctly: score chip + rationale reveal
  const rightIdx = await page23.evaluate(() => {
    const btns = [...document.querySelectorAll('#selftest-quiz button[data-selftest]')];
    const qid = btns[0]?.getAttribute('data-selftest') ?? '';
    const why = document.querySelector(`[data-selfwhy="${qid}"]`);
    return { qid, n: btns.length };
  });
  if (rightIdx.n < 2) fail(`self-test question has no options: ${rightIdx.n}`);
  // click each option until the score chip shows a correct answer
  for (let i = 0; i < rightIdx.n; i++) {
    await page23.click(`#selftest-quiz button[data-selftest="${rightIdx.qid}"][data-opt="${i}"]`);
    const chip = await page23.locator('#ro-selftest-score').textContent().catch(() => '');
    if (/1 correct/.test(chip ?? '')) break;
  }
  await page23.waitForFunction(
    () => /1 answered/.test(document.getElementById('ro-selftest-score')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('self-test scores:', await page23.locator('#ro-selftest-score').textContent());
  const selfwhy = await page23.locator(`[data-selfwhy="${rightIdx.qid}"]`).textContent();
  if (!/Correct\.|Not quite\./.test(selfwhy ?? '')) fail(`self-test rationale missing: ${selfwhy}`);
  else console.log('self-test rationale teaches');
  // Reseed reshuffles: first question changes, picks clear
  await page23.click('#dock-selftest button[title^="Reshuffle"]');
  await page23.waitForFunction(
    () => /seed 18/.test(document.getElementById('status-text')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  const reQ = await page23.locator('#selftest-quiz button[data-selftest]').first().getAttribute('data-selftest');
  console.log(`reseed reshuffles (${firstQ} → ${reQ})`);
  // reseed clears picks: the score chip unmounts until the next answer
  await page23.waitForFunction(
    () => !document.getElementById('ro-selftest-score'),
    null, { timeout: 30000 },
  );
  console.log('reseed clears picks');
  // Next walks the deck
  await page23.click('#pane-selftest button[title="Next question"]');
  await page23.waitForFunction(
    () => /Q2\/95/.test(document.getElementById('ro-selftest')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('self-test walks:', await page23.locator('#ro-selftest').textContent());

  // ---- 38. E1 plane trainer: 12 drills render, answering scores +
  // reveals the rationale, Next walks.
  await page23.waitForSelector('#dock-planetrainer', { timeout: 30000 });
  await page23.waitForFunction(
    () => /Q1\/12/.test(document.getElementById('ro-planedrill')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('plane drills start:', await page23.locator('#ro-planedrill').textContent());
  const pdq = await page23.locator('#planetrainer-quiz button[data-pdrill]').first().getAttribute('data-pdrill');
  const pdn = await page23.locator('#planetrainer-quiz button[data-pdrill]').count();
  if (pdn < 2) fail(`plane drill has no options: ${pdn}`);
  for (let i = 0; i < pdn; i++) {
    await page23.click(`#planetrainer-quiz button[data-pdrill="${pdq}"][data-opt="${i}"]`);
    const chip = await page23.locator('#ro-planedrill-score').textContent().catch(() => '');
    if (/1 correct/.test(chip ?? '')) break;
  }
  await page23.waitForFunction(
    () => /1 answered/.test(document.getElementById('ro-planedrill-score')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('plane drill scores:', await page23.locator('#ro-planedrill-score').textContent());
  await page23.click('#pane-planetrainer button[title="Next drill"]');
  await page23.waitForFunction(
    () => /Q2\/12/.test(document.getElementById('ro-planedrill')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('plane drills walk:', await page23.locator('#ro-planedrill').textContent());

  // ---- 39. E4 measurement trainer: PR case agrees on published numbers,
  // wrong category stays outside the band; phantom length agrees at 2.0mm.
  await page23.waitForSelector('#dock-measuretrainer', { timeout: 30000 });
  await page23.locator('#dock-measuretrainer select[aria-label="Trainer case"]').selectOption('measuretrainer-recist-pr');
  await page23.fill('#trainer-measured', '30');
  await page23.locator('#pane-measuretrainer select[aria-label="Trainer category"]').selectOption('PR');
  await page23.click('#pane-measuretrainer button[title^="Grade against"]');
  await page23.waitForFunction(
    () => /Agree/.test(document.getElementById('trainer-verdict')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('trainer agrees:', await page23.locator('#trainer-verdict').textContent());
  await page23.locator('#pane-measuretrainer select[aria-label="Trainer category"]').selectOption('SD');
  await page23.click('#pane-measuretrainer button[title^="Grade against"]');
  await page23.waitForFunction(
    () => /Outside band/.test(document.getElementById('trainer-verdict')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('trainer rejects wrong category');
  await page23.locator('#dock-measuretrainer select[aria-label="Trainer case"]').selectOption('measuretrainer-length-phantom');
  await page23.fill('#trainer-measured', '2.0');
  await page23.click('#pane-measuretrainer button[title^="Grade against"]');
  await page23.waitForFunction(
    () => /Agree/.test(document.getElementById('trainer-verdict')?.textContent ?? ''),
    null, { timeout: 30000 },
  );
  console.log('phantom length agrees');
  await page23.close();

  // ---- 40. D1 OpenNeuro ds000001 crops: both catalog entries open as
  // volumes. T1 64³ lands 64 axial slices; BOLD f0 64×64×33 lands 33.
  // CC0 teaching fixtures (Balloon Risk task, sub-01) — the MPR lanes'
  // second-modality pair beyond the hand-rolled corpus.
  const page24 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page24.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page24.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page24);
  await page24.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  await page24.selectOption('.top select.dark', 'openneuro-t1-crop');
  await page24.waitForFunction(
    () => document.querySelector('#filetabs [data-tab="openneuro-t1-crop"][data-active="true"]'),
    null, { timeout: 60000 },
  );
  await page24.waitForFunction(
    () => /\/ 63(\s|·|$)/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  console.log('openneuro T1 crop opens:', await page24.locator('#ro-axial').textContent());
  await page24.selectOption('.top select.dark', 'openneuro-bold-f0');
  await page24.waitForFunction(
    () => document.querySelector('#filetabs [data-tab="openneuro-bold-f0"][data-active="true"]'),
    null, { timeout: 60000 },
  );
  await page24.waitForFunction(
    () => /\/ 32(\s|·|$)/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  console.log('openneuro BOLD f0 opens:', await page24.locator('#ro-axial').textContent());
  await page24.close();

  // ---- 41. V2 3D cursor: an axial tap draws the NiiVue-parity marker in
  // the 3D viewport (accent dot + axis nubs at the synced voxel under the
  // live orbit/tilt). Counts accent px on #view3d before/after the tap —
  // same teal-dominance predicate as the leg-21 crosshair proof.
  const page25 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page25.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page25.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page25);
  await page25.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  const accentCount = () => page25.evaluate(() => {
    const cv = document.getElementById('view3d');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 1] - d[i] > 60 && d[i + 1] > 80) n++;
    }
    return n;
  });
  const accentBefore = await accentCount();
  const vbox = await page25.locator('#c-axial').boundingBox();
  await page25.mouse.click(vbox.x + vbox.width / 2, vbox.y + vbox.height / 2);
  await page25.waitForFunction((before) => {
    const cv = document.getElementById('view3d');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 1] - d[i] > 60 && d[i + 1] > 80) n++;
    }
    return n > Math.max(20, before + 10);
  }, accentBefore, { timeout: 30000 });
  console.log(`3d cursor lands accent px on #view3d (${accentBefore} -> up)`);
  await page25.close();

  // ---- 41b. F7 depth cues: occlusion + outlines darken the surface; the
  // dock switch turns them off (brighter) and back on (the same frame).
  const page25b = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page25b.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page25b.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await page25b.waitForFunction(() => /tris/.test(document.getElementById('ro-3d')?.textContent ?? ''), null, { timeout: 90000 });
  const surfMean = () => page25b.evaluate(() => {
    const cv = document.getElementById('view3d');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] !== 17 || d[i + 1] !== 17 || d[i + 2] !== 17) { s += d[i]; n++; }
    return n ? s / n : 0;
  });
  const cuesOn = await surfMean();
  const cuesSwitch = page25b.locator('#dock-3d input[aria-label="Depth cues"]');
  if (!(await cuesSwitch.isChecked())) fail('depth cues not on by default');
  await cuesSwitch.uncheck({ force: true });
  await page25b.waitForTimeout(400);
  const cuesOff = await surfMean();
  await cuesSwitch.check({ force: true });
  await page25b.waitForTimeout(400);
  const cuesBack = await surfMean();
  if (!(cuesOff > cuesOn * 1.02)) fail(`depth cues off should brighten the surface: on ${cuesOn.toFixed(1)}, off ${cuesOff.toFixed(1)}`);
  else if (cuesBack !== cuesOn) fail(`depth cues back on should restore the frame: ${cuesOn} vs ${cuesBack}`);
  else console.log(`depth cues: surface mean ${cuesOn.toFixed(1)} on, ${cuesOff.toFixed(1)} off`);

  // ---- 41c. F10 cinematic volume lighting accumulates pass by pass while
  // the view is still; an orbit starts it over; leaving volume mode ends it
  // (a late pass used to be able to paint over the surface).
  await page25b.click('#renderseg button[data-r="volume"]');
  await page25b.click('#srcseg button[data-s="image"]');
  await page25b.locator('#dock-3d input[aria-label="Cinematic"]').check({ force: true });
  const ro3d = () => page25b.locator('#ro-3d').textContent();
  await page25b.waitForFunction(() => /· [2-9]\/16 passes · cinematic$/.test(document.getElementById('ro-3d')?.textContent ?? ''), null, { timeout: 120000 });
  const accumulated = await ro3d();
  await page25b.locator('input[aria-label="Orbit"]').fill('1.2');
  await page25b.waitForFunction(() => /^VR \d+×\d+ · [\d.]+s · cinematic$/.test(document.getElementById('ro-3d')?.textContent ?? ''), null, { timeout: 60000 });
  console.log(`cinematic: ${accumulated} -> orbit restarts at pass 1`);
  await page25b.click('#renderseg button[data-r="surface"]');
  await page25b.waitForTimeout(3000);
  const after = await ro3d();
  if (!/tris/.test(after ?? '')) fail(`a volume pass painted over the surface: ${after}`);

  // ---- 41d. F11 level of detail: a surface over the orbit budget gets a
  // decimated level for orbit frames (the skull CT's bone, ~118k tris).
  await page25b.click('#openpal'); await page25b.fill('#palinput', 'skull-ct-bone');
  await page25b.waitForSelector('#pallist li'); await page25b.click('#pallist li');
  await page25b.waitForFunction(() => /\(orbit [\d,]+\)/.test(document.getElementById('ro-3d')?.textContent ?? ''), null, { timeout: 180000 });
  const lodText = await ro3d();
  const [full, orbit] = (lodText?.match(/([\d,]+) tris \(orbit ([\d,]+)\)/) ?? []).slice(1).map((n) => Number(n.replace(/,/g, '')));
  if (!(full > 100000 && orbit > 0 && orbit * 3 <= full * 2)) fail(`orbit level: ${lodText}`);
  else console.log(`level of detail: ${lodText}`);
  await page25b.close();

  // ---- 41e. F12 3D → 2D picking: a tap on the BraTS tumour, surface and
  // volume render, lands the crosshair on a voxel the tumour mask labels,
  // and the axial pane moves to its slice.
  const page25c = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page25c.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page25c.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await page25c.waitForFunction(() => /tris/.test(document.getElementById('ro-3d')?.textContent ?? ''), null, { timeout: 90000 });
  /** Tap the drawn pixel nearest the centre of everything drawn. */
  const tapStructure = async (mode) => {
    const at = await page25c.evaluate(() => {
      const cv = document.getElementById('view3d');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const drawn = (i) => Math.abs(d[i] - 17) + Math.abs(d[i + 1] - 17) + Math.abs(d[i + 2] - 17) > 12;
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (drawn((y * cv.width + x) * 4)) { sx += x; sy += y; n++; }
      const cx = sx / n, cy = sy / n;
      let best = null, bd = Infinity;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const dd = (x - cx) ** 2 + (y - cy) ** 2;
        if (dd < bd && drawn((y * cv.width + x) * 4)) { bd = dd; best = [x + 0.5, y + 0.5]; }
      }
      const r = cv.getBoundingClientRect();
      return { x: r.left + best[0] * (r.width / cv.width), y: r.top + best[1] * (r.height / cv.height) };
    });
    // a new pick's line, not the one a pick before it left standing
    const before = await page25c.locator('#status-text').textContent();
    await page25c.mouse.click(at.x, at.y);
    const on = mode === 'volume' ? 'volume render' : 'surface';
    await page25c.waitForFunction(([w, b]) => {
      const t = document.getElementById('status-text')?.textContent ?? '';
      return t.includes(`3D pick on the ${w}`) && t !== b;
    }, [on, before], { timeout: 30000 });
    return page25c.locator('#status-text').textContent();
  };
  let pickZ = 0;
  for (const mode of ['surface', 'volume']) {
    if (mode === 'volume') {
      await page25c.click('#renderseg button[data-r="volume"]');
      await page25c.waitForFunction(() => /^VR \d+×\d+/.test(document.getElementById('ro-3d')?.textContent ?? ''), null, { timeout: 120000 });
    }
    const said = await tapStructure(mode);
    const m = said?.match(/voxel \((\d+), (\d+), (\d+)\).*label (\d+)/);
    const axial = await page25c.locator('#ro-axial').textContent();
    if (!m || Number(m[4]) < 1) fail(`${mode} pick missed the tumour: ${said}`);
    else if (!axial?.startsWith(`${m[3]} /`)) fail(`${mode} pick: axial pane at ${axial}, voxel z ${m[3]}`);
    else console.log(`3D pick (${mode}): ${said} · axial ${axial}`);
    if (m) pickZ = Number(m[3]);
  }

  // ---- 41f. F13 clip: an axial plane through the tumour, 8 slices under
  // where the last pick landed (so a pick that ignored it lands above it),
  // takes away what is above it in both render modes, and a tap goes to
  // what is left.
  const nz = Number((await page25c.locator('#ro-axial').textContent())?.match(/\/ (\d+)/)?.[1]) + 1;
  const drawnCount = () => page25c.evaluate(() => {
    const cv = document.getElementById('view3d');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 17) + Math.abs(d[i + 1] - 17) + Math.abs(d[i + 2] - 17) > 12) n++;
    return n;
  });
  const lastPass = () => page25c.waitForFunction(() => /4\/4 passes/.test(document.getElementById('ro-3d')?.textContent ?? ''), null, { timeout: 120000 });
  await lastPass();
  const whole = { volume: await drawnCount() };
  // set the clip up on the surface (drawn at once), then enter volume mode:
  // one render starts, and its last pass is the clipped one
  await page25c.click('#renderseg button[data-r="surface"]');
  await page25c.waitForFunction(() => /tris/.test(document.getElementById('ro-3d')?.textContent ?? ''), null, { timeout: 90000 });
  await page25c.waitForTimeout(1000);
  whole.surface = await drawnCount();
  await page25c.locator('#dock-3d input[aria-label="Clip"]').check({ force: true });
  await page25c.waitForSelector('#pane-clip');
  await page25c.click('#clipplane button[data-plane="axial"]');
  // on the slider's 0.01 steps (a range input refuses anything between)
  await page25c.locator('#clip-at').fill(String(Math.floor(((pickZ - 8) / nz) * 100) / 100));
  const at = Number(await page25c.locator('#clip-at').inputValue()) * nz;
  for (const mode of ['surface', 'volume']) {
    if (mode === 'volume') {
      await page25c.evaluate(() => { document.getElementById('ro-3d').textContent = ''; });
      await page25c.click('#renderseg button[data-r="volume"]');
      await lastPass();
    } else await page25c.waitForTimeout(1000);
    const cut = await drawnCount();
    const said = await tapStructure(mode);
    const z = Number(said?.match(/voxel \(\d+, \d+, (\d+)\)/)?.[1]);
    if (!(cut > 0 && cut < whole[mode])) fail(`${mode} clip at z ${at.toFixed(1)}: ${cut} px drawn, ${whole[mode]} whole`);
    else if (!(z <= at + 2)) fail(`${mode} pick through the clip at z ${at.toFixed(1)}: ${said}`);
    else console.log(`clip (${mode}): axial plane z ${at.toFixed(1)} · ${cut} of ${whole[mode]} px drawn · pick z ${z}`);
  }
  await page25c.locator('#dock-3d input[aria-label="Clip"]').uncheck({ force: true });
  if (await page25c.locator('#pane-clip').count()) fail('the clip pane outlived the Clip switch');
  await page25c.close();

  // ---- 42. G3 radiomics CSV import: hand-rolled pyradiomics-shaped CSV
  // lands tagged rows in the measurement table (offline features shown,
  // never computed in-viewer — same provenance contract as leg 29b).
  const page26 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page26.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page26.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page26);
  await page26.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  const radioPath = join(dir, 'wire-radiomics.csv');
  writeFileSync(radioPath, [
    'label,original_firstorder_Mean,original_shape_Volume_mm3',
    'nodule-A,42.5,1250',
  ].join('\n'));
  await page26.setInputFiles('input#radiomics-upload', radioPath);
  await page26.waitForFunction(
    () => [...document.querySelectorAll('#measureinfo .mrow dt')].some((d) => (d.textContent ?? '').includes('radiomics import')),
    null, { timeout: 30000 },
  );
  console.log('radiomics import returns tagged rows');
  await page26.close();

  await browser.close();
} catch (e) {
  fail(`exception: ${(e.stack || String(e)).slice(0, 800)}`);
} finally {
  server.kill();
}
if (!failed) console.log('WIRE PASS');
process.exit(failed ? 1 : 0);
