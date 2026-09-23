// UI journeys: money flows end to end, not just feature reachability
// (wire.mjs proves reach; this proves completion). Fails loud, prints PASS.
// Run: npm run test:journeys (chained into test:e2e)
import { spawn } from 'node:child_process';

const PORT = Number(process.env.E2E_PORT || 8132);
const BASE = `http://localhost:${PORT}/packages/app/dist/index.html`;

/** The details drawer starts closed (it overlays the image); journeys that
 *  read #maskinfo open it first. */
const openDetails = async (pg) => {
  // wait for the route to mount: a fixed 1.5 s window read a slow mount on a
  // loaded machine as "no drawer here" and the journey then timed out later
  await pg.waitForFunction(
    () => document.querySelector('#root .main') && !document.querySelector('.route-stub'),
    null, { timeout: 60000 },
  );
  const t = await pg.$('#instoggle');
  if (!t) return; // no drawer on this route
  if ((await t.getAttribute('aria-pressed')) !== 'true') await t.click();
  await pg.waitForSelector('#instoggle[aria-pressed="true"]', { timeout: 10000 });
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

  // ---- A2. F15 paint every few slices -> Interp fills between -> one undo
  // takes the fill back, the painted slices stay.
  await page.click('#dock-mpr #undogrp button[title="Clear mask"]');
  await page.waitForFunction(() => {
    const dd = [...document.querySelectorAll('#maskinfo dd')];
    return dd.some((d) => d.textContent.trim() === '0');
  }, null, { timeout: 30000 });
  const toSlice = async (z) => {
    await page.locator('#s-axial').fill(String(z));
    await page.waitForFunction((w) => (document.getElementById('ro-axial')?.textContent ?? '').startsWith(`${w} /`), z, { timeout: 30000 });
  };
  const stroke = async (dy) => {
    const b = await page.locator('#c-axial').boundingBox();
    await page.mouse.move(b.x + b.width / 2 - 30, b.y + b.height / 2 + dy);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2 + dy, { steps: 8 });
    await page.mouse.up();
  };
  /** Axial pane pixels near the label 1 colour: the mask drawn on this slice. */
  const redPx = () => page.evaluate(() => {
    const cv = document.getElementById('c-axial');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 255) + Math.abs(d[i + 1] - 60) + Math.abs(d[i + 2] - 60) <= 60) n++;
    return n;
  });
  // one structure's cross-sections: the second overlaps the first, shifted
  await toSlice(60); await stroke(0);
  await page.waitForTimeout(500);
  const oneStroke = await vox();
  await toSlice(66); await stroke(4);
  await page.waitForTimeout(700);
  const painted = await vox();
  await toSlice(63);
  const between0 = await redPx();
  await page.click('#dock-seg button[title="Fill between painted slices (any plane, each label)"]');
  await page.waitForFunction(() => /^interp: .* axial slices · label 1/.test(document.getElementById('status-text')?.textContent ?? ''), null, { timeout: 60000 });
  const said = await page.locator('#status-text').textContent();
  await page.waitForTimeout(700);
  const filled = await vox(), between1 = await redPx();
  if (!(between0 === 0 && between1 > 20 && Number(filled.replace(/,/g, '')) > Number(painted.replace(/,/g, '')))) {
    fail(`interp: ${said} · slice 63 ${between0} -> ${between1} px · ${painted} -> ${filled} vox`);
  } else console.log(`journey interp fills between painted slices: ${said} · slice 63 ${between0} -> ${between1} px`);
  await page.click('#dock-mpr #undogrp button[title="Undo stroke"]');
  await page.waitForFunction((b) => {
    const dd = [...document.querySelectorAll('#maskinfo dd')];
    return dd.some((d) => d.textContent.trim() === b);
  }, painted, { timeout: 30000 });
  await page.waitForTimeout(500);
  if (await redPx() !== 0) fail('one undo left the fill on slice 63');
  else console.log(`journey one undo takes the fill back (${filled} -> ${painted} vox)`);
  // and the next undo takes back the second stroke, not both (undo used
  // to land one change too far back)
  await page.click('#dock-mpr #undogrp button[title="Undo stroke"]');
  await page.waitForFunction((b) => {
    const dd = [...document.querySelectorAll('#maskinfo dd')];
    return dd.some((d) => d.textContent.trim() === b);
  }, oneStroke, { timeout: 30000 });
  console.log(`journey the next undo takes back one stroke (${painted} -> ${oneStroke} vox)`);

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
