// The desktop viewer's display tools sit behind pop-outs in its bar
// (ui/PopOut.tsx): Display, Reformat, Compare, Time, Segment, 3D and Export.
// A closed panel stays in the DOM, hidden, so a leg may read a readout in it
// (#ro-wl, #tval, #ro-time) without opening it. It must open the panel to
// click, type or focus there: Playwright will not act on what a reader cannot
// see, which is the point. A press outside closes the panel, so a leg that
// clicks the image in between opens it again; opening an open one is a no-op.
export async function openPop(page, id) {
  const btn = page.locator(`#pop-${id}-btn`);
  await btn.waitFor({ timeout: 60000 });
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
  await page.locator(`#pop-${id}`).waitFor({ state: 'visible', timeout: 10000 });
}

/** Close a pop-out by its button (Escape would also reach the viewer's own
 *  handlers when focus is outside the panel). Before a leg clicks the image:
 *  an open panel covers the top of the 2D column. */
export async function closePop(page, id) {
  const btn = page.locator(`#pop-${id}-btn`);
  if ((await btn.getAttribute('aria-expanded')) === 'true') await btn.click();
  await page.locator(`#pop-${id}`).waitFor({ state: 'hidden', timeout: 10000 });
}
