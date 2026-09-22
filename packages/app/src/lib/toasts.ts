import { useSyncExternalStore } from 'react';
import type { Severity } from './status';

export interface Toast {
  id: number;
  msg: string;
  severity: Severity;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

/** Errors hold longer than confirmations — you need time to read a failure. */
const DWELL: Record<Severity, number> = { info: 2600, ok: 2600, warn: 4200, error: 6000 };

export function toast(msg: string, severity: Severity = 'info'): void {
  const id = nextId++;
  toasts = [...toasts, { id, msg, severity }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, DWELL[severity]);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts, () => toasts);
}
