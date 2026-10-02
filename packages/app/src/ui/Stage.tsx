import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type { JSX, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from '../lib/isMobile';

/**
 * The phone layout every route with something to look at shares with the
 * viewer: the thing you look at owns the top of the screen, and the controls
 * that drive it sit in a deck on the bottom, where a thumb rests. A tool
 * never covers the image it acts on, and nothing you reach for often is out
 * of reach.
 *
 * A route writes its page once, in the order a desktop reads it (title,
 * toolbar, content), and marks each toolbar with `<Dock>`. Wider than 980px
 * `Stage` is a fragment and a `Dock` is the plain toolbar it always was.
 * Narrower, the content goes in the region above and every `Dock` is
 * portalled into the deck below, so the DOM order is the order on screen
 * and Tab follows the eye.
 *
 * `preview` routes (a canvas is the content) lock the region to the screen,
 * hold the deck at a fixed height so the image never jumps as a toolbar
 * grows a chip, and let the deck fold away to hand the image the whole
 * screen. The others (a list, a report) scroll above a deck that is as tall
 * as its controls, up to the same cap.
 */

/**
 * A region that scrolls must be reachable from the keyboard, and one with
 * nothing focusable in it is not (WCAG 2.1.1). Each part of the stage that
 * overflows gets a tab stop and a name while it does, and loses them when it
 * fits, so a pane that never scrolls costs a keyboard user no stop.
 */
function useScrollStops(root: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = root.current;
    if (!enabled || !el) return;
    let frame = 0;
    const sync = (): void => {
      frame = 0;
      for (const r of [el, ...el.querySelectorAll<HTMLElement>('.pane, .seqstrip')]) {
        const scrolls = /auto|scroll/.test(getComputedStyle(r).overflowY) && r.scrollHeight > r.clientHeight + 1;
        if (scrolls && r.dataset.scrollStop === undefined) {
          r.dataset.scrollStop = r.getAttribute('tabindex') === null ? 'set' : 'kept';
          if (r.dataset.scrollStop === 'set') {
            r.tabIndex = 0;
            r.setAttribute('role', 'region');
            r.setAttribute('aria-label', r.querySelector('.pane-head .name')?.textContent?.trim() || (r.classList.contains('seqstrip') ? 'Sequence' : 'Scrollable content'));
          }
        } else if (!scrolls && r.dataset.scrollStop === 'set') {
          r.removeAttribute('tabindex');
          r.removeAttribute('role');
          r.removeAttribute('aria-label');
          delete r.dataset.scrollStop;
        } else if (!scrolls) {
          delete r.dataset.scrollStop;
        }
      }
    };
    const later = (): void => { if (!frame) frame = requestAnimationFrame(sync); };
    const resize = new ResizeObserver(later);
    const watch = (): void => {
      resize.disconnect();
      for (const r of [el, ...el.querySelectorAll<HTMLElement>('.pane, .seqstrip')]) {
        resize.observe(r);
        for (const k of r.children) resize.observe(k);
      }
      later();
    };
    // content comes and goes (a card opens under the canvas), so look again
    const mutations = new MutationObserver(watch);
    mutations.observe(el, { childList: true, subtree: true });
    watch();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [root, enabled]);
}

/** How far the deck is raised: 0 hidden (only its handle), 1 half, 2 full. */
export type DeckLevel = 0 | 1 | 2;
const LEVEL_NAME = ['hidden', 'half open', 'open'] as const;

/**
 * The deck's handle. This is a visualization tool, so the controls start out
 * of the way and the image has the screen. A swipe up on the handle raises the
 * deck a level, a swipe down lowers it; a press (or Enter) steps up through
 * the levels and drops back to hidden from the top, and the arrow keys step.
 */
