// The states uiaudit.mjs drives: one entry per thing a person can put the
// interface into. `when` limits a state to desktop-sized or narrow screens
// (the viewer is a different tree on a phone), `needs: 'samples'` skips it where
// the imaging fixtures are not checked out.
//
// Every setup does what a person does - press the button, pick the option -
// and nothing the page does not offer, so a state that cannot be reached by
// hand fails the audit instead of being faked.

const click = (page, sel) => page.click(sel, { timeout: 8000 });
const popOut = (label) => async (page) => {
  await click(page, `.popbar button:has-text("${label}")`);
  await page.waitForTimeout(500);
};
/** Press the option of a Seg by its data attribute. */
const press = (page, id, key, value) => click(page, `#${id} button[data-${key}="${value}"]`);
const details = async (page) => {
  const t = await page.$('#instoggle');
  if (t && (await t.getAttribute('aria-pressed')) !== 'true') await t.click();
  await page.waitForTimeout(500);
};
const appearance = (levels) => async (page) => {
  await click(page, '#appearance');
  await page.waitForSelector('.appear');
  for (const [k, v] of Object.entries(levels)) await click(page, `.appear button[data-${k}="${v}"]`);
  await page.waitForTimeout(500);
};
const loadViewerFiles = (paths) => async (page) => {
  await page.setInputFiles('input#upload', paths);
  await page.waitForTimeout(6000);
};
/** The phone's deck starts hidden (only its handle shows). Pressing the handle
 *  steps it up a level: n=1 is the half-open deck (a stage route's first
 *  rows, the viewer's bar), n=2 the full one. */
const deckUp = async (page, n = 2) => {
  for (let i = 0; i < n; i++) {
    await click(page, '.deck-grip');
    await page.waitForTimeout(300);
  }
};
const mobileSheet = (label) => async (page) => {
  await deckUp(page, 1);
  await click(page, `#mobilebar button:has-text("${label}")`);
  await page.waitForTimeout(600);
};

