// E2E on generated samples only: the legs a fresh clone — and CI, whose
// runner has no samples/ — can run after `npm run gen:samples`. Everything
// here reads what the repo's own generators write (the head phantom as NIfTI
// under the BraTS and skull names, the same head as a 120-slice DICOM series,
// OME-Zarr cells and a plate), and nothing here depends on which set is
// mounted, so it passes the same on the real one. Legs that need real
// imaging stay in wire.mjs, journeys.mjs and geometry.mjs.
//
//   npm run gen:samples     (fresh clone only: it writes over the real names)
//   npm run build:app && npm run test:synthetic
//
// CARYS_URL runs the same legs against a deployment instead of a local
// server: CARYS_URL=https://carys.casava.space npm run test:synthetic. Behind
// the access gate, add CARYS_ACCESS_KEY: the suite logs in once with
// ?token= and every leg carries the session cookie that login set.
//
// Fails loud, prints PASS.
// NOTE: waitForSelector takes (selector, options) — TWO args.
import { spawn } from 'node:child_process';
import { launchChromium } from './browser.mjs';
import { openPop } from './popout.mjs';

const PORT = Number(process.env.E2E_PORT || 8134);
const REMOTE = process.env.CARYS_URL?.replace(/\/$/, '');
const BASE = `${REMOTE ?? `http://localhost:${PORT}`}/packages/app/dist/index.html`;
const server = REMOTE ? null : spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], { stdio: 'ignore' });
if (server) await new Promise((r) => setTimeout(r, 1500));

/** Catalog entries whose files a generator writes (SeriesSpec.gen). */
const GENERATED = ['brats-flair-seg', 'skull-seg', 'skull-ct-bone', 'ct-head-dicom'];

let failed = 0;
const fail = (msg) => {
  failed = 1;
  console.error(`SYNTHETIC FAIL: ${msg}`);
};

