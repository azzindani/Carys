// E2E static-UI smoke: serve repo root, assert the thin-slice page loads,
// every module it imports resolves, and both datasets are fetchable.
// Rendering math itself is covered by golden hashes (render-cpu); a headless
// screenshot needs a browser which this sandbox does not provide — stated,
// not faked. Run: npm run test:e2e
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const PORT = Number(process.env.E2E_PORT || 8123);
const BASE = `http://localhost:${PORT}`;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], {
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 1500));

let failed = 0;
try {
  const get = async (p, { head = false } = {}) => {
    const r = await fetch(BASE + p, { method: head ? 'HEAD' : 'GET' });
    return r;
  };
  const shell = await (await get('/packages/ui/index.html')).text();
  for (const marker of ['id="view-mpr"', 'id="view-3d"', 'palinput', 'createExtractor', 'savenii', 'srcseg', 'viewer-lib.js', '--accent']) {
    assert.ok(shell.includes(marker), `shell missing ${marker}`);
  }
  console.log('shell ok');
  const page = await (await get('/packages/ui/slice.html')).text();
  for (const marker of ['c-axial', 'c-coronal', 'c-sagittal', 'importmap', 'putImageData', 'id="series"', 'lung-ct-dicom', 'loadDicomSeries']) {
    assert.ok(page.includes(marker), `page missing ${marker}`);
  }
  console.log('page ok');
  const spage = await (await get('/packages/ui/surface.html')).text();
  for (const marker of ['id="view"', 'id="orbit"', 'extractBoundary', 'surfaceNets', 'id="method"', 'extract.worker.js', 'renderMesh', 'viewer-lib.js']) {
    assert.ok(spage.includes(marker), `surface page missing ${marker}`);
  }
  const wsrc = await (await get('/packages/ui/extract.worker.js')).text();
  for (const marker of ['onmessage', 'postMessage', 'surfaceNets', 'transfer']) {
    assert.ok(wsrc.toLowerCase().includes(marker.toLowerCase()), `worker missing ${marker}`);
  }
  console.log('worker ok');
  const apage = await (await get('/packages/ui/slice.html')).text();
  for (const marker of ['id="mode"', 'drawPenLine', 'UndoStack', 'id="save"', 'id="savemask"', 'writeNifti1', 'viewer-lib.js']) {
    assert.ok(apage.includes(marker), `slice page missing ${marker}`);
  }
  for (const marker of ['id="upload"', 'loadNiiBuffer']) {
    assert.ok(spage.includes(marker), `surface page missing ${marker}`);
  }
  console.log('surface page ok');
  for (const m of [
    '/packages/io/dist/nifti1.js',
    '/packages/io/dist/dicom-parse.js',
    '/packages/io/dist/dicom.js',
    '/packages/io/dist/dicom-tags.js',
    '/packages/io/dist/nifti-write.js',
    '/packages/volume-core/dist/index.js',
    '/packages/volume-core/dist/lut.js',
    '/packages/volume-core/dist/histogram.js',
    '/packages/render-cpu/dist/index.js',
    '/packages/render-cpu/dist/mpr.js',
    '/packages/render-cpu/dist/surface.js',
    '/packages/render-cpu/dist/surface-nets.js',
    '/packages/render-cpu/dist/raster.js',
    '/packages/editor-seg/dist/drawing.js',
    '/packages/ui/viewer-lib.js',
  ]) {
    const r = await get(m, { head: true });
    assert.equal(r.status, 200, `${m} -> ${r.status}`);
    console.log('module ok', m);
  }
  for (const d of [
    '/samples/brain_tumor_BraTS19_CBICA_AQN_1_flair.nii',
    '/samples/brain_tumor_BraTS19_CBICA_AQN_1_seg.nii',
  ]) {
    const r = await get(d, { head: true });
    assert.equal(r.status, 200, `${d} -> ${r.status}`);
    assert.ok(Number(r.headers.get('content-length')) > 1_000_000, `${d} suspiciously small`);
    console.log('data ok', d, r.headers.get('content-length'));
  }
  console.log('E2E SMOKE PASS');
} catch (e) {
  failed = 1;
  console.error('E2E SMOKE FAIL:', e.message);
} finally {
  server.kill();
  process.exit(failed);
}
