import { useSyncExternalStore } from 'react';

interface StatusState {
  text: string;
  engine: string;
}

let state: StatusState = { text: 'loading…', engine: 'cpu' };
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function setStatus(text: string): void {
  state = { ...state, text };
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