export const STATES = [
  // ---- viewer: the image tools ---------------------------------------------
  { name: 'viewer', wait: 5000 },
  { name: 'viewer-details', when: 'desktop', wait: 5000, setup: details },
  { name: 'viewer-pop-display', when: 'desktop', wait: 5000, setup: popOut('Display') },
  { name: 'viewer-pop-reformat', when: 'desktop', wait: 5000, setup: popOut('Reformat') },
  { name: 'viewer-pop-compare', when: 'desktop', wait: 5000, setup: popOut('Compare') },
  { name: 'viewer-pop-segment', when: 'desktop', wait: 5000, setup: popOut('Segment') },
  { name: 'viewer-pop-3d', when: 'desktop', wait: 5000, setup: popOut('3D') },
  { name: 'viewer-pop-export', when: 'desktop', wait: 5000, setup: popOut('Export') },
  { name: 'viewer-3d-volume', when: 'desktop', wait: 5000, setup: async (p) => { await popOut('3D')(p); await press(p, 'renderseg', 'r', 'volume'); await p.waitForTimeout(1200); } },
  { name: 'viewer-3d-image-source', when: 'desktop', wait: 5000, setup: async (p) => { await popOut('3D')(p); await press(p, 'srcseg', 's', 'image'); await p.waitForTimeout(1200); } },
  { name: 'viewer-tool-paint', when: 'desktop', wait: 5000, setup: (p) => press(p, 'modeseg', 'mode', 'paint') },
  { name: 'viewer-tool-grow', when: 'desktop', wait: 5000, setup: (p) => press(p, 'modeseg', 'mode', 'grow') },
  { name: 'viewer-tool-measure', when: 'desktop', wait: 5000, setup: (p) => press(p, 'modeseg', 'mode', 'measure') },
  { name: 'viewer-tool-curve', when: 'desktop', wait: 5000, setup: (p) => press(p, 'modeseg', 'mode', 'curve') },
  { name: 'viewer-layout-axial', when: 'desktop', wait: 5000, setup: async (p) => { await popOut('Display')(p); await press(p, 'layoutseg', 'layout', 'axial'); await p.keyboard.press('Escape'); } },
  { name: 'viewer-fullscreen-3d', when: 'desktop', wait: 5000, setup: (p) => click(p, '#full-v3d') },
  { name: 'viewer-palette', wait: 4000, setup: async (p) => { await p.keyboard.press('Control+k'); await p.waitForTimeout(500); } },
  { name: 'viewer-appearance', wait: 4000, setup: appearance({}) },
  { name: 'viewer-dicom-series', needs: 'samples', wait: 3000, setup: async (p, { fx }) => {
    const fs = await import('node:fs');
    await loadViewerFiles(fs.readdirSync(fx.dicom).filter((f) => f.endsWith('.dcm')).map((f) => `${fx.dicom}/${f}`))(p);
  } },
  { name: 'viewer-two-series', needs: 'samples', wait: 5000, setup: async (p, { fx }) => { await loadViewerFiles([fx.nii])(p); } },
  // ---- viewer on a phone: the deck ----------------------------------------
  { name: 'm-deck-tools', when: 'narrow', wait: 5000, setup: mobileSheet('Tools') },
  { name: 'm-deck-display', when: 'narrow', wait: 5000, setup: mobileSheet('Display') },
  { name: 'm-deck-files', when: 'narrow', wait: 5000, setup: mobileSheet('Files') },
  { name: 'm-nav', when: 'narrow', wait: 4000, setup: (p) => click(p, '#navtoggle') },
  // the slice scrubber: the stack scrolls from the bar at the bottom, and the
  // bar follows the slice when something else moves it
  { name: 'm-scrub', when: 'narrow', needs: 'samples', wait: 3000,
    setup: async (p, { fx }) => {
      const fs = await import('node:fs');
      await loadViewerFiles(fs.readdirSync(fx.dicom).filter((f) => f.endsWith('.dcm')).map((f) => `${fx.dicom}/${f}`))(p);
      await deckUp(p, 1);
      await click(p, '#mviewseg button[data-mview="axial"]');
      await p.waitForTimeout(800);
    },
    check: async (p) => {
      const bad = [];
      const idx = async () => ({ head: (await p.locator('#ro-axial').textContent()).split('/')[0].trim(), bar: await p.locator('#m-slice').inputValue(), rail: await p.locator('#s-axial').inputValue() });
      const a = await idx();
      if (a.head !== a.bar || a.head !== a.rail) bad.push(`scrubber, header and slider disagree at the start: ${JSON.stringify(a)}`);
      await p.locator('button[aria-label="Next slice"]').click();
      await p.waitForTimeout(300);
      const b = await idx();
      if (Number(b.head) !== Number(a.head) + 1 || b.bar !== b.head) bad.push(`Next slice did not step the stack by one: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
      const box = await p.locator('#c-axial').boundingBox();
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.mouse.wheel(0, -300);
      await p.waitForTimeout(400);
      const c = await idx();
      if (c.bar !== c.head) bad.push(`the scrubber did not follow the wheel: ${JSON.stringify(c)}`);
      if (await p.locator('.vp2d .vrail').first().isVisible()) bad.push('the slice rail is still up the image edge: the scrubber replaces it on a phone');
      return bad;
    } },
  // fullscreen on a phone: the image takes the whole screen (it was a black
  // one: the grid left it a zero-height row), and the stack's rail comes back
  // because the deck that holds the scrubber is hidden
  { name: 'm-fullscreen-3d', when: 'narrow', wait: 5000, setup: (p) => click(p, '#full-v3d'),
    check: async (p) => {
      const box = await p.locator('#view3d').boundingBox();
      return box && box.height > 200 ? [] : [`fullscreen 3D draws no image: the canvas is ${box ? Math.round(box.height) : 0}px tall`];
    } },
  { name: 'm-fullscreen-axial', when: 'narrow', needs: 'samples', wait: 3000,
    setup: async (p, { fx }) => {
      const fs = await import('node:fs');
      await loadViewerFiles(fs.readdirSync(fx.dicom).filter((f) => f.endsWith('.dcm')).map((f) => `${fx.dicom}/${f}`))(p);
      await deckUp(p, 1);
      await click(p, '#mviewseg button[data-mview="axial"]');
      await click(p, '#full-axial');
      await p.waitForTimeout(800);
    },
    check: async (p) => {
      const bad = [];
      const box = await p.locator('#c-axial').boundingBox();
      if (!box || box.height < 200) bad.push(`fullscreen axial draws no image: the canvas is ${box ? Math.round(box.height) : 0}px tall`);
      if (!(await p.locator('#pane-axial .vrail').isVisible())) bad.push('fullscreen hides the deck, and with it the only way to scroll the stack: the rail must be back');
      return bad;
    } },
  // ---- every other route on a phone: the deck ---------------------------------
  // the resting state of each of these is the deck hidden; these raise it
  { name: 'm-open-protein', route: 'protein', when: 'narrow', setup: (p) => deckUp(p) },
  { name: 'm-half-protein', route: 'protein', when: 'narrow', setup: (p) => deckUp(p, 1) },
  { name: 'm-open-cells', route: 'cells', when: 'narrow', wait: 4000, setup: (p) => deckUp(p) },
  { name: 'm-open-atlas', route: 'atlas', when: 'narrow', wait: 4000, setup: (p) => deckUp(p) },
  { name: 'm-open-tracks', route: 'tracks', when: 'narrow', setup: (p) => deckUp(p) },
  { name: 'm-open-studies', route: 'worklist', when: 'narrow', setup: (p) => deckUp(p) },
  { name: 'm-open-viewer', when: 'narrow', wait: 5000, setup: async (p) => { await deckUp(p, 1); await click(p, '#mobilebar button:has-text("Display")'); } },
  { name: 'm-studies-cohort', route: 'worklist', when: 'narrow', setup: async (p) => { await deckUp(p); await click(p, '.deck-fold-head:has-text("Teaching cohort")'); } },
  { name: 'm-studies-pacs', route: 'worklist', when: 'narrow', setup: async (p) => { await deckUp(p); await click(p, 'button[aria-pressed]:has-text("PACS")'); } },
  // the swipe itself: a touch drag up on the handle raises the deck a level, a drag down lowers it
  { name: 'm-swipe', route: 'protein', when: 'narrow',
    setup: async (p) => {
      const box = await p.locator('.deck-grip').boundingBox();
      const cdp = await p.context().newCDPSession(p);
      const drag = async (y0, y1) => {
        const pt = (y) => [{ x: box.x + box.width / 2, y }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(y0) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt((y0 + y1) / 2) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(y1) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await p.waitForTimeout(500);
      };
      const mid = box.y + box.height / 2;
      await drag(mid, mid - 80);
    },
    check: async (p) => {
      const lvl = async () => p.locator('.stage-deck').getAttribute('data-level');
      const bad = [];
      if ((await lvl()) !== '1') bad.push(`a swipe up on the handle did not raise the deck to half (level ${await lvl()})`);
      return bad;
    } },
  // ---- studies / report ------------------------------------------------------
  { name: 'studies', route: 'worklist', scrolls: true },
  { name: 'studies-nomatch', route: 'worklist', setup: async (p) => { await p.fill('input[type=search], .wl-filter input, #wl-filter', 'zzzz-no-such-study').catch(() => {}); } },
  { name: 'report', route: 'report' },
  // ---- protein -------------------------------------------------------------------
  { name: 'protein-empty', route: 'protein' },
  { name: 'protein-loaded', route: 'protein', setup: async (p, { fx }) => { await p.setInputFiles('#pdb-upload', fx.pdb); await p.waitForTimeout(2500); } },
  { name: 'protein-loaded-details', route: 'protein', setup: async (p, { fx }) => { await p.setInputFiles('#pdb-upload', fx.pdb); await p.waitForTimeout(2500); await details(p); } },
  { name: 'protein-capsid', route: 'protein', setup: async (p, { vp }) => { if (vp.width < 1000) await deckUp(p); await click(p, '#protein-mode button[data-protein-mode="capsid"]'); await p.waitForTimeout(2500); } },
  // ---- cells / tracks / atlas / learn --------------------------------------------
  { name: 'cells', route: 'cells', wait: 4000 },
  { name: 'tracks-empty', route: 'tracks' },
  { name: 'tracks-loaded', route: 'tracks', setup: async (p, { fx }) => { await p.setInputFiles('#track-upload', fx.bed); await p.waitForTimeout(1500); } },
  { name: 'atlas-bones', route: 'atlas', wait: 4000 },
  { name: 'atlas-bones-details', route: 'atlas', wait: 4000, setup: details },
  { name: 'atlas-body', route: 'atlas', wait: 4000, setup: async (p, { vp }) => { if (vp.width < 1000) await deckUp(p); await click(p, '#atlas-mode button[data-atlas-mode="body"]'); await p.waitForTimeout(3000); } },
  { name: 'atlas-body-details', route: 'atlas', wait: 4000, setup: async (p, { vp }) => { if (vp.width < 1000) await deckUp(p); await click(p, '#atlas-mode button[data-atlas-mode="body"]'); await p.waitForTimeout(3000); await details(p); } },
  { name: 'learn', route: 'learn', scrolls: true },
  { name: 'learn-answered', route: 'learn', setup: async (p) => { await p.locator('#learn-quiz button').first().click(); await p.waitForTimeout(500); } },
  { name: 'learn-selftest', route: 'learn', setup: async (p) => { await click(p, '#dock-selftest button:has-text("Start")'); await p.waitForTimeout(1500); await p.locator('#selftest-quiz button').first().click().catch(() => {}); await p.waitForTimeout(400); } },
  { name: 'learn-measure-verdict', route: 'learn', setup: async (p) => { await p.fill('#trainer-measured', '40'); await click(p, '#dock-measuretrainer button:has-text("Check")').catch(() => {}); await p.waitForTimeout(400); } },
  { name: 'learn-microbes', route: 'learn' },
];

// ---- the ends of the five appearance scales, on the routes people live in ----
const ALL = (l) => ({ textSize: l, density: l, controlSize: l, corners: l, imageText: l });
for (const end of ['xs', 'xl']) {
  for (const [name, route, wait] of [['viewer', '', 5000], ['studies', 'worklist', 2200], ['protein', 'protein', 2200], ['cells', 'cells', 4000], ['atlas', 'atlas', 4000], ['learn', 'learn', 2200], ['report', 'report', 2200]]) {
    STATES.push({ name: `${name}-all-${end}`, route, wait, prefs: ALL(end) });
    if (['studies', 'protein', 'cells', 'atlas'].includes(name)) STATES.push({ name: `${name}-open-all-${end}`, route, wait, when: 'narrow', prefs: ALL(end), setup: (p) => deckUp(p) });
  }
  STATES.push({ name: `viewer-details-all-${end}`, wait: 5000, when: 'desktop', prefs: ALL(end), setup: details });
  STATES.push({ name: `viewer-pop-display-all-${end}`, wait: 5000, when: 'desktop', prefs: ALL(end), setup: popOut('Display') });
}
