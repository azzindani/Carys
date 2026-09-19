// Demo videos: headless Chromium records three flows — radiology, protein,
// cells — one webm each plus stills. Manual run: npm run demo →
// test/e2e/demos/<ts>/{radiology,protein,cells}.webm. Not part of any gate;
// asserts nothing, records everything.
import { spawn } from 'node:child_process';
import { mkdirSync, renameSync } from 'node:fs';

const PORT = Number(process.env.E2E_PORT || 8127);
const OUT = new URL('./demos/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const DIR = `${OUT}${stamp}/`;
mkdirSync(DIR, { recursive: true });
const APP = (port, hash) => `http://localhost:${port}/packages/app/dist/index.html#/${hash}`;

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

let failed = 0;
try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const recPage = () => browser.newPage({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: DIR, size: { width: 1440, height: 900 } },
  });
  const cut = async (page, name) => {
    const src = await page.video().path();
    await page.close();
    renameSync(src, `${DIR}${name}.webm`);
  };

  // ---- 1. radiology: hanging → paint → measure → 3D → report
  {
    const page = await recPage();
    const waitBoot = () => page.waitForFunction(
      () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
      null, { timeout: 90000 },
    );
    await page.goto(APP(PORT, ''), { waitUntil: 'networkidle' });
    await waitBoot();
    await page.waitForTimeout(1200);

    // hanging: open the lung CT series (lands axial, lung window)
    await page.locator('header.top select[aria-label="Series"]').selectOption('lung-ct-dicom');
    await page.waitForFunction(() => document.getElementById('view-mpr')?.dataset.layout === 'axial', null, { timeout: 60000 });
    await page.waitForTimeout(1200);

    // paint a stroke on the axial pane
    await page.click('#modeseg button[data-mode="paint"]');
    const box = await page.locator('#c-axial').boundingBox();
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 24, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${DIR}paint.png` });

    // watershed split the fresh stroke
    await page.click('#dock-seg button[title="Watershed split at shape necks"]');
    await page.waitForFunction(
      () => document.getElementById('status-text')?.textContent?.includes('basins'),
      null, { timeout: 120000 },
    );
    await page.waitForTimeout(800);

    // measure a length
    await page.click('#modeseg button[data-mode="measure"]');
    await page.mouse.click(box.x + box.width / 2 - 40, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2);
    await page.waitForTimeout(800);

    // 3D surface of the mask, slow orbit drag (the canvas really rotates)
    await page.waitForFunction(
      () => document.getElementById('status-text')?.textContent?.includes('tris'),
      null, { timeout: 120000 },
    );
    const c3 = await page.locator('#view3d').boundingBox();
    if (c3) {
      await page.mouse.move(c3.x + c3.width / 2, c3.y + c3.height / 2);
      await page.mouse.down();
      await page.mouse.move(c3.x + c3.width / 2 + 220, c3.y + c3.height / 2 - 40, { steps: 24 });
      await page.mouse.up();
    }
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${DIR}surface.png` });

    // report
    await page.goto(APP(PORT, 'report'), { waitUntil: 'networkidle' });
    await page.waitForSelector('#title-report', { timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${DIR}report.png` });
    await cut(page, 'radiology');
  }

  // ---- 2. protein: auto-load 1CRN, sequence→3D select, undo, pLDDT paint
  {
    const page = await recPage();
    await page.goto(APP(PORT, 'protein'), { waitUntil: 'networkidle' });
    await page.waitForSelector('#seqstrip button[data-res]', { timeout: 90000 });
    await page.waitForTimeout(800);
    await page.click('#seqstrip button[data-res="0"]');
    await page.waitForSelector('#ro-sel', { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${DIR}protein.png` });
    await page.click('#dock-protein #undogrp button[title="Undo selection"]');
    await page.waitForTimeout(600);
    await page.locator('#dock-protein select[aria-label="Color scheme"]').selectOption('plddt');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${DIR}protein-plddt.png` });
    await cut(page, 'protein');
  }

  // ---- 3. cells: vendored sample store, channel toggle, undo, pyramid level
  {
    const page = await recPage();
    await page.goto(APP(PORT, 'cells'), { waitUntil: 'networkidle' });
    await page.waitForSelector('#chaninfo .mrow', { timeout: 90000 });
    await page.waitForTimeout(800);
    await page.click('#dock-cells button[title="Open the vendored sample store over HTTP (real fetch path)"]');
    await page.waitForFunction(
      () => document.getElementById('storeinfo')?.textContent?.includes('128'),
      null, { timeout: 60000 },
    );
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${DIR}cells-sample.png` });
    await page.locator('input[data-ch="1"]').click();
    await page.waitForTimeout(600);
    await page.click('#dock-cells #undogrp button[title="Undo view change"]');
    await page.waitForTimeout(600);
    await page.locator('#dock-cells select[aria-label="Pyramid level"]').selectOption('1');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${DIR}cells.png` });
    await cut(page, 'cells');
  }

  await browser.close();
  console.log(`DEMO SAVED to ${DIR}`);
} catch (e) {
  failed = 1;
  console.error('DEMO FAIL:', e.message);
} finally {
  server.kill();
  process.exit(failed);
}
