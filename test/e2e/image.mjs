// Production-image gate. Runs against a container built from the Dockerfile,
// the only place deploy/nginx.conf is live: dev and every other e2e suite
// serve the repo with python's http.server, which sends no CSP, no cache
// policy and no compression. A policy that blocks the app, or an image that
// does not start at all (this one did not, until this gate), is invisible to
// all of them.
//
//   docker build -t carys:local . && docker run -d --name carys -p 8080:8080 carys:local
//   CARYS_URL=http://127.0.0.1:8080 node test/e2e/image.mjs
//
// Headers first, over plain HTTP; then a real browser boots the app, visits
// every route and fails on any CSP violation, any request that leaves the
// origin, and any route chunk that does not load. Works with or without
// samples mounted: without them the imaging checks report as skipped, never
// as passed (CODING-STANDARDS §29).
import { launchChromium } from './browser.mjs';

const BASE = (process.env.CARYS_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
const ROUTES = ['atlas', 'protein', 'cells', 'tracks', 'report', 'worklist', 'learn'];
// catalog.ts' boot series and two other formats the image types specially.
const SAMPLE_NII = '/samples/brain_tumor_BraTS19_CBICA_AQN_1_flair.nii';
const SAMPLE_DCM = '/samples/lung_ct_01.dcm';
const SAMPLE_PDB = '/samples/1crn.pdb';

let failed = 0;
let skipped = 0;
const fail = (m) => { failed++; console.error(`IMAGE FAIL: ${m}`); };
const skip = (m) => { skipped++; console.log(`skip  ${m}`); };
const expect = (cond, m) => { if (cond) console.log(`ok    ${m}`); else fail(m); };

/** GET without following redirects; the body is dropped unless asked for. */
async function get(path, { body = false } = {}) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual', headers: { 'accept-encoding': 'gzip' } });
  const text = body ? await res.text() : (await res.body?.cancel(), '');
  const h = (k) => res.headers.get(k) ?? '';
  return { status: res.status, h, text };
}

// ---- 1. HTTP: health, landing, headers, cache, compression, types
const health = await get('/healthz', { body: true });
expect(health.status === 200 && health.text.trim() === 'ok', `/healthz 200 ok (got ${health.status})`);

const root = await get('/');
expect(root.status === 302 && root.h('location') === '/packages/app/dist/', `/ 302 -> ${root.h('location')}`);

