// One place that knows how to open a browser.
//
// `chromium.launch()` resolves a browser build pinned to the installed
// Playwright version. That is right on CI, where `npx playwright install
// chromium` fetches exactly that build, and wrong in a sandbox that ships a
// different revision — there the launch fails with "Executable doesn't exist",
// which is how audit:mobile came to be un-runnable without anyone noticing.
//
// CARYS_CHROMIUM points at a browser binary to use instead. Unset (CI, a
// normal dev machine) nothing changes and Playwright resolves its own.
import { chromium } from 'playwright';

/** Launch Chromium, honouring a CARYS_CHROMIUM override. */
export function launchChromium(opts = {}) {
  const exe = process.env.CARYS_CHROMIUM;
  return chromium.launch(exe ? { ...opts, executablePath: exe } : opts);
}
