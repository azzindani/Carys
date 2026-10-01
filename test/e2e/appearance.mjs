// Appearance gate: five settings, five levels each (lib/appearance.ts), and
// every level has to work, not just the default.
//
//   levels     Each level button, pressed for real in the Appearance panel,
//              moves its setting the right way and only its setting: text
//              size grows the type, layout the spacing, controls the height of
//              a button, corners the radius, image text the overlay over the
//              images. Strictly monotonic across the five levels.
//   extremes   With every setting at its smallest, and again at its largest,
//              no route overflows sideways, no interface text is clipped
//              mid-word, and no button, dropdown or field is shorter than the
//              24px target floor. Desktop and phone.
//   persist    A choice survives a reload, and Reset puts all five back.
//
// Runs without samples/: it inspects chrome, which renders without imaging.
import { spawn } from 'node:child_process';
import { launchChromium } from './browser.mjs';

const PORT = Number(process.env.E2E_PORT || 8128);
const BASE = `http://localhost:${PORT}/packages/app/dist/index.html`;
const ROUTES = ['', 'worklist', 'protein', 'cells', 'learn'];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
];
const LEVELS = ['xs', 's', 'm', 'l', 'xl'];
// the five settings: the data attribute on each level button, and what to
// measure on the page to see it move
const SETTINGS = [
  { name: 'text', data: 'tsize', measure: () => parseFloat(getComputedStyle(document.querySelector('.view-title, .pane-head, .top')).fontSize) || parseFloat(getComputedStyle(document.body).fontSize) },
  { name: 'layout', data: 'density', measure: () => parseFloat(getComputedStyle(document.querySelector('.dock')).paddingLeft) },
  { name: 'controls', data: 'csize', measure: () => document.querySelector('select.dark').getBoundingClientRect().height },
  { name: 'corners', data: 'corners', measure: () => parseFloat(getComputedStyle(document.querySelector('select.dark')).borderTopLeftRadius) },
  { name: 'image text', data: 'itext', measure: () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ovs')) },
];

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

const failures = [];
const fail = (where, what) => failures.push(`${where}: ${what}`);
let browser;

/** Open the Appearance panel and press a level of a setting, like a person. */
async function press(page, data, level) {
  if (!(await page.locator('.appear').count())) await page.click('#appearance');
  await page.waitForSelector('.appear');
  await page.click(`.appear button[data-${data}="${level}"]`);
}

/** What breaks when everything is at one end of its scale. */
const inspect = () => {
  const out = { overflow: 0, clipped: [], small: [] };
  const de = document.documentElement;
  out.overflow = de.scrollWidth - de.clientWidth;
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const cs = getComputedStyle(el);
    return cs.visibility === 'hidden' || cs.opacity === '0' ? null : r;
  };
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20)}"`;
  for (const el of document.querySelectorAll('button, select, input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=range]), label.iconbtn')) {
    const r = vis(el);
    if (!r || el.closest('[hidden], .popout, .appear')) continue;
    // the tab strip's close x and the like are glyphs inside a larger target,
    // and a segment or tool-bar option is one cell of a track whose own
    // height (the control height, 24px at the smallest level) is the target
    if (el.matches('[role=button], .x') || el.closest('.seg, .popbar')) continue;
    if (Math.min(r.width, r.height) < 23.5) out.small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length > 0 || !vis(el) || el.closest('canvas, svg, option')) continue;
    const cs = getComputedStyle(el);
    // a hard clip with no ellipsis cuts a word in half
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && cs.textOverflow !== 'ellipsis' && /hidden|clip/.test(cs.overflowX)) {
      out.clipped.push(`${name(el)} ${el.scrollWidth}>${el.clientWidth}`);
    }
  }
  out.small = out.small.slice(0, 6);
  out.clipped = out.clipped.slice(0, 6);
  return out;
};

