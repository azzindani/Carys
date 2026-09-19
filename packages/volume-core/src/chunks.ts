// Ported from Neuroglancer chunk_manager (base + frontend interfaces).
// ChunkState + VISIBLE/PREFETCH/RECENT tiers + capacity spec. Backend
// (worker eviction heaps, RPC) collapsed to in-process LRU (see cache.ts).

export type ChunkState =
  | 'new' | 'queued' | 'downloading'
  | 'system-memory' | 'failed' | 'expired';

export enum PriorityTier {
  VISIBLE = 0,
  PREFETCH = 1,
  RECENT = 2,
}

export interface CapacitySpec {
  sizeLimit?: number;
  itemLimit?: number;
}

export interface ChunkRequest {
  key: string;
  tier: PriorityTier;
  sizeEstimate?: number;
}

/** Minimal queue manager: tier-ordered dedup queue over an LRU fetch. */
export class ChunkQueueManager<T> {
  private queue: ChunkRequest[] = [];
  private pending = new Set<string>();

  constructor(
    private fetch: (key: string) => Promise<T>,
    public capacity: CapacitySpec = { itemLimit: 128 },
  ) {}

  request(r: ChunkRequest): void {
    if (this.pending.has(r.key)) return;
    this.pending.add(r.key);
    this.queue.push(r);
    this.queue.sort((a, b) => a.tier - b.tier);
  }

  async drain(onChunk: (key: string, value: T) => void): Promise<void> {
    while (this.queue.length) {
      const r = this.queue.shift()!;
      this.pending.delete(r.key);
      try {
        onChunk(r.key, await this.fetch(r.key));
      } catch {
        // mark failed, continue (Neuroglancer FAILED state, lite)
      }
    }
  }

  get depth(): number {
    return this.queue.length;
  }
}
