import { Component, Suspense } from 'react';
import type { ErrorInfo, JSX, ReactNode } from 'react';

/**
 * The frame every code-split route renders inside.
 *
 * Only the viewer ships in the boot chunk; the other seven routes arrive on
 * first visit. That buys a smaller first paint and costs one new failure: the
 * image serves hashed chunks as immutable, so a tab left open across a
 * redeploy asks for a chunk name the new image no longer has. Without a
 * boundary that rejected import unmounts the whole shell to a blank page — so
 * the failure is caught here, said out loud, and answered with the one fix
 * that works (a reload fetches the current index.html and its chunk names).
 */
export function RouteSuspense({ route, children }: { route: string; children: ReactNode }): JSX.Element {
  // Keyed by route: navigating away from a failed route resets the boundary
  // instead of leaving every later route stuck on the error card.
  return (
    <ChunkBoundary key={route}>
      <Suspense fallback={<div className="route-stub" role="status"><p>Loading {route}…</p></div>}>
        {children}
      </Suspense>
    </ChunkBoundary>
  );
}

class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The card below is what the user sees; this keeps the cause for whoever
    // opens devtools after them.
    console.error('route failed to load', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="route-stub" role="alert">
        <h1>This view did not load</h1>
        <p>Carys was probably updated since this tab opened. Reloading picks up the current version.</p>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
