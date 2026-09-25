// Visual e2e: serve repo root, screenshot shell states with headless Chromium.
// Run: npm run test:shots (needs Playwright Chromium: npx playwright install chromium).
// Shots land in test/e2e/shots/ (gitignored) for human + model review.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = Number(process.env.E2E_PORT || 8124);
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

let failed = 0;
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`http://localhost:${PORT}/packages/ui/index.html`, { waitUntil: 'networkidle' });
  // wait for first axial paint (ro chip carries the slice tag)
  await page.waitForFunction(
    () => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''),
    null, { timeout: 60000 },
  );
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: SHOTS + '01-mpr.png' });

  // paint a stroke on axial, screenshot with overlay
  await page.click('#modeseg button[data-mode="paint"]');
  const box = await page.locator('#c-axial').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx - 40, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 20, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: SHOTS + '02-painted.png' });

  // 3D surface view (static shell keeps the Slices/3D switcher)
  await page.click('.rail button[data-view="3d"]');
  await page.waitForFunction(
    () => document.getElementById('status-text')?.textContent?.includes('tris'),
    null, { timeout: 120000 },
  );
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: SHOTS + '03-3d.png' });

  // command palette
  await page.keyboard.press('Control+k');
  await page.fill('#palinput', 'lung');
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: SHOTS + '04-palette.png' });

  const actionable = errors.filter((e) => !e.includes('fonts.g'));
  if (actionable.length > 0) {
    console.error('PAGE ERRORS:\n' + actionable.join('\n'));
    failed = 1;
  } else {
    console.log('SHOTS PASS (no page errors)');
  }
  await browser.close();
} catch (e) {
  failed = 1;
  console.error('SHOTS FAIL:', e.message);
} finally {
  server.kill();
  process.exit(failed);
}
