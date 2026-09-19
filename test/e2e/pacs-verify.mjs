// PACS end-to-end: mock DICOMweb server (real sample DICOM bytes) +
// full UI path: Studies > PACS tab > add endpoint > QIDO search >
// series list > pull into viewer. Run: npm run test:pacs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildMultipartRelated } from '../../packages/dicomweb/dist/multipart.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATIC_PORT = Number(process.env.E2E_PORT || 8139);
const PACS_PORT = STATIC_PORT + 1;

const STUDY = '1.2.826.9.9';
const SERIES = '1.2.826.9.9.1';
const N = 5;
const files = Array.from({ length: N }, (_, i) =>
  readFileSync(join(ROOT, 'samples', `lung_ct_0${i + 1}.dcm`)),
);

const el = (tag, value) => ({ [tag]: { vr: 'LO', Value: [value] } });
const qidoStudies = [{
  ...el('0020000D', STUDY),
  '00100010': { vr: 'PN', Value: [{ Alphabetic: 'MOCK^PACS' }] },
  '00100020': { vr: 'SH', Value: ['MOCK1'] },
  '00080061': { vr: 'CS', Value: ['CT'] },
}];
const qidoSeries = [{
  ...el('0020000D', STUDY),
  ...el('0020000E', SERIES),
  '00080060': { vr: 'CS', Value: ['CT'] },
  '00200011': { vr: 'IS', Value: ['1'] },
  '0008103E': { vr: 'LO', Value: ['Mock Lung'] },
  '00201208': { vr: 'IS', Value: [String(N)] },
}];
const qidoInstances = files.map((_, i) => ({
  ...el('0020000D', STUDY),
  ...el('0020000E', SERIES),
  ...el('00080018', `${STUDY}.${i + 1}`),
  '00200013': { vr: 'IS', Value: [String(i + 1)] },
}));

const pacs = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const u = new URL(req.url, 'http://x');
  const json = (o) => {
    res.writeHead(200, { 'content-type': 'application/dicom+json' });
    res.end(JSON.stringify(o));
  };
  if (u.pathname === '/dicom-web/studies') return json(qidoStudies);
  if (u.pathname === `/dicom-web/studies/${STUDY}/series`) return json(qidoSeries);
  if (u.pathname === `/dicom-web/studies/${STUDY}/series/${SERIES}/instances`) return json(qidoInstances);
  const m = u.pathname.match(/\/dicom-web\/studies\/.+\/series\/.+\/instances\/(.+)/);
  if (m) {
    const idx = Number(m[1].split('.').pop()) - 1;
    const { body, boundary } = buildMultipartRelated(
      [{ contentType: 'application/dicom', body: files[idx] }], 'mock-b',
    );
    res.writeHead(200, { 'content-type': `multipart/related; type="application/dicom"; boundary=${boundary}` });
    return res.end(body);
  }
  res.writeHead(404);
  res.end('nope');
});

const statik = spawn('python3', ['-m', 'http.server', String(STATIC_PORT), '--directory', '.'], { stdio: 'ignore' });
await new Promise((r) => pacs.listen(PACS_PORT, r));
await new Promise((r) => setTimeout(r, 1200));

let failed = 0;
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${STATIC_PORT}/packages/app/dist/index.html#/worklist`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.wl-row', { timeout: 30000 });
  // PACS tab > add endpoint
  await page.click('.wl-tabs button:has-text("PACS")');
  await page.fill('input[aria-label="New endpoint URL"]', `http://localhost:${PACS_PORT}/dicom-web`);
  await page.fill('input[aria-label="New endpoint name"]', 'mock');
  await page.click('button:has-text("Add")');
  await page.fill('input[aria-label="QIDO patient name"]', 'MOCK');
  await page.click('#dock-pacs button:has-text("Search")');
  await page.waitForSelector('text=MOCK1', { timeout: 15000 });
  await page.click('button:has-text("Series")');
  await page.waitForSelector('text=Mock Lung', { timeout: 15000 });
  await page.screenshot({ path: new URL('./shots/pacs-panel.png', import.meta.url).pathname });
  await page.click('button:has-text("Pull")');
  await page.waitForFunction(
    () => document.getElementById('status-text')?.textContent?.includes('tris') ||
      /512×512×5/.test(document.getElementById('status-text')?.textContent ?? ''),
    null, { timeout: 120000 },
  );
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: new URL('./shots/pacs-pulled.png', import.meta.url).pathname });
  const series = await page.locator('#series-big').textContent();
  console.log('PULLED SERIES:', series);
  const actionable = errors.filter((e) => !e.includes('fonts.g'));
  if (actionable.length > 0) { console.error('PAGE ERRORS:\n' + actionable.join('\n')); failed = 1; }
  else console.log('PACS VERIFY PASS');
  await browser.close();
} catch (e) {
  failed = 1;
  console.error('PACS VERIFY FAIL:', e.message);
} finally {
  pacs.close();
  statik.kill();
  process.exit(failed);
}
