// The README's screenshots, from licence-safe data only: the generated head
// phantom and cells (npm run gen:samples into a scratch CARYS_SAMPLES_DIR) and
// CC0 PDB structures. Never run against a real sample set.
//
//   SHOTS_ROOT=<dir holding the built repo + generated samples/> node test/e2e/readme-shots.mjs
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

  let p = await open(desk, '');
  await p.waitForFunction(() => /tris/.test(document.getElementById('ro-3d')?.textContent ?? ''), null, { timeout: 90000 });
  await p.waitForTimeout(1500);
  await shot(p, 'viewer'); await p.context().close();

  p = await open(desk, 'protein');
  await p.setInputFiles('#pdb-upload', `${ROOT}/samples/1crn.pdb`); await p.waitForTimeout(3000);
  await shot(p, 'protein'); await p.context().close();

  p = await open(desk, 'protein');
  await p.click('#protein-mode button[data-protein-mode="capsid"]'); await p.waitForTimeout(4000);
  await shot(p, 'capsid'); await p.context().close();

  p = await open(desk, 'cells'); await p.waitForTimeout(5000);
  await shot(p, 'cells'); await p.context().close();

  p = await open(desk, 'atlas'); await p.waitForTimeout(4000);
  await p.click('#atlas-mode button[data-atlas-mode="body"]'); await p.waitForTimeout(5000);
  await shot(p, 'atlas'); await p.context().close();

  p = await open(phone, '', true);
  await p.waitForFunction(() => /tris/.test(document.getElementById('ro-3d')?.textContent ?? ''), null, { timeout: 90000 });
  await p.waitForTimeout(1500);
  await shot(p, 'phone-hidden');
  await p.click('.deck-grip'); await p.waitForTimeout(800);
  await shot(p, 'phone-half');
  await p.context().close();
} catch (e) { bad = 1; console.error('SHOTS FAIL:', e.message); }
finally { await browser.close(); server.kill(); }
console.log(bad ? 'README SHOTS FAIL' : 'README SHOTS DONE');
process.exit(bad);
