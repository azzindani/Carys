import { useSyncExternalStore } from 'react';

// Render-version counter. Imperative session mutations (volume load, mask
// edit, undo) call bump(); chrome subscribed via useVersion() re-renders.
// Canvases repaint in effects — never in render.
let version = 0;
const listeners = new Set<() => void>();

export function bump(): void {
  version++;
  listeners.forEach((l) => l());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}