export function DeckGrip({ level, onLevel, controls, label = 'Controls' }: {
  level: DeckLevel; onLevel: (l: DeckLevel) => void; controls: string; label?: string;
}): JSX.Element {
  const from = useRef<number | null>(null);
  const swiped = useRef(false);
  const step = (d: 1 | -1): void => onLevel(Math.max(0, Math.min(2, level + d)) as DeckLevel);
  return (
    <button
      type="button" className="deck-grip" aria-expanded={level > 0} aria-controls={controls}
      aria-label={`${label}, ${LEVEL_NAME[level]}. Swipe up or down, or press, to change.`}
      onPointerDown={(e) => { from.current = e.clientY; swiped.current = false; e.currentTarget.setPointerCapture?.(e.pointerId); }}
      onPointerUp={(e) => {
        const y = from.current;
        from.current = null;
        if (y === null) return;
        const dy = y - e.clientY;
        if (Math.abs(dy) >= 24) { swiped.current = true; step(dy > 0 ? 1 : -1); }
      }}
      onPointerCancel={() => { from.current = null; }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
      }}
      onClick={() => {
        if (swiped.current) { swiped.current = false; return; }
        onLevel(level === 2 ? 0 : ((level + 1) as DeckLevel));
      }}
    >
      <span>{label}</span>
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M3.5 6l4.5 4.5L12.5 6" />
      </svg>
    </button>
  );
}

/** The deck's body, or `null` until it mounts; `undefined` outside a Stage. */
const DeckSlot = createContext<HTMLElement | null | undefined>(undefined);

export function Stage({ children, preview = false, fold = true }: {
  children: ReactNode;
  /** a canvas is the content: lock the region and fix the deck's height */
  preview?: boolean;
  /** the deck can fold to a single row (off for a deck of a few buttons) */
  fold?: boolean;
}): JSX.Element {
  const mobile = useIsMobile();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [level, setLevel] = useState<DeckLevel>(0);
  const bodyId = useId();
  const main = useRef<HTMLDivElement>(null);
  useScrollStops(main, mobile);
  if (!mobile) return <>{children}</>;
  // a deck of a few buttons (Report) has no handle and is always up
  const shown: DeckLevel = fold ? level : 2;
  const expanded = shown > 0;
  return (
    <DeckSlot.Provider value={slot}>
      <div className="stage-main" data-preview={preview} data-level={shown} ref={main}>{children}</div>
      <div className="deck stage-deck" data-open={expanded} data-level={shown} data-preview={preview}>
        {fold && <DeckGrip level={level} onLevel={setLevel} controls={bodyId} />}
        <div className="deck-body" id={bodyId} role="region" aria-label="Controls" hidden={!expanded} ref={setSlot} />
      </div>
    </DeckSlot.Provider>
  );
}

/**
 * A route's toolbar. On a phone it moves into the deck (a `label` makes it a
 * fold of its own inside the deck, shut until opened, for a toolbar that is
 * a section and not the route's main controls).
 */
export function Dock({ id, label, shut = false, className = '', children }: {
  id?: string;
  label?: string;
  /** a labelled dock starts folded */
  shut?: boolean;
  className?: string;
  children: ReactNode;
}): JSX.Element | null {
  const slot = useContext(DeckSlot);
  const [open, setOpen] = useState(!shut);
  const dock = (
    <div className={`dock${className ? ` ${className}` : ''}`} id={id} hidden={slot !== undefined && label !== undefined ? !open : undefined}>
      {children}
    </div>
  );
  // outside a Stage, or wider than the phone layout: the toolbar as it was
  if (slot === undefined) return dock;
  // the deck is not mounted yet: it will be, in this commit's ref callback
  if (slot === null) return null;
  return createPortal(
    label === undefined ? dock : (
      <section className="deck-fold" data-open={open}>
        <button
          type="button" className="deck-fold-head" aria-expanded={open} aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {label}
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M3.5 6l4.5 4.5L12.5 6" />
          </svg>
        </button>
        {dock}
      </section>
    ),
    slot,
  );
}
