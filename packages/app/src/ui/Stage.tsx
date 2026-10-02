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
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const main = useRef<HTMLDivElement>(null);
  useScrollStops(main, mobile);
  if (!mobile) return <>{children}</>;
  const expanded = open || !fold;
  return (
    <DeckSlot.Provider value={slot}>
      <div className="stage-main" data-preview={preview} ref={main}>{children}</div>
      <div className="deck stage-deck" data-open={expanded} data-preview={preview}>
        {fold && (
          <button
            type="button" className="deck-grip" aria-expanded={open} aria-controls={bodyId}
            title={open ? 'Fold the controls away' : 'Show the controls'}
            onClick={() => setOpen(!open)}
          >
            Controls
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M3.5 6l4.5 4.5L12.5 6" />
            </svg>
          </button>
        )}
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
