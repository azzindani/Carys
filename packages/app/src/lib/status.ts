import { useSyncExternalStore } from 'react';

/**
 * Severity for the status line and toasts.
 *
 * Without this every message rendered in the same muted grey, so
 * "loading…" and "TID1500 import failed: truncated" looked identical.
 * CODING-STANDARDS §12 asks decoders to fail loud and §14 asks the user to
 * be told, not the console — a failure that reads like idle chatter does
 * neither.
 */
export type Severity = 'info' | 'ok' | 'warn' | 'error';

interface StatusState {
  text: string;
  severity: Severity;
  engine: string;
}

let state: StatusState = { text: 'loading…', severity: 'info', engine: 'cpu' };
const listeners = new Set<() => void>();
/** How long a result stays readable against background chatter (ms). */
const RESULT_HOLD_MS = 3000;
let heldUntil = 0;

function emit(): void {
  listeners.forEach((l) => l());
}

/**
 * Something the user did has an outcome to report. A result holds the line
 * for a few seconds against ambient updates; progress ("fetching…",
 * "extracting…" — text ending in an ellipsis) does not, because it is
 * superseded by whatever finishes it.
 */
export function setStatus(text: string, severity: Severity = 'info'): void {
  state = { ...state, text, severity };
  heldUntil = text.endsWith('…') ? 0 : Date.now() + RESULT_HOLD_MS;
  emit();
}

/**
 * Background chatter: a pane repainting, a surface landing from the idle
 * extractor. It used to share setStatus, so the frame an import caused
 * overwrote the import's own result ("US cine: 2 frames @ 26 fps" became
 * "80 tris via worker" before anyone could read it). Ambient text shows
 * only when no result is being held.
 */
export function setAmbientStatus(text: string): void {
  if (Date.now() < heldUntil) return;
  state = { ...state, text, severity: 'info' };
  emit();
}

export function setEngine(engine: string): void {
  state = { ...state, engine };
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useStatus(): StatusState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
