import { useEffect, useState } from 'react';

/**
 * How many pixels of the bottom of the page the on-screen keyboard covers.
 *
 * A phone's browser leaves the layout as it was and slides the keyboard over
 * its bottom edge, so a panel docked there (the command palette) would sit
 * under the keyboard it just asked for. The visual viewport knows how much is
 * covered. 0 under a mouse, and wherever the browser already resizes the page
 * for the keyboard.
 */
export function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const read = (): void => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    read();
    vv.addEventListener('resize', read);
    vv.addEventListener('scroll', read);
    return () => {
      vv.removeEventListener('resize', read);
      vv.removeEventListener('scroll', read);
      setInset(0);
    };
  }, [active]);
  return inset;
}
