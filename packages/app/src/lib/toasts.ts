import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  msg: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function toast(msg: string): void {
  const id = nextId++;
  toasts = [...toasts, { id, msg }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 2600);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts, () => toasts);
}
