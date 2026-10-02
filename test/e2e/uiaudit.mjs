// UI conformance gate: every route, mode and panel state, at every kind of
// screen, against the design system.
//
// a11y.mjs (axe) and appearance.mjs (the five scales) look at one resting state
// of each route. A person meets a lot more than that: a pop-out open, a tool
// picked, a drawer out, a dialog over the image. Each of those is a layout
// nobody drew a picture of, and it is where the misses live. This drives
// them all and asserts, in each:
//
//   layout   no sideways page scroll; no control or panel off the screen;
//            no control covered by something else; no text clipped mid-word;
//            no control cut off by a container that cannot be scrolled to it
//            (the page itself being one: a phone's Studies and Learn pages
//            could not scroll at all for want of this check)
//   phone    the previewer is on top, fully on screen and not squeezed, no
//            control sits above it (the file tabs, its own header and the top
//            bar excepted), and every control of a deck is in the lower part of
//            the screen, where a thumb is
//   scroll   a page that is longer than the screen scrolls when the wheel
//            turns over it
//   system   every font size is on the type ramp, every radius on the radius
//            ramp, every family Inter or Plex Mono, and every colour a palette
//            colour (token values read back from the page, so a token change
//            moves the check with it, and a literal in a stylesheet shows up)
//   rows     controls that share a row share one height and one centre line
//   targets  nothing a finger or mouse must hit is under the 24px floor
//   a11y     axe, WCAG 2.1 A+AA, zero violations
//
// Runs without samples/ (states that need an image skip, loudly, rather than
// pass on nothing): fixtures it needs - a protein, a BED track - are written
// to a temp dir here. UIAUDIT_SHOTS=dir keeps a screenshot of every state;
// UIAUDIT_VP=desktop,laptop,tablet,tabletP,phone,small,landscape runs all seven
// screens (the default is the three that differ most), UIAUDIT_ONLY=regex a subset.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChromium } from './browser.mjs';
import { STATES } from './uistates.mjs';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');
const PORT = Number(process.env.E2E_PORT || 8129);
const BASE = `http://localhost:${PORT}/packages/app/dist/index.html`;
const SHOTS = process.env.UIAUDIT_SHOTS || '';
const ONLY = process.env.UIAUDIT_ONLY ? new RegExp(process.env.UIAUDIT_ONLY) : null;
const VIEWPORTS = (process.env.UIAUDIT_VP || 'desktop,tablet,phone').split(',');
const ALL_VP = {
  desktop: { width: 1440, height: 900, touch: false },
  laptop: { width: 1280, height: 720, touch: false },
  tablet: { width: 1024, height: 768, touch: true, mobile: false },
  tabletP: { width: 820, height: 1180, touch: true, mobile: true },
  phone: { width: 390, height: 844, touch: true, mobile: true },
  small: { width: 360, height: 640, touch: true, mobile: true },
  landscape: { width: 844, height: 390, touch: true, mobile: true },
};
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// ---- fixtures: small, synthetic, written here ----------------------------
const dir = mkdtempSync(join(tmpdir(), 'uiaudit-'));
const fx = {};
{
  // a 36-residue alpha helix, backbone + one side-chain atom, one HETATM
  const aa = ['ALA', 'LEU', 'GLU', 'LYS', 'SER', 'VAL'];
  const lines = ['HEADER    SYNTHETIC HELIX                         01-JAN-26   UIAU'];
  let n = 1;
  for (let i = 0; i < 36; i++) {
    const t = i * 100 * (Math.PI / 180);
    const x = 2.3 * Math.cos(t), y = 2.3 * Math.sin(t), z = 1.5 * i;
    const res = aa[i % aa.length];
    for (const [name, dx, dy, dz, el] of [['N', -0.6, 0.2, -0.5, 'N'], ['CA', 0, 0, 0, 'C'], ['C', 0.7, -0.3, 0.5, 'C'], ['O', 1.2, -0.5, 0.9, 'O'], ['CB', 0.2, 0.9, -0.3, 'C']]) {
      lines.push(`ATOM  ${String(n++).padStart(5)} ${name.padEnd(4)} ${res} A${String(i + 1).padStart(4)}    ${(x + dx).toFixed(3).padStart(8)}${(y + dy).toFixed(3).padStart(8)}${(z + dz).toFixed(3).padStart(8)}  1.00 20.00           ${el}`);
    }
  }
  lines.push('HELIX    1   1 ALA A    1  LYS A   36  1                                  36', 'END');
  fx.pdb = join(dir, 'helix.pdb');
  writeFileSync(fx.pdb, lines.join('\n'));
  fx.bed = join(dir, 'uiaudit.bed');
  writeFileSync(fx.bed, ['chr1\t100\t200\tgeneA\t0\t+', 'chr1\t300\t400\tgeneB\t0\t-', 'chr1\t800\t900\tgeneC\t0\t+', 'chr2\t100\t250\tgeneD\t0\t+', 'chr2\t300\t400\tgeneE\t0\t-'].join('\n'));
  fx.dicom = join('samples', 'ct-head-series');
  fx.nii = join('samples', 'skull_case_0001_img.nii');
}
const haveSamples = existsSync('samples/ct-head-series') && existsSync('samples/skull_case_0001_img.nii');

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