const page = await get('/packages/app/dist/', { body: true });
const csp = page.h('content-security-policy');
const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? '';
expect(page.status === 200 && page.h('content-type').startsWith('text/html'), 'app index.html 200 text/html');
expect(page.h('cache-control') === 'no-cache', `index.html revalidates (${page.h('cache-control')})`);
expect(scriptSrc === "'self'", `script-src is 'self' only (${scriptSrc})`);
expect(/frame-ancestors 'none'/.test(csp) && /default-src 'none'/.test(csp), 'CSP denies framing and defaults to none');
// deploy/start.sh renders connect-src from CARYS_CONNECT_SRC; unset, this
const connectSrc = /connect-src ([^;]*)/.exec(csp)?.[1] ?? '';
const wantConnect = `'self' ${process.env.CARYS_CONNECT_SRC ?? 'https: http://localhost:* http://127.0.0.1:*'}`;
expect(connectSrc === wantConnect, `connect-src is ${wantConnect} (${connectSrc})`);
expect(page.h('x-content-type-options') === 'nosniff', 'nosniff');
expect(page.h('referrer-policy') === 'no-referrer', 'no-referrer');
expect(page.h('x-frame-options') === 'DENY', 'X-Frame-Options DENY');
expect(/camera=\(\)/.test(page.h('permissions-policy')), 'Permissions-Policy denies camera');
expect(page.h('cross-origin-opener-policy') === 'same-origin', 'COOP same-origin');
expect(page.h('server') === 'nginx', `server version hidden (${page.h('server')})`);
expect(!/https?:\/\//.test(page.text), 'index.html names no absolute URL');

const entry = /<script type="module"[^>]*src="([^"]+)"/.exec(page.text)?.[1];
const sheet = /<link rel="stylesheet"[^>]*href="([^"]+)"/.exec(page.text)?.[1];
if (!entry || !sheet) fail('index.html has no entry script or stylesheet');
else {
  const js = await get(entry);
  expect(/immutable/.test(js.h('cache-control')) && /max-age=31536000/.test(js.h('cache-control')), `hashed asset immutable (${js.h('cache-control')})`);
  expect(js.h('content-encoding') === 'gzip', 'entry chunk served gzip');
  expect(/javascript/.test(js.h('content-type')), `entry chunk is JavaScript (${js.h('content-type')})`);
  const css = await get(sheet, { body: true });
  expect(!/googleapis|gstatic|url\(["']?https?:/.test(css.text), 'stylesheet pulls nothing off-origin');
  const font = /url\(["']?([^"')]+\.woff2)/.exec(css.text)?.[1];
  if (!font) fail('no bundled woff2 in the stylesheet');
  else {
    const f = await get(new URL(font, `${BASE}${sheet}`).pathname);
    expect(f.status === 200 && f.h('content-type') === 'font/woff2' && !f.h('content-encoding'), 'bundled font 200 font/woff2, not re-gzipped');
  }
}
const missing = await get('/packages/app/dist/assets/missing-00000000.js');
expect(missing.status === 404 && !/immutable/.test(missing.h('cache-control')), 'a missing hashed asset 404s and is not cached as immutable');
expect(missing.h('content-security-policy') !== '', 'error responses still carry the CSP');

const terms = await get('/digests/bodyparts3d-terms/terms.json');
expect(terms.status === 200 && terms.h('content-encoding') === 'gzip', `digests served, gzip (${terms.status})`);
const mesh = await get('/digests/bodyparts3d-longbones/FJ1282.mz3');
expect(mesh.h('content-type') === 'application/x-mz3' && mesh.h('content-encoding') === 'gzip', `.mz3 typed + gzip (${mesh.h('content-type')})`);

const samples = [
  [SAMPLE_NII, 'application/x-nifti', true],
  [SAMPLE_DCM, 'application/dicom', true],
  [SAMPLE_PDB, 'chemical/x-pdb', true],
];
let haveSamples = true;
for (const [path, type, gz] of samples) {
  const s = await get(path);
  if (s.status === 404) { haveSamples = false; skip(`${path}: samples/ not mounted`); continue; }
  expect(s.h('content-type') === type, `${path} is ${type} (${s.h('content-type')})`);
  expect(!gz || s.h('content-encoding') === 'gzip', `${path} gzip`);
  expect(/^private/.test(s.h('cache-control')), `${path} private cache (${s.h('cache-control')})`);
}

// ---- 2. Browser: the app under its real policy
const browser = await launchChromium();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage();
  await pg.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`Content Security Policy violation: ${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });
  pg.on('console', (m) => { if (/content.security.policy/i.test(m.text())) fail(`CSP: ${m.text().slice(0, 300)}`); });
  pg.on('pageerror', (e) => fail(`pageerror: ${String(e).slice(0, 300)}`));
  pg.on('request', (r) => {
    if (!r.url().startsWith(ORIGIN) && !/^(data|blob):/.test(r.url())) fail(`request left the origin: ${r.url()}`);
  });
  // A missing sample is a fixture gap for `npm run verify` to fail on, not an
  // image fault: it is counted and reported as a skip. Anything else that
  // 4xxes (a chunk, a font, a digest) is the image's own and fails here.
  const missingSamples = new Set();
  const chunks = new Set();
  pg.on('response', (r) => {
    const p = new URL(r.url()).pathname;
    if (r.status() < 400) {
      if (p.includes('/assets/')) chunks.add(p.split('/').pop());
      return;
    }
    if (p.startsWith('/samples/')) missingSamples.add(p);
    else fail(`${r.status()} ${p}`);
  });

  await pg.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  expect(pg.url() === `${BASE}/packages/app/dist/`, `browser lands on the app (${pg.url()})`);
  if (haveSamples) {
    await pg.waitForFunction(() => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''), null, { timeout: 90000 })
      .then(() => console.log('ok    viewer booted and loaded the default series'), () => fail('viewer never loaded the default series'));
  } else skip('viewer series load: samples/ not mounted');
  const fonts = await pg.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`);
  });
  expect(fonts.includes('Inter 400'), `bundled Inter loaded (${fonts.join(', ')})`);
  // Radix portals and positions popovers and tooltips; a <style> element any
  // of it injected would trip style-src 'self' right here.
  await pg.click('#appearance');
  const pop = await pg.waitForSelector('[data-radix-popper-content-wrapper]', { timeout: 5000 }).then(() => true, () => false);
  await pg.keyboard.press('Escape');
  await pg.hover('.rail-btn');
  const tip = await pg.waitForSelector('.tip', { timeout: 5000 }).then(() => true, () => false);
  expect(pop && tip, 'Radix popover and tooltip open under the CSP');

  for (const route of ROUTES) {
    await pg.goto(`${BASE}/packages/app/dist/#/${route}`, { waitUntil: 'networkidle' });
    // Rendered = the view replaced the Suspense stub. Not a view-specific
    // selector: with nothing loaded, Report renders a bare hint, not a title.
    // The load-failure card is a .route-stub too, so it fails this as well.
    const rendered = await pg.waitForFunction(() => {
      const v = document.querySelector('.viewport');
      return v !== null && v.childElementCount > 0 && v.querySelector('.route-stub') === null;
    }, null, { timeout: 30000 }).then(() => true, () => false);
    // …and it arrived as its own chunk (atlas -> AtlasView-<hash>.js).
    const view = `${route[0].toUpperCase()}${route.slice(1)}View-`;
    const split = [...chunks].some((c) => c.startsWith(view));
    expect(rendered && split, `#/${route} chunk loaded and rendered`);
  }
  if (haveSamples) {
    // The zarr path end to end: dotfile metadata as JSON, extensionless chunks.
    await pg.goto(`${BASE}/packages/app/dist/#/cells`, { waitUntil: 'networkidle' });
    await pg.locator('button', { hasText: 'Sample .zarr' }).click();
    await pg.waitForFunction(() => /\dch/.test(document.getElementById('ro-cells')?.textContent ?? ''), null, { timeout: 30000 })
      .then(() => console.log('ok    sample OME-Zarr store opened over HTTP'), () => fail('sample OME-Zarr store did not open'));
  } else skip('OME-Zarr open: samples/ not mounted');
  // With nothing mounted the skips above already say so; a partial mount
  // names each file it lacks.
  if (haveSamples) for (const p of missingSamples) skip(`${p}: not in the mounted samples/`);
} finally {
  await browser.close();
}

console.log(`# failed ${failed}  skipped ${skipped}`);
if (failed > 0) process.exit(1);
console.log('IMAGE PASS');
