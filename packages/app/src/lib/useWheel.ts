import { useEffect, useRef } from 'react';

/**
 * A `wheel` listener that is allowed to cancel the wheel.
 *
 * React registers `onWheel` as passive, so a `preventDefault()` in it does
 * nothing (the console says "Unable to preventDefault inside passive event
 * listener"): the page scrolls under a zoom or a stack step instead of the
 * view taking the wheel. These views zoom or scroll a stack with the wheel,
 * so they need the real thing. `targets` is read once the component has
 * mounted; the handler is the latest one, so it may close over render state.
 */
export function useWheel(
  targets: () => ReadonlyArray<HTMLElement | null>,
  onWheel: (e: WheelEvent, target: HTMLElement) => void,
): void {
  const latest = useRef(onWheel);
  latest.current = onWheel;
  useEffect(() => {
    const els = targets().filter((t): t is HTMLElement => t !== null);
    const fns = els.map((el) => {
      const fn = (e: WheelEvent): void => latest.current(e, el);
      el.addEventListener('wheel', fn, { passive: false });
      return fn;
    });
    return () => els.forEach((el, i) => el.removeEventListener('wheel', fns[i]!));
    // the targets are mounted once for the life of the view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