/** What the page looks like, measured in the page. Returns plain data. */
const measure = (arg) => {
  const out = { overflow: 0, off: [], covered: [], clipped: [], small: [], rows: [], type: {}, radius: {}, family: {}, color: {}, odd: [], cut: [], stage: [] };
  const de = document.documentElement;
  out.overflow = de.scrollWidth - de.clientWidth;
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const cs = getComputedStyle(el);
    return cs.visibility === 'hidden' || cs.opacity === '0' || cs.display === 'none' ? null : r;
  };
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''} "${(el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22)}"`;
  const px = (v) => parseFloat(v);

  // ---- the design system, read back from the page ----
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const resolve = (prop, value) => { probe.style[prop] = ''; probe.style[prop] = value; return getComputedStyle(probe)[prop]; };
  const root = getComputedStyle(document.documentElement);
  const ovs = parseFloat(root.getPropertyValue('--ovs')) || 1;
  const ramp = new Set();
  for (const k of ['3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']) ramp.add(+px(resolve('fontSize', `var(--fs-${k})`)).toFixed(2));
  // insets are px, or the layout scale's steps (a seg thumb inside its track)
  const insets = [1, 2, 3, 4, 5, 6, 8, ...[1, 2, 3, 4].map((k) => px(resolve('width', `var(--sp-${k})`)))];
  const rr = new Set([0]);
  for (const k of ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl']) {
    const v = px(resolve('borderTopLeftRadius', `var(--radius-${k})`));
    rr.add(+v.toFixed(2));
    // a nested surface is the parent's radius less its inset
    for (const inset of insets) rr.add(+Math.max(0, v - inset).toFixed(2));
  }
  const pal = new Set();
  for (const k of ['stage', 'bg', 'chrome', 'sunken', 'surface-1', 'surface-2', 'surface-3', 'surface-4', 'line', 'line-strong', 'line-hover', 'line-accent', 'text', 'muted', 'faint', 'on-accent', 'accent', 'accent-hi', 'accent-lo', 'accent-dim', 'accent-a', 'violet', 'danger', 'danger-dim', 'warn', 'warn-dim', 'ok', 'ok-dim', 'scrim']) {
    const c = resolve('color', `var(--color-${k})`);
    const m = c.match(/[\d.]+/g);
    if (m) pal.add(m.slice(0, 3).map((n) => Math.round(+n)).join(','));
  }
  pal.add('0,0,0'); pal.add('255,255,255');
  const ctlH = px(resolve('height', 'var(--ctl-h)')) || 28;
  const chipH = px(resolve('height', 'var(--chip-h)')) || ctlH;
  probe.remove();
  const rgbKey = (c) => {
    const m = c.match(/[\d.]+/g);
    if (!m) return null;
    const k = c.startsWith('color(') ? 255 : 1; // color(srgb r g b / a) is 0..1
    return m.slice(0, 3).map((n) => Math.round(+n * k)).join(',');
  };
  // a colour-mix of palette colours (glass, hover tints) is a blend, not a literal: accept
  // anything within a palette colour's neighbourhood only when it is translucent
  const alphaOf = (c) => { const m = c.match(/[\d.]+/g); return m && m.length > 3 ? +m[3] : 1; };
  // data colours (segment labels, colormap ramps) are the data's, not the interface's
  const data = (el) => !!el.closest('.lblswatch, .swatch, .sw, .cmap, .legend');
  const note = (bag, key, el, extra = '') => { const a = (bag[key] ||= { n: 0, ex: [] }); a.n++; if (a.ex.length < 2) a.ex.push(name(el) + extra); };

  const FLOATING = '.inspector, .popout, .appear, .pal-wrap, .sheet, .sheet-scrim, [role=dialog], [role=listbox], [role=menu], [data-radix-popper-content-wrapper], .toast, .hint-pop, [role=tooltip]';
  /** a control scrolled out of its own scroller is not under what shows there */
  const clippedByScroller = (el, x, y) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (/auto|scroll|hidden|clip/.test(o.overflowY + o.overflowX)) {
        const b = p.getBoundingClientRect();
        if (x < b.left || x > b.right || y < b.top || y > b.bottom) return true;
      }
    }
    return false;
  };
  const controls = [...document.querySelectorAll('button, select, input:not([type=hidden]):not([type=file]), a[href], [role=button], [role=tab], [role=switch], textarea')];
  /** containers that scroll sideways on purpose */
  const HSTRIP = '[data-hscroll]';
  /** Is this control cut off by an ancestor that a person cannot scroll to
   *  bring it back? A scroller that is long enough to scroll is fine for a
   *  control below or above its box; `overflow: hidden` (or a scroller with
   *  nothing to scroll) is not, and neither is anything off to the side. */
  const unreachable = (el, r) => {
    let cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const o = getComputedStyle(a);
      if (o.position === 'fixed') return null; // lifted out of the flow: nothing above it clips it
      if (!/hidden|clip|auto|scroll/.test(o.overflowX + o.overflowY)) continue;
      const b = a.getBoundingClientRect();
      const outX = cx < b.left - 1 || cx > b.right + 1, outY = cy < b.top - 1 || cy > b.bottom + 1;
      if (!outX && !outY) continue;
      const canY = /auto|scroll/.test(o.overflowY) && a.scrollHeight > a.clientHeight + 1;
      const canX = /auto|scroll/.test(o.overflowX) && a.scrollWidth > a.clientWidth + 1 && a.matches(HSTRIP);
      if (outY && !canY) return `cut off by ${name(a)} (y ${Math.round(r.top)}..${Math.round(r.bottom)} outside ${Math.round(b.top)}..${Math.round(b.bottom)}, not scrollable)`;
      if (outX && !canX) return `cut off by ${name(a)} (x ${Math.round(r.left)}..${Math.round(r.right)} outside ${Math.round(b.left)}..${Math.round(b.right)})`;
      // This scroller can bring it into view, so from here up the control
      // counts as sitting at the scroller's edge: whatever clips the scroller
      // is judged on the scroller, not on where the control is now scrolled to.
      cx = Math.min(b.right, Math.max(b.left, cx));
      cy = Math.min(b.bottom, Math.max(b.top, cy));
    }
    return null;
  };
  /** the part of a box that shows: clipped by every ancestor that clips */
  const shown = (el) => {
    let r = el.getBoundingClientRect();
    let [l, t, rt, bt] = [Math.max(0, r.left), Math.max(0, r.top), Math.min(innerWidth, r.right), Math.min(innerHeight, r.bottom)];
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const o = getComputedStyle(a);
      if (o.position === 'fixed') break;
      if (!/hidden|clip|auto|scroll/.test(o.overflowX + o.overflowY)) continue;
      const b = a.getBoundingClientRect();
      [l, t, rt, bt] = [Math.max(l, b.left), Math.max(t, b.top), Math.min(rt, b.right), Math.min(bt, b.bottom)];
    }
    return { w: Math.max(0, rt - l), h: Math.max(0, bt - t), top: t, bottom: bt };
  };

  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('canvas, option, [hidden]') || el.matches('script, style, canvas, option')) continue;
    const r = vis(el);
    if (!r) continue;
    const cs = getComputedStyle(el);
    const inOverlay = !!el.closest('.vp-ov, .vp-ov-wrap');
    // type: only elements that own text
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (own && !el.closest('svg')) {
      const fs = +px(cs.fontSize).toFixed(2);
      const ok = ramp.has(fs) || (inOverlay && [11, 11.5, 12, 13].some((v) => Math.abs(v * ovs - fs) < 0.3)) || [...ramp].some((v) => Math.abs(v - fs) < 0.05);
      if (!ok) note(out.type, `${fs}px`, el);
      const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (fam !== 'Inter' && fam !== 'IBM Plex Mono') note(out.family, fam, el);
      const c = rgbKey(cs.color);
      if (c && !pal.has(c)) note(out.color, `text ${cs.color}`, el);
    }
    // radius: each corner on the ramp (50% and pills are shape, not rounding)
    for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']) {
      const v = cs[corner];
      if (v.includes('%')) continue;
      const n = px(v);
      if (n >= 500) continue;
      if (!rr.has(+n.toFixed(2)) && ![...rr].some((q) => Math.abs(q - n) < 0.06)) note(out.radius, `${+n.toFixed(2)}px`, el);
    }
    const bg = cs.backgroundColor;
    if (bg !== 'rgba(0, 0, 0, 0)' && alphaOf(bg) > 0.02 && !data(el)) {
      const c = rgbKey(bg);
      if (c && !pal.has(c) && alphaOf(bg) >= 0.98) note(out.color, `bg ${bg}`, el);
    }
    if (px(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') {
      const c = rgbKey(cs.borderTopColor);
      if (c && !pal.has(c) && alphaOf(cs.borderTopColor) >= 0.98) note(out.color, `border ${cs.borderTopColor}`, el);
    }
  }

  // ---- layout ----
  for (const el of controls) {
    const r = vis(el);
    if (!r || el.closest('[hidden]')) continue;
    if (r.right > innerWidth + 1 || r.left < -1) {
      // a control in a strip that is meant to scroll sideways is not off the
      // screen. The page's own scroller is not such a strip: it let a title
      // row of four buttons run 40px off a phone's edge, unseen.
      let p = el.parentElement, scrolled = false;
      while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth && p.matches(HSTRIP)) { scrolled = true; break; } p = p.parentElement; }
      if (!scrolled) out.off.push(`${name(el)} x=${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    // cut off by a container with no way to scroll it into view
    const why = unreachable(el, r);
    if (why) out.cut.push(`${name(el)} ${why}`);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight && !clippedByScroller(el, cx, cy)) {
      const hit = document.elementFromPoint(cx, cy);
      // an open panel, menu or dialog is meant to sit over what is under it
      if (hit && !hit.closest(FLOATING) && hit !== el && !el.contains(hit) && !hit.contains(el) && !(hit.closest('label') && hit.closest('label').contains(el))) out.covered.push(`${name(el)} under ${name(hit)}`);
    }
    // hit target
    if (el.matches('[role=button], .x') || el.closest('.seg, .popbar, .sw, .swatch') || el.type === 'range' || el.type === 'checkbox' || el.type === 'radio') continue;
    if (Math.min(r.width, r.height) < 23.5) out.small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    // a control that is none of the system heights
    if (el.matches('button, select, input:not([type=range])') && !el.closest('.seg, .popbar, .pal, .seqstrip, [role=tablist], .kv, .vrail, .toolstrip, .pane-head, .tile, .wl-row, .swatches, .tabs, .rail') && !el.matches('.tab, .lnk, .linkbtn')) {
      const known = [ctlH, ctlH - 6, Math.max(24, ctlH), chipH];
      if (!known.some((h) => Math.abs(h - r.height) < 1.01)) out.odd.push(`${name(el)} h=${Math.round(r.height * 10) / 10} (system ${ctlH})`);
    }
  }
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length > 0 || el.closest('canvas, svg, option, [hidden]') || !vis(el)) continue;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && cs.textOverflow !== 'ellipsis' && /hidden|clip/.test(cs.overflowX)) out.clipped.push(`${name(el)} ${el.scrollWidth}>${el.clientWidth}`);
  }
  // ---- rows: controls on one line share a centre line ----
  const seen = new Set();
  for (const el of controls) {
    const p = el.parentElement;
    if (!p || seen.has(p) || el.closest('[hidden]')) continue;
    seen.add(p);
    const kids = [...p.children].filter((k) => vis(k) && k.matches('button, select, input:not([type=range]):not([type=checkbox]), .seg, .field, .chip, .btns, label.iconbtn, .lbl, .switch'));
    if (kids.length < 2) continue;
    const rects = kids.map((k) => k.getBoundingClientRect());
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = rects[i], b = rects[j];
        const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlap < Math.min(a.height, b.height) * 0.5) continue; // not the same line
        if (a.height < 1 || b.height < 1) continue;
        const dc = Math.abs(a.top + a.height / 2 - (b.top + b.height / 2));
        if (dc > 1.01 && !kids[i].matches('.lbl') && !kids[j].matches('.lbl')) out.rows.push(`${name(kids[i])} vs ${name(kids[j])} centres ${dc.toFixed(1)}px apart`);
      }
    }
  }
  // ---- phone: the previewer on top, the controls at the bottom -----------------
  // Portrait only: a phone on its side puts the deck in a column beside the image.
  if (arg && arg.phone) {
    const CHROME = '.top, .ftop, .pane, .vp, .view-title, .toast, .sheet, .sheet-scrim, .pal-wrap, [role=dialog], [data-radix-popper-content-wrapper]';
    let pv = null, pvEl = null;
    for (const c of document.querySelectorAll('canvas')) {
      if (c.closest('.wl-row, .tfed, [hidden]') || !vis(c)) continue;
      const sh = shown(c);
      if (sh.w < 100 || sh.h < 40) continue;
      if (!pv || sh.w * sh.h > pv.w * pv.h) { pv = sh; pvEl = c; }
    }
    const H = innerHeight;
    if (pvEl) {
      const full = pvEl.getBoundingClientRect();
      if (pv.h < full.height * 0.8) out.stage.push(`previewer is cut off: ${Math.round(pv.h)} of ${Math.round(full.height)}px shows`);
      if (pv.h < H * 0.17) out.stage.push(`previewer is squeezed to ${Math.round(pv.h)}px (${Math.round(pv.h / H * 100)}% of the screen)`);
      if (pv.top > H * 0.5) out.stage.push(`previewer starts at ${Math.round(pv.top)}px, below the middle of the screen`);
      for (const el of controls) {
        const r = vis(el);
        if (!r || el.closest(CHROME) || el.closest('[hidden]')) continue;
        if (r.top + r.height / 2 < pv.top + pv.h / 2) out.stage.push(`control above the previewer: ${name(el)} at y=${Math.round(r.top)} (previewer ${Math.round(pv.top)}..${Math.round(pv.bottom)})`);
      }
    }
    // a deck is the controls' home: all of it in the lower part of the screen
    for (const deck of document.querySelectorAll('.deck')) {
      const d = vis(deck);
      if (!d) continue;
      if (d.top < H * 0.34) out.stage.push(`control deck starts at y=${Math.round(d.top)}: above a third of the screen`);
      for (const el of deck.querySelectorAll('button, select, input:not([type=hidden]):not([type=file]), textarea')) {
        const r = vis(el);
        if (!r || el.closest('[hidden]')) continue;
        const sh = shown(el);
        if (sh.h < 1) continue; // scrolled out of the deck's own window: reachable by scrolling it
        if (r.top + r.height / 2 < H * 0.34 && !el.closest('.pane, .vp')) out.stage.push(`deck control in the upper third: ${name(el)} at y=${Math.round(r.top)}`);
      }
    }
  }
  for (const k of Object.keys(out)) if (Array.isArray(out[k])) out[k] = [...new Set(out[k])].slice(0, 8);
  return out;
};

