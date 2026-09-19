// Bounded undo history for small immutable UI state (selections, channel
// visibility, view options). Mask snapshots keep their own RLE ring
// (editor-seg UndoStack); this is the plain-data sibling with the same
// contract: push() snapshots BEFORE a change, undo(current) restores,
// push() after an undo drops the future. No redo — matches house undo.
// Callers must push snapshots they will not mutate afterwards.

export class History<T> {
  private stack: T[] = [];
  constructor(public maxDepth = 32) {}

  /** Snapshot the pre-change state. */
  push(state: T): void {
    this.stack.push(state);
    if (this.stack.length > this.maxDepth) this.stack.shift();
  }

  /** Pop back to the previous snapshot; null when empty (keep current). */
  undo(): T | null {
    if (this.stack.length === 0) return null;
    return this.stack.pop()!;
  }

  clear(): void {
    this.stack = [];
  }

  get canUndo(): boolean {
    return this.stack.length > 0;
  }

  get depth(): number {
    return this.stack.length;
  }
}
