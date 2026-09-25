// Accessibility gate: axe-core (WCAG 2.1 A + AA) over every route, desktop
// and mobile. Unlike audit:mobile this ASSERTS — a violation exits 1.
//
// Why a gate and not a report: the contrast pass that created this script
// found 226 violations, 221 of them one token (--color-faint) that had been
// below 4.5:1 on every surface since it was written. Nobody introduced that
// in a bad week; it was never measured. A rule in CODING-STANDARDS with no
// checker behind it is a preference (§28), and §22a/§22b are rules.
//
// Runs without samples/: the imaging fails to load, but the chrome — rails,
// toolbars, docks, panels, worklist, forms — is what axe inspects, and all of
// it renders regardless. CI has no fixtures and still gets real coverage.
//
// axe cannot press a key or change a media setting, so the gate also tabs
// through every desktop route (keyboard.mjs: reachable, visible, a focus
// change at every stop, no trap) and reloads the viewer under
// prefers-reduced-motion and forced colors (Windows high contrast).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { launchChromium } from './browser.mjs';
import { forcedAudit, motionAudit, tabCycle } from './keyboard.mjs';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');
const PORT = Number(process.env.E2E_PORT || 8127);
const BASE = `http://localhost:${PORT}/packages/app/dist/index.html`;
const ROUTES = ['', 'atlas', 'protein', 'cells', 'tracks', 'report', 'worklist', 'learn'];
const VIEWPORTS = [
  { name: 'desktop', width: 1680, height: 1000, touch: false },
  { name: 'mobile', width: 390, height: 844, touch: true },
];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

const findings = [];
/** Keyboard and media problems: [where, what]. */
const kb = [];
const tabStops = [];
let browser;
try {
  browser = await launchChromium();
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
      isMobile: vp.touch && vp.width < 500,
    });
    for (const route of ROUTES) {
      const page = await ctx.newPage();
      await page.goto(`${BASE}#/${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      // the viewer builds a surface off the main thread; the rest settle sooner
      await page.waitForTimeout(route === '' ? 9000 : 5000);
      await page.addScriptTag({ path: AXE });
      const violations = await page.evaluate(
        async (tags) => {
          const res = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
          return res.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes.length,
            // one example is enough to find it; the rule id names the fix
            sample: v.nodes[0] ? v.nodes[0].html.slice(0, 120) : '',
          }));
        },
        TAGS,
      );
      for (const v of violations) {
        findings.push({ where: `${vp.name} #/${route || 'viewer'}`, ...v });
      }
      if (!vp.touch) {
        const { problems, stops } = await tabCycle(page);
        tabStops.push(stops);
        for (const p of problems) kb.push([`#/${route || 'viewer'}`, p]);
        if (route === '') {
          // the motion audit is only meaningful if it sees motion when
          // motion is allowed: its probe animation must show up here
          const moving = await motionAudit(page);
          if (!moving.some((m) => m.startsWith('probe animation'))) kb.push(['#/viewer', `the motion audit sees no motion without reduced motion: ${moving.join('; ') || 'nothing'}`]);
        }
      }
      await page.close();
    }
    await ctx.close();
  }
  const media = await browser.newContext({
    viewport: { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height },
    reducedMotion: 'reduce', forcedColors: 'active',
  });
  const page = await media.newPage();
  await page.goto(`${BASE}#/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(9000);
  for (const p of await motionAudit(page)) kb.push(['reduced motion', p]);
  for (const p of await forcedAudit(page)) kb.push(['forced colors', p]);
  for (const p of (await tabCycle(page, { countShadow: false })).problems) kb.push(['forced colors #/viewer', p]);
  await media.close();
} catch (e) {
  console.error('A11Y AUDIT DID NOT RUN:', e.message);
  server.kill();
  if (browser) await browser.close();
  process.exit(1);
}
await browser.close();
server.kill();

if (kb.length > 0) {
  console.error(`KEYBOARD / MEDIA FAILURES (${kb.length}):`);
  for (const [where, what] of kb) console.error(`  ${where}: ${what}`);
}
if (findings.length > 0) {
  const byRule = new Map();
  for (const f of findings) {
    const e = byRule.get(f.id) ?? { impact: f.impact, help: f.help, nodes: 0, where: new Set(), sample: f.sample };
    e.nodes += f.nodes;
    e.where.add(f.where);
    byRule.set(f.id, e);
  }
  console.error(`A11Y FAILURES (${byRule.size} rules, ${findings.reduce((n, f) => n + f.nodes, 0)} nodes):`);
  for (const [id, e] of byRule) {
    console.error(`  [${e.impact}] ${id} — ${e.nodes} nodes on ${e.where.size} route/breakpoints`);
    console.error(`      ${e.help}`);
    console.error(`      e.g. ${e.sample}`);
  }
  process.exit(1);
}
if (kb.length > 0) process.exit(1);
console.log(`KEYBOARD CLEAN — ${tabStops.reduce((a, b) => a + b, 0)} Tab stops over ${tabStops.length} routes, each visible with a focus change; reduced motion and forced colors hold`);
console.log(`A11Y CLEAN — 0 WCAG 2.1 A/AA violations across ${ROUTES.length} routes x ${VIEWPORTS.length} breakpoints`);
process.exit(0);
