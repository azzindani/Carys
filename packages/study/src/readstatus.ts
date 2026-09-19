// Worklist → read → sign flow (local-only): per-series read status with
// a double-read lock. Statuses: unread → reading → read → signed. Signing
// requires read state + locks the row (further opens need an explicit
// unlock, which itself is audited). MPPS N-CREATE stays out — no backend,
// no DIMSE; the status model is the shippable claim, transport is the
// product call.
export type ReadStatus = 'unread' | 'reading' | 'read' | 'signed';

export interface ReadState {
  status: ReadStatus;
  reader: string | null;
  secondReader: string | null;
  signedAt: string | null;
  locked: boolean;
}

const states = new Map<string, ReadState>();

function fresh(): ReadState {
  return { status: 'unread', reader: null, secondReader: null, signedAt: null, locked: false };
}

/** Current state (fresh default, never undefined). */
export function readState(series: string): ReadState {
  return states.get(series) ?? fresh();
}

/** Opening a series marks it reading (unless signed+locked). */
export function markReading(series: string, reader = 'local'): ReadState {
  const cur = readState(series);
  if (cur.locked) return cur;
  const next: ReadState = {
    ...cur, status: cur.status === 'unread' ? 'reading' : cur.status, reader,
  };
  states.set(series, next);
  return next;
}

/** Reader finishes the read (reading → read). Returns null when illegal. */
export function markRead(series: string): ReadState | null {
  const cur = readState(series);
  if (cur.locked || (cur.status !== 'reading' && cur.status !== 'read')) return null;
  const next: ReadState = { ...cur, status: 'read' };
  states.set(series, next);
  return next;
}

/**
 * Sign the read (read → signed + locked). A second reader name enables
 * the double-read path (recorded, not enforced — enforcement needs
 * identity, which needs auth). Signs only from read state.
 */
export function signRead(series: string, secondReader?: string): ReadState | null {
  const cur = readState(series);
  if (cur.locked || cur.status !== 'read') return null;
  const next: ReadState = {
    ...cur, status: 'signed', locked: true,
    secondReader: secondReader ?? null, signedAt: new Date().toISOString(),
  };
  states.set(series, next);
  return next;
}

/** Unlock a signed row (audited by the caller). Returns null when unlocked. */
export function unlockRead(series: string): ReadState | null {
  const cur = readState(series);
  if (!cur.locked) return null;
  const next: ReadState = { ...cur, locked: false, status: 'read' };
  states.set(series, next);
  return next;
}

/** Reset (tests). Returns the dropped count. */
export function readClear(): number {
  const n = states.size;
  states.clear();
  return n;
}
