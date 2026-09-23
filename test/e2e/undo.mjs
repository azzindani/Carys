// Shared-undo e2e: protein selection, cells view-state, and the MPR mask
// all undo through the same dock row + ⌘Z bus. Fails loud, prints PASS.
// Run: npm run test:undo (chained into test:e2e)
// NOTE: waitForSelector takes (selector, options) — TWO args. Passing a
// null second arg (as waitForFunction does) throws an instant,
// misleading TypeError inside Playwright. Do not "fix" these to 3 args.
import { spawn } from 'node:child_process';

const PORT = Number(process.env.E2E_PORT || 8129);
const BASE = `http://localhost:${PORT}/packages/app/dist/index.html`;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

let failed = 0;
const fail = (msg) => {
  failed = 1;
  console.error(`UNDO FAIL: ${msg}`);
};
try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
  const text = (sel) => page.locator(sel).textContent().catch(() => null);
  const count = (sel) => page.locator(sel).count();

  // networkidle like demo/shots: domcontentloaded races a Playwright
  // lifecycle read ('visibility' TypeError) on this bundle under load.
  // ---- protein: select → undo → cleared; select → clear → undo → restored
  await page.goto(`${BASE}#/protein`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#seqstrip button[data-res]', { timeout: 90000 });
  await page.locator('#seqstrip button[data-res]').first().click();
  await page.waitForFunction(() => document.getElementById('ro-sel')?.textContent?.includes('1 selected'), null, { timeout: 30000 });
  await page.click('#dock-protein #undogrp button[title="Undo selection"]');
  await page.waitForFunction(() => !document.getElementById('ro-sel'), null, { timeout: 30000 });
  console.log('protein undo clears selection');
  await page.locator('#seqstrip button[data-res]').first().click();
  await page.waitForSelector('#ro-sel', { timeout: 30000 });
  await page.click('#dock-protein #undogrp button[title="Clear selection"]');
  await page.waitForFunction(() => !document.getElementById('ro-sel'), null, { timeout: 30000 });
  await page.click('#dock-protein #undogrp button[title="Undo selection"]');
  await page.waitForSelector('#ro-sel', { timeout: 30000 });
  console.log('protein clear + undo restores selection');
  // ⌘Z bus on protein
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => !document.getElementById('ro-sel'), null, { timeout: 30000 });
  console.log('protein ctrl+z clears selection');

  // ---- cells: hide C0 → undo → restored; clear → undo → restored
  await page.goto(`${BASE}#/cells`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#chaninfo .mrow', { timeout: 90000 });
  const rows2 = await count('#chaninfo .mrow');
  if (rows2 !== 2) fail(`cells demo rows expected 2, got ${rows2}`);
  await page.locator('#dock-cells input[data-ch="0"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#chaninfo .mrow').length === 1, null, { timeout: 30000 });
  await page.click('#dock-cells #undogrp button[title="Undo view change"]');
  await page.waitForFunction(() => document.querySelectorAll('#chaninfo .mrow').length === 2, null, { timeout: 30000 });
  console.log('cells toggle + undo restores channel');
  await page.click('#dock-cells #undogrp button[title="Hide all channels"]');
  await page.waitForSelector('#chaninfo .hint', { timeout: 30000 });
  await page.click('#dock-cells #undogrp button[title="Undo view change"]');
  await page.waitForFunction(() => document.querySelectorAll('#chaninfo .mrow').length === 2, null, { timeout: 30000 });
  console.log('cells clear + undo restores channels');

  // ---- MPR regression: paint → dock undo reverts voxels
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 90000 },
  );
  // The voxel count lives in the details panel, which starts closed (it
  // overlays the image); read it the way a user would — open the panel.
  const t = await page.waitForSelector('#instoggle', { timeout: 5000 });
  if ((await t.getAttribute('aria-pressed')) !== 'true') await t.click();
  await page.waitForSelector('#maskinfo dd', { timeout: 10000 });
  const vox = () => page.evaluate(() => {
    const dd = [...document.querySelectorAll('#maskinfo dd')];
    const v = dd.find((d) => /^\d[\d,]*$/.test(d.textContent.trim()));
    return v ? v.textContent.trim() : '(none)';
  });
  await page.click('#modeseg button[data-mode="paint"]');
  const before = await vox();
  const box = await page.locator('#c-axial').boundingBox();
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  const painted = await vox();
  if (before === painted) fail(`mpr paint stamped nothing (${before})`);
  await page.click('#dock-mpr #undogrp button[title="Undo stroke"]');
  await page.waitForTimeout(1000);
  const undone = await vox();
  if (undone !== before) fail(`mpr undo: ${before} -> ${painted} -> ${undone}`);
  else console.log(`mpr paint + undo reverts voxels (${before})`);

  await browser.close();
} catch (e) {
  fail(`harness: ${String(e).slice(0, 200)}`);
} finally {
  server.kill();
  console.log(failed ? 'UNDO FAILURES PRESENT' : 'UNDO PASS');
  process.exit(failed);
}
