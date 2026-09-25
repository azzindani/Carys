// Keyboard and media audits for the a11y gate (a11y.mjs). axe checks roles
// and contrast; it cannot press Tab or change the user's media settings.
//
//   tabCycle     Tab from the top of a page until focus comes back round.
//                Every stop must be an element the reader can see, carrying a
//                visible focus change (on itself, its parent or grandparent,
//                or the next sibling an opacity-0 input draws its state on);
//                focus must not fall to <body> mid-cycle, no positive tabindex
//                may reorder the page, and the cycle must close (no trap).
//   motionAudit  Under prefers-reduced-motion nothing animates for longer
//                than a frame and nothing loops, including a probe animation
//                injected to prove the rule reaches any element.
//   forcedAudit  Under forced colors a pressed segment and a checked switch
//                still look different from their resting twins.

/** More stops than any route has; reaching it means focus never came back. */
const MAX_STOPS = 400;

/** Runs in the page: describe the focused element and whether focus shows. */
function inspectFocus(countShadow) {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { body: true };
  window.kbSeq = (window.kbSeq ?? 0) + 1;
  if (!el.dataset.kbKey) el.dataset.kbKey = String(window.kbSeq);
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
  const aria = el.getAttribute('aria-label');
  const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls.length ? `.${cls.join('.')}` : ''}${aria ? `[${aria}]` : ''}`;
  const rect = el.getBoundingClientRect();
  let opacity = 1;
  for (let n = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
  const seen = rect.width >= 1 && rect.height >= 1 && getComputedStyle(el).visibility !== 'hidden'
    && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  // an opacity-0 control (the switch's input) draws its state on its sibling
  const targets = [opacity > 0.05 ? el : null, el.parentElement, el.parentElement?.parentElement, el.nextElementSibling].filter(Boolean);
  const props = [
    'outline-style', 'outline-width', 'outline-color', 'border-top-color', 'border-bottom-color',
    'background-color', 'color', 'text-decoration-line', ...(countShadow ? ['box-shadow'] : []),
  ];
  // a focus ring that fades in reads as its resting style for the first
  // frame; jump every transition to its end before reading
  const settle = () => {
    for (const a of document.getAnimations()) if (a instanceof CSSTransition) a.finish();
  };
  const snap = () => targets.map((t) => {
    settle();
    const c = getComputedStyle(t);
    return props.map((p) => c.getPropertyValue(p)).join('|');
  }).join('||');
  const on = snap();
  el.blur();
  const off = snap();
  el.focus({ preventScroll: true });
  return {
    key: el.dataset.kbKey, label, seen,
    hidden: Boolean(el.closest('[aria-hidden="true"], [inert]')),
    ring: on !== off, refocused: document.activeElement === el,
  };
}

/**
 * Tab through a page and return what is wrong, [] when nothing is, plus the
 * number of stops. `countShadow` is false under forced colors, where the
 * palette swap drops box-shadow and a shadow-only ring is no ring at all.
 */
export async function tabCycle(page, { countShadow = true } = {}) {
  const problems = [];
  const positive = await page.evaluate(() => [...document.querySelectorAll('[tabindex]')]
    .filter((e) => e.tabIndex > 0).map((e) => e.outerHTML.slice(0, 90)));
  for (const p of positive) problems.push(`positive tabindex reorders focus: ${p}`);
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  let first = null, prev = null, stops = 0;
  for (;;) {
    if (stops >= MAX_STOPS) {
      problems.push(`focus never came back round in ${MAX_STOPS} Tabs (a trap near ${prev?.label})`);
      break;
    }
    await page.keyboard.press('Tab');
    const r = await page.evaluate(inspectFocus, countShadow);
    if (r.body) {
      if (!first) { problems.push('Tab reaches nothing'); break; }
      // the end of the document: one more Tab must start the cycle again
      await page.keyboard.press('Tab');
      const again = await page.evaluate(inspectFocus, countShadow);
      if (again.key !== first.key) problems.push(`focus fell to <body> after ${prev?.label} (next Tab: ${again.label ?? 'body'})`);
      break;
    }
    if (first && r.key === first.key) break;
    first ??= r;
    prev = r;
    stops++;
    if (r.hidden) problems.push(`focus lands inside aria-hidden/inert: ${r.label}`);
    else if (!r.seen) problems.push(`focus lands on something not on screen: ${r.label}`);
    else if (!r.ring) problems.push(`no visible focus change: ${r.label}`);
    if (!r.refocused) problems.push(`focusing ${r.label} again did not hold (it moves focus on blur)`);
  }
  return { problems, stops };
}

/** Everything still animating for longer than a frame, or looping. */
export async function motionAudit(page) {
  return page.evaluate(() => {
    const bad = [];
    const probe = document.createElement('div');
    probe.style.animation = 'pulse 2.2s infinite';
    document.body.append(probe);
    const ms = (v) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);
    for (const el of document.querySelectorAll('*')) {
      const c = getComputedStyle(el);
      if (c.animationName === 'none') continue;
      const durs = c.animationDuration.split(',').map((d) => ms(d.trim()));
      if (durs.some((d) => d > 1) || c.animationIterationCount.includes('infinite')) {
        bad.push(`${el === probe ? 'probe animation' : el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(' ')[0]}` : '')}: ${c.animationName} ${c.animationDuration} × ${c.animationIterationCount}`);
      }
    }
    for (const a of document.getAnimations()) {
      const t = a.effect?.getComputedTiming();
      if (t && (t.iterations === Infinity || Number(t.duration) > 1)) bad.push(`running ${a.animationName ?? a.transitionProperty ?? 'animation'}: ${t.duration} ms × ${t.iterations}`);
    }
    probe.remove();
    return bad;
  });
}

