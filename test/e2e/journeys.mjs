// UI journeys: money flows end to end, not just feature reachability
// (wire.mjs proves reach; this proves completion). Fails loud, prints PASS.
// Run: npm run test:journeys (chained into test:e2e)
import { spawn } from 'node:child_process';

const PORT = Number(process.env.E2E_PORT || 8132);
const BASE = `http://localhost:${PORT}/packages/app/dist/index.html`;

/** The details drawer starts closed (it overlays the image); journeys that
 *  read #maskinfo open it first. */
const openDetails = async (pg) => {
  try {
    const t = await pg.waitForSelector('#instoggle', { timeout: 1500 });
    if ((await t.getAttribute('aria-pressed')) !== 'true') await t.click();
  } catch { /* no drawer on this route */ }
};

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

let failed = 0;
const fail = (msg) => {
  failed = 1;
  console.error(`JOURNEY FAIL: ${msg}`);
};

try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page);
  await page.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  const vox = () => page.evaluate(() => {
    const dd = [...document.querySelectorAll('#maskinfo dd')];
    const v = dd.find((d) => /^\d[\d,]*$/.test(d.textContent.trim()));
    return v ? v.textContent.trim() : '(none)';
  });

  // ---- A. paint -> export PNG download -> undo reverts.
  await page.click('#modeseg button[data-mode="paint"]');
  const before = await vox();
  const box = await page.locator('#c-axial').boundingBox();
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(
    (b) => {
      const dd = [...document.querySelectorAll('#maskinfo dd')];
      const v = dd.find((d) => /^\d[\d,]*$/.test(d.textContent.trim()));
      return v && v.textContent.trim() !== b;
    }, before, { timeout: 30000 },
  );
  console.log(`journey paint stamps voxels (${before} -> ${await vox()})`);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#dock-tune button[title="Export axial PNG"]'),
  ]);
  const name = dl.suggestedFilename();
  if (!name.endsWith('.png')) fail(`export filename not a png: ${name}`);
  else console.log(`journey export downloads ${name}`);
  await page.click('#dock-mpr #undogrp button[title="Undo stroke"]');
  await page.waitForFunction(
    (b) => {
      const dd = [...document.querySelectorAll('#maskinfo dd')];
      const v = dd.find((d) => /^\d[\d,]*$/.test(d.textContent.trim()));
      return v && v.textContent.trim() === b;
    }, before, { timeout: 30000 },
  );
  console.log('journey undo reverts the stroke');

  // ---- B. measure length -> report counts it.
  await page.click('#modeseg button[data-mode="measure"]');
  const cbox = await page.locator('#c-axial').boundingBox();
  await page.mouse.click(cbox.x + cbox.width / 2 - 30, cbox.y + cbox.height / 2);
  await page.mouse.click(cbox.x + cbox.width / 2 + 30, cbox.y + cbox.height / 2);
  await page.goto(`${BASE}#/report`, { waitUntil: 'networkidle' });
  await openDetails(page);
  await page.waitForFunction(
    () => document.querySelector('#title-report p')?.textContent?.includes('1 measurement(s)'),
    null, { timeout: 30000 },
  );
  console.log('journey measure lands in the report (1 measurement)');

  // ---- C. palette opens a series by name.
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await openDetails(page);
  await page.click('#openpal');
  await page.waitForSelector('#palinput', { timeout: 30000 });
  await page.fill('#palinput', 'cardiac-4d-cine');
  await page.waitForSelector('#pallist li', { timeout: 30000 });
  await page.click('#pallist li');
  await page.waitForFunction(
    () => document.getElementById('status-text')?.textContent?.includes('cardiac-4d-cine'),
    null, { timeout: 90000 },
  );
  console.log('journey palette opens cardiac-4d-cine');

  await browser.close();
} catch (e) {
  fail(`exception: ${(e.stack || String(e)).slice(0, 800)}`);
} finally {
  server.kill();
}
if (!failed) console.log('JOURNEYS PASS');
process.exit(failed ? 1 : 0);
