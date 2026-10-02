// The README's screenshots, from real data that may be published: the
// OpenNeuro ds000001 T1 crop (CC0), RCSB PDB structures (CC0) and the
// BodyParts3D body (CC BY 4.0). Nothing else from a real sample set may
// appear in them (docs/DATA.md).
//
//   SHOTS_ROOT=<dir holding the built repo, with samples/ holding
//   openneuro_ds000001_t1-crop.nii and the generated set> node test/e2e/readme-shots.mjs
//
// Writes docs/screenshots/*.png.
import { spawn } from 'node:child_process';
import { launchChromium } from './browser.mjs';

const ROOT = process.env.SHOTS_ROOT;
if (!ROOT) throw new Error('SHOTS_ROOT is required (a directory with generated samples, never the real ones)');
const OUT = new URL('../../docs/screenshots/', import.meta.url).pathname;
const PORT = Number(process.env.E2E_PORT || 8190);
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const BASE = `http://localhost:${PORT}/packages/app/dist/index.html`;

const browser = await launchChromium();
let bad = 0;
try {
  const open = async (vp, route, mobile = false) => {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { bad = 1; console.error('pageerror', String(e).slice(0, 300)); });
    await page.goto(`${BASE}#/${route}`, { waitUntil: 'networkidle' });
    return page;
  };
  const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` });
  const desk = { width: 1440, height: 900 };
  const phone = { width: 390, height: 844 };

  /** The viewer on the real T1 MRI alone, its 3D a surface cut at the vessels. */
  const t1 = async (page) => {
    await page.waitForFunction(() => /tris/.test(document.getElementById('ro-3d')?.textContent ?? ''), null, { timeout: 90000 });
    await page.evaluate(() => { location.hash = '#/'; });
    await page.keyboard.press('Control+k');
    await page.fill('#palinput', 'openneuro-t1-crop');
    await page.waitForSelector('#pallist li'); await page.click('#pallist li');
    await page.waitForFunction(() => document.querySelector('[data-tab="openneuro-t1-crop"][data-active="true"]'), null, { timeout: 60000 });
    // the phantom the app boots on goes, where its tab is on screen (a phone
    // keeps the tabs in the hidden deck, and shows only the active series)
    const close = page.locator('[aria-label="Close brats-flair-seg"]:visible');
    if (await close.count()) await close.first().click();
    await page.waitForTimeout(1500);
  };
  const vessels = async (page) => {
    await page.click('.popbar button:has-text("3D")'); await page.waitForTimeout(500);
    const th = page.locator('input[type=range][aria-label="Threshold"]');
    await th.evaluate((e) => {
      const v = Math.round(Number(e.min) + (Number(e.max) - Number(e.min)) * 0.42);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, String(v));
      e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.keyboard.press('Escape');
    await page.click('button[title="Zoom out 3D"]');
    await page.waitForTimeout(6000);
  };

  let p = await open(desk, '');
  await t1(p); await vessels(p);
  await shot(p, 'viewer'); await p.context().close();

  p = await open(desk, 'protein');
  await p.selectOption('select[aria-label="Pathogen structure"]', { index: 1 }); await p.waitForTimeout(5000);
  await shot(p, 'protein'); await p.context().close();

  p = await open(desk, 'protein');
  await p.click('#protein-mode button[data-protein-mode="capsid"]'); await p.waitForTimeout(4000);
  await shot(p, 'capsid'); await p.context().close();

  p = await open(desk, 'atlas'); await p.waitForTimeout(4000);
  await p.click('#atlas-mode button[data-atlas-mode="body"]'); await p.waitForTimeout(5000);
  await shot(p, 'atlas'); await p.context().close();

  p = await open(phone, '', true);
  await t1(p);
  // the phone shows one viewport: the real sagittal slice, then the deck goes back down
  await p.click('.deck-grip'); await p.waitForTimeout(500);
  await p.click('#mviewseg button[data-mview="sagittal"]'); await p.waitForTimeout(500);
  await p.click('.deck-grip'); await p.waitForTimeout(400);
  await p.click('.deck-grip'); await p.waitForTimeout(1500);
  await shot(p, 'phone-hidden');
  await p.click('.deck-grip'); await p.waitForTimeout(800);
  await shot(p, 'phone-half');
  await p.context().close();
} catch (e) { bad = 1; console.error('SHOTS FAIL:', e.message); }
finally { await browser.close(); server.kill(); }
console.log(bad ? 'README SHOTS FAIL' : 'README SHOTS DONE');
process.exit(bad);