const findings = [];
const fail = (where, what) => findings.push(`${where}: ${what}`);
const skipped = [];
const typeTally = {};
let browser;
try {
  browser = await launchChromium();
  if (SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
  for (const vname of VIEWPORTS) {
    const vp = ALL_VP[vname];
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: !!vp.mobile,
      acceptDownloads: false,
    });
    for (const st of STATES) {
      if (ONLY && !ONLY.test(st.name)) continue;
      if (st.when === 'desktop' && vp.width < 1000) continue;
      if (st.when === 'narrow' && vp.width >= 1000) continue;
      if (st.needs === 'samples' && !haveSamples) { if (vname === VIEWPORTS[0]) skipped.push(`${st.name} (needs samples/)`); continue; }
      const where = `${vname} ${st.name}`;
      const page = await ctx.newPage();
      // appearance is stored on the device, so a state starts from the default
      // unless it names its own levels
      await page.addInitScript((p) => {
        try { if (p) localStorage.setItem('carys.appearance', JSON.stringify(p)); else localStorage.removeItem('carys.appearance'); } catch { /* none */ }
      }, st.prefs ?? null);
      page.on('pageerror', (e) => fail(where, `page error: ${String(e.message).slice(0, 160)}`));
      try {
        await page.goto(`${BASE}#/${st.route ?? ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForSelector('#root .main', { timeout: 60000 });
        await page.waitForTimeout(st.wait ?? 2200);
        if (st.setup) await st.setup(page, { fx, vp, haveSamples });
        await page.waitForTimeout(400);
      } catch (e) {
        fail(where, `state did not set up: ${String(e.message).split('\n')[0].slice(0, 200)}`);
        await page.close();
        continue;
      }
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${vname}-${st.name}.png`) });
      // a page that is longer than the screen must scroll when the wheel turns over it
      if (st.scrolls) {
        const moved = await page.evaluate(async () => {
          const at = () => [...document.querySelectorAll('*')].reduce((n, e) => n + e.scrollTop, 0) + scrollY;
          return at();
        });
        await page.mouse.move(vp.width / 2, vp.height * 0.4);
        for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(80); }
        const after = await page.evaluate(() => [...document.querySelectorAll('*')].reduce((n, e) => n + e.scrollTop, 0) + scrollY);
        if (!(after > moved)) fail(where, 'does not scroll: the wheel over the page moved nothing, so what is below the first screen cannot be reached');
        // park the pointer off the page and let any hover transition finish
        await page.mouse.move(0, 0);
        await page.waitForTimeout(450);
      }
      if (st.check) for (const msg of await st.check(page, { vp })) fail(where, msg);
      const m = await page.evaluate(measure, { phone: vp.width <= 980 && vp.height > vp.width });
      if (m.overflow > 0) fail(where, `scrolls sideways by ${m.overflow}px`);
      for (const s of m.cut) fail(where, `unreachable: ${s}`);
      for (const s of m.stage) fail(where, `stage: ${s}`);
      for (const s of m.off) fail(where, `off the screen: ${s}`);
      for (const s of m.covered) fail(where, `covered: ${s}`);
      for (const s of m.clipped) fail(where, `text clipped mid-word: ${s}`);
      for (const s of m.small) fail(where, `target under 24px: ${s}`);
      for (const s of m.rows) fail(where, `row misaligned: ${s}`);
      for (const s of m.odd) fail(where, `off-system control height: ${s}`);
      for (const [bag, label] of [['type', 'font size off the ramp'], ['radius', 'radius off the ramp'], ['family', 'font family'], ['color', 'colour off the palette']]) {
        for (const [k, v] of Object.entries(m[bag])) {
          const key = `${label}|${k}`;
          (typeTally[key] ||= { n: 0, where: new Set(), ex: v.ex[0] }).n += v.n;
          typeTally[key].where.add(st.name);
        }
      }
      await page.addScriptTag({ path: AXE });
      const v = await page.evaluate(async (tags) => {
        const res = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
        return res.violations.map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0] ? x.nodes[0].html.slice(0, 110) : ''}`);
      }, TAGS);
      for (const x of v) fail(where, `axe ${x}`);
      await page.close();
    }
    await ctx.close();
    console.log(`viewport ${vname} done`);
  }
} catch (e) {
  console.error('UI AUDIT DID NOT RUN:', e.stack || e.message);
  server.kill();
  if (browser) await browser.close();
  process.exit(1);
}
await browser.close();
server.kill();

for (const [k, v] of Object.entries(typeTally)) {
  const [label, val] = k.split('|');
  fail(`system (${v.where.size} states)`, `${label}: ${val} x${v.n}, e.g. ${v.ex}`);
}
if (skipped.length) console.log(`skipped: ${skipped.join('; ')}`);
if (findings.length > 0) {
  console.error(`UI AUDIT FAILURES (${findings.length}):`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log('UI AUDIT CLEAN');
process.exit(0);