/** Pressed against resting controls under forced colors; [] when all differ. */
export async function forcedAudit(page) {
  return page.evaluate(() => {
    if (!matchMedia('(forced-colors: active)').matches) return ['forced colors is not active: the emulation did not apply'];
    const bad = [];
    // forced colors keeps the author's alpha: a transparent resting button
    // and an opaque pressed one both paint Canvas, so compare the colour
    // that shows, the first opaque background up the tree
    const shown = (el, pseudo) => {
      for (let n = el, p = pseudo; n; n = n.parentElement, p = undefined) {
        const bg = getComputedStyle(n, p).backgroundColor;
        const alpha = bg.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1];
        if (alpha === undefined || Number(alpha) > 0) return bg.replace(/^rgba\(([^,]+,[^,]+,[^,]+),[^)]*\)/, 'rgb($1)');
      }
      return 'none';
    };
    const look = (el, pseudo) => {
      const c = getComputedStyle(el, pseudo);
      return [shown(el, pseudo), c.color, c.borderTopColor, c.outlineStyle].join('|');
    };
    let segs = 0;
    for (const seg of document.querySelectorAll('.seg')) {
      const on = seg.querySelector('button[aria-pressed="true"]');
      const off = seg.querySelector('button[aria-pressed="false"]');
      if (!on || !off) continue;
      segs++;
      if (look(on) === look(off)) bad.push(`pressed and resting segments look alike: ${seg.getAttribute('aria-label') ?? seg.id}`);
    }
    if (segs === 0) bad.push('no segmented control with a pressed and a resting button to compare');
    const tracks = [...document.querySelectorAll('.switch input')].map((i) => ({ on: i.checked, tr: i.nextElementSibling }));
    const onTr = tracks.find((t) => t.on)?.tr, offTr = tracks.find((t) => !t.on)?.tr;
    if (onTr && offTr && look(onTr) + look(onTr, '::after') === look(offTr) + look(offTr, '::after')) {
      bad.push('a checked switch looks like an unchecked one');
    }
    return bad;
  });
}
