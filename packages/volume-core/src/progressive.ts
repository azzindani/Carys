// Ported from VolView core/progressiveImage.ts + store/image-cache.ts.
// Sole-owner image cache; views hold IDs, never pixels. Payload is Volume
// (VolView holds vtkImageData — swapped for CPU NdArray equivalent).

import type { Volume } from './types.js';

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface ProgressiveVolume {
  id: string;
  status: LoadStatus;
  error?: string;
  volume: Volume | null;
  startLoad(): Promise<void>;
  stopLoad(): void;
  dispose(): void;
}

export class ImageCache {
  private map = new Map<string, ProgressiveVolume>();
  private deleteHooks: ((id: string) => void)[] = [];

  add(v: ProgressiveVolume): void {
    this.map.set(v.id, v);
  }
  get(id: string): ProgressiveVolume | undefined {
    return this.map.get(id);
  }
  remove(id: string): void {
    const v = this.map.get(id);
    if (v) {
      this.map.delete(id);
      queueMicrotask(() => v.dispose());
      for (const h of this.deleteHooks) h(id);
    }
  }
  onDelete(hook: (id: string) => void): void {
    this.deleteHooks.push(hook);
  }
  get ids(): string[] {
    return [...this.map.keys()];
  }
}
