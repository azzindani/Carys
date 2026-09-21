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

function emit(): void {
  listeners.forEach((l) => l());
}

export function setStatus(text: string, severity: Severity = 'info'): void {
  state = { ...state, text, severity };
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
