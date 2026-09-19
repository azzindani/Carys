// Island surgery: size-ranked connected components, keep-largest,
// small-speck removal. Built on the 3D 6-neighbour labelling in masks.ts.
import { connectedComponents } from './masks.js';
import type { Dims3 } from './morph.js';

export interface Island {
  label: number;
  size: number;
}

/** Component sizes, descending. Label ids are arbitrary; sizes are stable. */
export function islandSizes(mask: Uint8Array, d: Dims3): Island[] {
  const { labels, count } = connectedComponents(mask, d.nx, d.ny, d.nz);
  const sizes = new Array<number>(count).fill(0);
  for (let i = 0; i < labels.length; i++) {
    if (mask[i]) sizes[labels[i]!]!++;
  }
  return sizes
    .map((size, label) => ({ label, size }))
    .filter((s) => s.size > 0)
    .sort((a, b) => b.size - a.size);
}

/** Keep only the largest component (tumour/organ extraction). */
export function keepLargest(mask: Uint8Array, d: Dims3): Uint8Array {
  const { labels, count } = connectedComponents(mask, d.nx, d.ny, d.nz);
  if (count === 0) return mask.slice();
  const sizes = new Array<number>(count).fill(0);
  for (let i = 0; i < labels.length; i++) {
    if (mask[i]) sizes[labels[i]!]!++;
  }
  let best = 0;
  for (let l = 1; l < count; l++) {
    if (sizes[l]! > sizes[best]!) best = l;
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < labels.length; i++) out[i] = labels[i] === best ? 1 : 0;
  return out;
}

/** Drop components smaller than `minVoxels` (speck cleanup). */
export function removeSmall(mask: Uint8Array, d: Dims3, minVoxels: number): Uint8Array {
  if (minVoxels <= 1) return mask.slice();
  const { labels, count } = connectedComponents(mask, d.nx, d.ny, d.nz);
  const sizes = new Array<number>(count).fill(0);
  for (let i = 0; i < labels.length; i++) {
    if (mask[i]) sizes[labels[i]!]!++;
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < labels.length; i++) {
    out[i] = mask[i] && sizes[labels[i]!]! >= minVoxels ? 1 : 0;
  }
  return out;
}
