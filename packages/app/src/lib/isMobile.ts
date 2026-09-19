import { useEffect, useState } from 'react';

/** Breakpoint twin of the CSS `@media (max-width: 980px)` viewer rules.
 *  Components that must render different chrome (not just restyle) branch
 *  on this; everything else stays CSS-only. */
const QUERY = '(max-width: 980px)';

function current(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(QUERY).matches;
}

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(current);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (): void => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}
