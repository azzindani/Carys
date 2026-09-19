// Ported from CACTAS mask ops (drawer.js Q/C, util.py, compare.py).
// Binarize + proper 3D connected-components (CACTAS cv.connectedComponents on
// a flat volume is dimensionally wrong — reimplemented as 3D 6-neigh BFS) +
// Jaccard eval. UNet.âtraining Python deliberately NOT ported (out of scope).

import { NEIGHBORS6 } from './drawing.js';

export function binarize(mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] > 0 ? 1 : 0;
  return out;
}

/** 3D 6-neighbour connected components. Returns label image + count. */
export function connectedComponents(
  mask: Uint8Array, nx: number, ny: number, nz: number,
): { labels: Int32Array; count: number } {
  const labels = new Int32Array(mask.length).fill(-1);
  let count = 0;
  const idx = (x: number, y: number, z: number) => x + y * nx + z * nx * ny;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i] !== -1) continue;
    const q: number[] = [i];
    labels[i] = count;
    while (q.length) {
      const c = q.pop()!;
      const cx = c % nx, cy = Math.floor(c / nx) % ny, cz = Math.floor(c / (nx * ny));
      for (const [ox, oy, oz] of NEIGHBORS6) {
        const x = cx + ox, y = cy + oy, z = cz + oz;
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
        const n = idx(x, y, z);
        if (!mask[n] || labels[n] !== -1) continue;
        labels[n] = count;
        q.push(n);
      }
    }
    count++;
  }
  return { labels, count };
}

/** Jaccard |A∩B|/|A∪B| (CACTAS compare.py / util.py). */
export function jaccard(a: Uint8Array, b: Uint8Array): number {
  let inter = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] > 0, y = b[i] > 0;
    if (x && y) inter++;
    if (x || y) union++;
  }
  return union === 0 ? 1 : inter / union;
}
