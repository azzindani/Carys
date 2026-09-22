// Mobile UI/UX audit: 390x844 touch viewport across every route.
// Manual run: npm run audit:mobile → console report + /tmp/opencode/mob-*.png.
// Not a gate (asserts nothing); a human/model reads the report + shots.
import { spawn } from 'node:child_process';
import { chromium, devices } from 'playwright';

const PORT = Number(process.env.E2E_PORT || 8126);
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

const auditRoute = async (browser, hash, shot) => {
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`); });
  await page.goto(`http://localhost:${PORT}/packages/app/dist/index.html#/${hash}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(6000);
  const rep = await page.evaluate(() => {
    const de = document.documentElement;
    const overflowX = de.scrollWidth - de.clientWidth;
    const small = [];
    for (const el of document.querySelectorAll('button, select, input, a, [role="button"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (getComputedStyle(el).opacity === '0' || getComputedStyle(el).visibility === 'hidden') continue;
      const t = Math.min(r.width, r.height);
      if (t > 0 && t < 24) small.push(`${el.tagName.toLowerCase()}#${el.id || ''}.${(el.className?.baseVal ?? el.className ?? '').toString().split(' ')[0]} ${Math.round(r.width)}x${Math.round(r.height)} "${el.textContent?.trim().slice(0, 18)}"`);
    }
    const offscreen = [];
    for (const el of document.querySelectorAll('.top, .top > *, .dock, .pane, .pane canvas, .inspector, .view-title')) {
      const r = el.getBoundingClientRect();
      if (r.right > de.clientWidth + 1) offscreen.push(`${el.className.toString().split(' ')[0]}#${el.id} overflows by ${Math.round(r.right - de.clientWidth)}px`);
    }
    return {
      overflowX,
      innerWidth: window.innerWidth,
      smallTargets: small.slice(0, 14),
      smallCount: small.length,
      offscreen: offscreen.slice(0, 10),
    };
  });
  if (hash === '') {
    // touch-paint regression guard (sticky-dock overlap broke this once):
    // a real touchscreen tap must stamp voxels, not hit chrome. Mobile IA:
    // switch to the axial viewport, open the Tools panel, then tap.
    try {
      const vox = () => page.evaluate(() => {
        const dd = [...document.querySelectorAll('#maskinfo dd')];
        const v = dd.find((d) => /^\d[\d,]*$/.test(d.textContent.trim()));
        if (v) return v.textContent.trim();
        const m = document.getElementById('m-vox')?.textContent?.match(/([\d,]+) vox/);
        return m ? m[1] : '(none)';
      });
      await page.click('#mviewseg button[data-mview="axial"]');
      await page.click('#mobilebar button:has-text("Tools")');
      await page.click('#mpanel-tools #modeseg button[data-mode="paint"]');
      await page.locator('#c-axial').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const box = await page.locator('#c-axial').boundingBox();
      const tx = box.x + box.width / 2, ty = box.y + box.height / 2;
      const hit = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el ? `${el.tagName}#${el.id}` : 'NONE';
      }, [tx, ty]);
      const before = await vox();
      await page.touchscreen.tap(tx, ty);
      await page.waitForTimeout(1500);
      const after = await vox();
      console.log(`touch paint: target=${hit} vox ${before} -> ${after}`);
      if (hit !== 'CANVAS#c-axial' || before === after) {
        errors.push(`touch paint broken (target=${hit} vox ${before}->${after})`);
      }
    } catch (e) {
      errors.push(`touch paint probe failed: ${e.message.slice(0, 120)}`);
    }
  }
  await page.screenshot({ path: `/tmp/opencode/mob-${shot}.png` });
  console.log(`\n### #/${hash}`);
  console.log(`overflow-x: ${rep.overflowX}px (viewport ${rep.innerWidth})`);
  console.log(`tap targets <24px: ${rep.smallCount}` + (rep.smallTargets.length ? `\n  - ${rep.smallTargets.join('\n  - ')}` : ''));
  console.log(`offscreen blocks: ${rep.offscreen.length ? `\n  - ${rep.offscreen.join('\n  - ')}` : ' none'}`);
  console.log(`errors: ${errors.length ? `\n  - ${errors.join('\n  - ')}` : ' none'}`);
  await ctx.close();
  return errors;
};

let failed = 0;
const failures = [];
try {
  const browser = await chromium.launch();
  for (const [hash, shot] of [['', 'viewer'], ['worklist', 'worklist'], ['report', 'report'], ['protein', 'protein'], ['cells', 'cells'], ['tracks', 'tracks']]) {
    for (const e of await auditRoute(browser, hash, shot)) failures.push(`#/${hash}: ${e.slice(0, 140)}`);
  }
  await browser.close();
} catch (e) {
  failed = 1;
  console.error('AUDIT FAIL:', e.message);
} finally {
  server.kill();
  if (failures.length > 0) {
    console.error(`AUDIT FAILURES (${failures.length}):\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
  }
  // A crash means nothing was measured, so it is not "clean" — the exit code
  // was always right here, but the last line said CLEAN either way, which is
  // the line a person reads.
  if (failed) {
    console.error('MOBILE AUDIT DID NOT RUN — nothing was measured (see AUDIT FAIL above)');
    process.exit(failed);
  }
  console.log('MOBILE AUDIT CLEAN');
  process.exit(0);
}