let browser;
try {
  browser = await launchChromium();
  let session = [];
  const key = process.env.CARYS_ACCESS_KEY;
  if (REMOTE && key) {
    const login = await browser.newContext();
    await (await login.newPage()).goto(`${REMOTE}/?token=${key}`, { waitUntil: 'domcontentloaded' });
    session = (await login.cookies()).filter((c) => c.name === 'carys_session');
    await login.close();
    if (session.length === 0) throw new Error('the ?token= login set no carys_session cookie');
  }
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    if (session.length) await ctx.addCookies(session);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => fail(`pageerror: ${(e.stack || String(e)).slice(0, 600)}`));
    return pg;
  };

  // ---- 1. Boot: the viewer opens the first catalog series (the head
  // phantom under the BraTS name) in all three planes and extracts a surface.
  const boot = await newPage();
  await boot.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await boot.waitForFunction(
    () => ['axial', 'coronal', 'sagittal'].every((p) => /^\d+ \/ \d+/.test(document.getElementById(`ro-${p}`)?.textContent ?? '')),
    null, { timeout: 90000 },
  );
  const bootTris = await (await boot.waitForFunction(
    () => document.getElementById('ro-3d')?.textContent?.match(/^([\d,]+) tris/)?.[1] ?? false,
    null, { timeout: 90000 },
  )).jsonValue();
  if (!(Number(bootTris.replace(/,/g, '')) > 0)) fail(`boot surface empty: ${bootTris}`);
  else console.log(`boot: three planes (${await boot.locator('#ro-axial').textContent()}), ${bootTris} tris`);

  // ---- 2. The keyboard drives the viewport: Tab alone reaches the axial
  // slice control, and ArrowUp moves the slice the readout reports.
  let tabs = 0;
  while (tabs < 250 && await boot.evaluate(() => document.activeElement?.id) !== 's-axial') {
    await boot.keyboard.press('Tab');
    tabs++;
  }
  if (tabs >= 250) fail('Tab never reaches the axial slice control');
  else {
    const sliceBefore = await boot.locator('#ro-axial').textContent();
    await boot.keyboard.press('ArrowUp');
    await boot.waitForFunction((b) => document.getElementById('ro-axial')?.textContent !== b, sliceBefore, { timeout: 10000 })
      .catch(() => fail(`ArrowUp on the focused axial slider left the slice at ${sliceBefore}`));
    console.log(`keyboard: ${tabs} Tabs reach the axial slider; ArrowUp ${sliceBefore} -> ${await boot.locator('#ro-axial').textContent()}`);
  }
  await boot.close();

  // ---- 3. DICOM → 3D: the 120-slice CT series (gen:ct) opens through the
  // DICOM lane and extracts a surface with no mask: the source falls back to
  // the image, the Hounsfield cut lands on the bone preset, and the skin
  // preset cuts a different surface at -300 HU.
  const ct = await newPage();
  await ct.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await ct.click('#openpal'); await ct.fill('#palinput', 'ct-head-dicom');
  await ct.waitForSelector('#pallist li'); await ct.click('#pallist li');
  await ct.waitForFunction(
    () => document.querySelector('#filetabs [data-tab="ct-head-dicom"][data-active="true"]'),
    null, { timeout: 60000 },
  );
  const trisOf = (t) => Number((t?.match(/^([\d,]+) tris/)?.[1] ?? '0').replace(/,/g, ''));
  // the threshold chip moves at the click; the tri readout keeps the old
  // surface until the new one lands, so a later cut waits for new text
  const ctRead = async (hu, before) => (await ct.waitForFunction(([want, old]) => {
    const t = document.getElementById('ro-3d')?.textContent ?? '';
    return document.getElementById('tval')?.textContent === String(want) && /^[\d,]+ tris/.test(t) && t !== old ? t : false;
  }, [hu, before], { timeout: 120000 })).jsonValue();
  const boneText = await ctRead(300, null);
  const boneTris = trisOf(boneText);
  if (!(boneTris > 0)) fail(`DICOM CT bone surface empty: ${boneTris}`);
  if (await ct.locator('#srcseg button[data-s="image"]').getAttribute('aria-pressed') !== 'true') fail('DICOM CT 3D source is not the image');
  if (await ct.locator('#ctpreset button[data-ct="bone"]').getAttribute('aria-pressed') !== 'true') fail('the Hounsfield default does not press the bone preset');
  await openPop(ct, '3d');
  await ct.click('#ctpreset button[data-ct="skin"]');
  const skinTris = trisOf(await ctRead(-300, boneText));
  if (!(skinTris > 0 && skinTris !== boneTris)) fail(`skin preset: ${skinTris} tris vs bone ${boneTris}`);
  else console.log(`DICOM -> 3D: ct-head-dicom bone ${boneTris.toLocaleString('en-US')} tris, skin ${skinTris.toLocaleString('en-US')} tris`);
  await ct.close();

  // ---- 4. The worklist says which studies open here: the generated ones
  // carry no chip, every other row says what fills it, and the title's count
  // is the rows without one.
  const wl = await newPage();
  await wl.goto(`${BASE}#/worklist`, { waitUntil: 'networkidle' });
  await wl.waitForSelector('#wl-avail', { timeout: 60000 });
  const title = await wl.locator('#wl-avail').textContent();
  const rows = await wl.locator('.wl-row').evaluateAll((els) => els.map((r) => [
    r.querySelector('.wl-key')?.textContent ?? '', r.querySelector('.wl-missing')?.textContent ?? null,
  ]));
  const [, open, total] = title?.match(/^(\d+) of (\d+) can open here$/) ?? [];
  const present = rows.filter(([, chip]) => chip === null).map(([k]) => k);
  if (Number(total) !== rows.length) fail(`worklist title counts ${total} series, ${rows.length} rows: ${title}`);
  if (Number(open) !== present.length) fail(`worklist title says ${open} open, ${present.length} rows have no chip: ${title}`);
  for (const k of GENERATED) if (!present.includes(k)) fail(`generated entry ${k} is marked missing`);
  for (const [k, chip] of rows) {
    if (chip !== null && chip !== 'needs real data' && !/^npm run gen:[a-z]+$/.test(chip)) fail(`${k}: chip "${chip}" names no way to fill it`);
  }
  console.log(`worklist: ${title}; ${rows.length - present.length} rows say what fills them`);
  await wl.close();
} catch (e) {
  fail(`exception: ${(e.stack || String(e)).slice(0, 800)}`);
} finally {
  if (browser) await browser.close();
  server?.kill();
}
if (!failed) console.log('SYNTHETIC PASS');
process.exit(failed ? 1 : 0);
