import { useEffect, useRef } from 'react';
import type { JSX, ReactNode } from 'react';

/**
 * A pop-out: a button in the viewer's bar and a panel that floats over the
 * image, replacing the toolbar strip that took a row of it. Viewing software
 * keeps the viewport and hides its tools until you reach for them.
 *
 * The panel follows its button in the DOM, so Tab goes from button to panel
 * with no focus move. It stays mounted while closed (`hidden`), for three
 * reasons: readouts in it (W/L, the cine frame) stay current, dock state
 * such as the teaching card's plane survives a close, and the 3D dock's
 * portal target always exists. Escape closes it and returns focus to the
 * button, and so does a pointer press anywhere outside it. The viewer keeps
 * one pop-out open at a time.
 *
 * The Radix `Popover` in primitives.tsx unmounts its content when closed,
 * which is right for a menu and wrong for a panel that holds live readouts.
 */
export function PopOut({ id, label, title, open, onOpenChange, align = 'start', children }: {
  /** `display` gives `#pop-display-btn` and `#pop-display`, the e2e handles. */
  id: string;
  label: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `end` opens leftwards, for buttons near the right edge. */
  align?: 'start' | 'end';
  children: ReactNode;
}): JSX.Element {
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  /** Opened from the keyboard: focus goes into the panel once it shows. */
  const byKey = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (byKey.current) {
      byKey.current = false;
      panel.current?.querySelector<HTMLElement>('button, input, select, [tabindex]:not([tabindex="-1"])')?.focus();
    }
    // capture phase: a canvas that stops propagation still closes the panel
    const onDown = (e: PointerEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, onOpenChange]);

  return (
    <div
      className="popwrap" ref={wrap}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return;
        // the panel's Escape, not the viewer's (which leaves fullscreen)
        e.stopPropagation();
        onOpenChange(false);
        button.current?.focus();
      }}
    >
      <button
        ref={button} type="button" id={`pop-${id}-btn`}
        className={`iconbtn poptrigger${open ? ' on' : ''}`}
        title={title} aria-expanded={open} aria-controls={`pop-${id}`}
        onClick={(e) => {
          // detail 0: Enter or Space, not a pointer
          byKey.current = !open && e.detail === 0;
          onOpenChange(!open);
        }}
      >
        {label}
      </button>
      <div
        ref={panel} className="popout" id={`pop-${id}`} role="group" aria-label={label}
        data-align={align} hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}
