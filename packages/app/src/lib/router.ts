import { useCallback, useEffect, useState } from 'react';

// Minimal hash router: viewer + worklist + report + protein + cells + tracks + atlas + learn.
export type Route = 'viewer' | 'worklist' | 'report' | 'protein' | 'cells' | 'tracks' | 'atlas' | 'learn';

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (h === 'worklist' || h === 'report' || h === 'protein' || h === 'cells' || h === 'tracks' || h === 'atlas' || h === 'learn') return h;
  return 'viewer';
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onChange = (): void => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const go = useCallback((r: Route) => {
    window.location.hash = `#/${r === 'viewer' ? '' : r}`;
  }, []);
  return [route, go];
}