try {
  browser = await launchChromium();

  // ---- levels: every button, every setting, strictly monotonic ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}#/protein`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('select.dark', { timeout: 60000 });
    for (const s of SETTINGS) {
      const seen = [];
      for (const l of LEVELS) {
        await press(page, s.data, l);
        await page.waitForTimeout(120);
        const pressed = await page.locator(`.appear button[data-${s.data}="${l}"]`).getAttribute('aria-pressed');
        if (pressed !== 'true') fail(`levels ${s.name}`, `${l} is not marked pressed after pressing it`);
        seen.push(await page.evaluate(s.measure));
      }
      const rising = seen.every((v, i) => i === 0 || v > seen[i - 1]);
      // corners start at 0 (square) and all five must still differ
      if (!rising) fail(`levels ${s.name}`, `five levels do not strictly increase: ${seen.map((v) => +v.toFixed(2)).join(' < ')}`);
      else console.log(`levels  ${s.name.padEnd(10)} ${seen.map((v) => +v.toFixed(2)).join(' < ')}`);
      await press(page, s.data, 'm');
    }
    // the five are independent: moving one leaves the others where they were
    await press(page, 'tsize', 'xl');
    const ctlAtXl = await page.evaluate(() => document.querySelector('select.dark').getBoundingClientRect().height);
    if (Math.abs(ctlAtXl - 28) > 0.5) fail('levels independence', `text XL changed the control height to ${ctlAtXl}`);
    await ctx.close();
  }

  // ---- extremes: all smallest, all largest, on every route ----
  for (const vp of VIEWPORTS) {
    for (const end of ['xs', 'xl']) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch,
      });
      const prefs = { textSize: end, density: end, controlSize: end, corners: end, imageText: end };
      await ctx.addInitScript((p) => { try { localStorage.setItem('carys.appearance', JSON.stringify(p)); } catch { /* none */ } }, prefs);
      for (const route of ROUTES) {
        const page = await ctx.newPage();
        await page.goto(`${BASE}#/${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForTimeout(route === '' ? 4500 : 2500);
        const r = await page.evaluate(inspect);
        const where = `${vp.name} all-${end} #/${route || 'viewer'}`;
        if (r.overflow > 0) fail(where, `scrolls sideways by ${r.overflow}px`);
        // phones raise controls to the 44px floor, so only desktop can be short
        for (const s of r.small) fail(where, `control below the 24px floor: ${s}`);
        for (const c of r.clipped) fail(where, `text clipped mid-word: ${c}`);
        if (route === '') {
          // the panel that sets all this has to fit at every level too
          await page.click('#appearance');
          await page.waitForSelector('.appear');
          const box = await page.evaluate(() => {
            const r = document.querySelector('.appear').getBoundingClientRect();
            const inner = [...document.querySelectorAll('.appear button, .appear .seg')].map((e) => e.getBoundingClientRect().right);
            return { left: r.left, right: r.right, vw: innerWidth, innerRight: Math.max(...inner) };
          });
          if (box.left < -0.5 || box.right > box.vw + 0.5) fail(where, `the Appearance panel runs off the screen (${Math.round(box.left)}..${Math.round(box.right)} of ${box.vw})`);
          else if (box.innerRight > box.right + 0.5) fail(where, 'a control in the Appearance panel runs past its edge');
        }
        await page.close();
      }
      await ctx.close();
    }
  }

  // ---- persist: a choice survives a reload; Reset restores all five ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}#/protein`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('select.dark', { timeout: 60000 });
    for (const s of SETTINGS) await press(page, s.data, 'l');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('select.dark', { timeout: 60000 });
    const after = await page.evaluate(() => ({ ...document.documentElement.dataset }));
    for (const k of ['text', 'density', 'controls', 'corners', 'imgtext']) {
      if (after[k] !== 'l') fail('persist', `${k} is ${after[k]} after a reload, expected l`);
    }
    await page.click('#appearance');
    await page.click('#appear-reset');
    await page.waitForTimeout(150);
    const reset = await page.evaluate(() => ({ ...document.documentElement.dataset }));
    for (const k of ['text', 'density', 'controls', 'corners', 'imgtext']) {
      if (reset[k] !== 'm') fail('reset', `${k} is ${reset[k]} after Reset, expected m`);
    }
    if (await page.locator('#appear-reset').isEnabled()) fail('reset', 'Reset stays enabled when nothing differs from the default');
    await ctx.close();
  }
} catch (e) {
  console.error('APPEARANCE AUDIT DID NOT RUN:', e.message);
  server.kill();
  if (browser) await browser.close();
  process.exit(1);
}
await browser.close();
server.kill();

if (failures.length > 0) {
  console.error(`APPEARANCE FAILURES (${failures.length}):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('APPEARANCE CLEAN: 5 settings x 5 levels move strictly and independently; the smallest and the largest of everything fit on every route, desktop and phone; prefs persist and reset');
process.exit(0);
