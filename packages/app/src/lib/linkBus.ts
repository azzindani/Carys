// Cross-view link bus: tracks → protein variant handoff. The tracks view
// writes a pending residue target; the protein view consumes it once on
// mount (or live when already mounted) and clears it. Module-level, not
// UiState — the link is a one-shot navigation event, not chrome state,
// and must not persist to localStorage. No DOM here.
export interface ResidueLink {
  chain: string;
  resSeq: number;
  /** human context for the toast/status, e.g. "chr1:101 A>G" */
  label: string;
}

let pending: ResidueLink | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

/** Queue a residue jump (tracks view). Overwrites any unconsumed link:
 *  the newest click wins, stale links never queue. */
export function queueResidueLink(link: ResidueLink): void {
  pending = link;
  emit();
}

/** Take the pending link, clearing it (protein view). Null = nothing queued. */
export function takeResidueLink(): ResidueLink | null {
  const out = pending;
  pending = null;
  return out;
}

/** Peek without consuming (tests + status text). */
export function peekResidueLink(): ResidueLink | null {
  return pending;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function subscribeResidueLink(fn: () => void): () => void {
  return subscribe(fn);
}
