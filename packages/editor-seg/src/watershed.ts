// Marker-free watershed split (Fiji binary-Watershed family, CPU): Manhattan
// distance transform of the mask, then one Vincent–Soille-style flood in
// DECREASING distance order with union of neighbour basins — voxels where
// two basins meet become watershed lines (cleared). Splits touching blobs
// at shape necks; pure shape-based, no image gradient involved (stated).
// 6-connectivity throughout, matching connectedComponents. Only ever
// removes voxels (the divide lines), never adds — safe + undoable.

import { NEIGHBORS6 } from './drawing.js';
import type { Dims3 } from './morph.js';

const WATERSHED = -2;
const UNVISITED = -1;

/** Manhattan distance transform of the foreground (BFS from background). */
export function manhattanDistance(mask: Uint8Array, d: Dims3): Int32Array {
  const { nx, ny, nz } = d;
  const n = nx * ny * nz;
  const dist = new Int32Array(n);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i]) {
      dist[i] = 0;
      queue.push(i);
    } else {
      dist[i] = -1;
    }
  }
  const idx = (x: number, y: number, z: number): number => x + y * nx + z * nx * ny;
  let head = 0;
  while (head < queue.length) {
    const c = queue[head++]!;
    const cx = c % nx, cy = Math.floor(c / nx) % ny, cz = Math.floor(c / (nx * ny));
    for (const [ox, oy, oz] of NEIGHBORS6) {
      const x = cx + ox, y = cy + oy, z = cz + oz;
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
      const ni = idx(x, y, z);
      if (dist[ni] === -1) {
        dist[ni] = dist[c]! + 1;
        queue.push(ni);
      }
    }
  }
  return dist;
}

export interface SplitResult {
  mask: Uint8Array;
  /** basins found (= markers a seeded run would have had) */
  basins: number;
  /** voxels cleared as watershed lines */
  removed: number;
}

/**
 * Split touching components at shape necks. Floods the distance transform
 * top-down, one level at a time: each level first spreads from settled
 * basins (FIFO), then every still-unlabeled patch founds exactly one new
 * basin — so flat plateaus and isolated voxels behave, and only true
 * multi-peak shapes split. Voxels claimed while touching two basins become
 * watershed lines (cleared). Single blobs, empty masks, and separated
 * islands return the input unchanged (removed 0).
 */
export function watershedSplit(mask: Uint8Array, d: Dims3): SplitResult {
  const { nx, ny, nz } = d;
  const n = nx * ny * nz;
  const dist = manhattanDistance(mask, d);
  const label = new Int32Array(n).fill(UNVISITED);
  const idx = (x: number, y: number, z: number): number => x + y * nx + z * nx * ny;
  const coords = (i: number): [number, number, number] =>
    [i % nx, Math.floor(i / nx) % ny, Math.floor(i / (nx * ny))];
  const basinNeighbors = (i: number): number[] => {
    const [cx, cy, cz] = coords(i);
    const seen: number[] = [];
    for (const [ox, oy, oz] of NEIGHBORS6) {
      const x = cx + ox, y = cy + oy, z = cz + oz;
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
      const l = label[idx(x, y, z)]!;
      if (l >= 0 && !seen.includes(l)) seen.push(l);
    }
    return seen;
  };
  let basins = 0;
  let maxDist = 0;
  for (let i = 0; i < n; i++) if (mask[i] && dist[i]! > maxDist) maxDist = dist[i]!;
  for (let h = maxDist; h >= 1; h--) {
    for (;;) {
      // seed: unlabeled level-h voxels touching a settled basin
      const queue: number[] = [];
      for (let i = 0; i < n; i++) {
        if (mask[i] && dist[i] === h && label[i] === UNVISITED && basinNeighbors(i).length > 0) {
          queue.push(i);
        }
      }
      let head = 0;
      while (head < queue.length) {
        const v = queue[head++]!;
        if (label[v] !== UNVISITED) continue;
        const s = basinNeighbors(v);
        if (s.length === 0) continue; // neighbor relabeled watershed meanwhile; leftover phase decides
        if (s.length > 1) {
          label[v] = WATERSHED;
          continue;
        }
        label[v] = s[0]!;
        const [cx, cy, cz] = coords(v);
        for (const [ox, oy, oz] of NEIGHBORS6) {
          const x = cx + ox, y = cy + oy, z = cz + oz;
          if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
          const u = idx(x, y, z);
          if (mask[u] && dist[u] === h && label[u] === UNVISITED) queue.push(u);
        }
      }
      // leftovers: each connected patch founds one basin, then spreads
      const seeds: number[] = [];
      for (let i = 0; i < n; i++) {
        if (mask[i] && dist[i] === h && label[i] === UNVISITED) seeds.push(i);
      }
      // Terminates: every leftover is labeled below, so the next pass
      // finds none. Each pass labels ≥1 voxel.
      if (seeds.length === 0) break;
      const seenPatch = new Set<number>();
      for (const s of seeds) {
        if (label[s] !== UNVISITED || seenPatch.has(s)) continue;
        const id = basins++;
        const stack: number[] = [s];
        seenPatch.add(s);
        while (stack.length) {
          const v = stack.pop()!;
          if (label[v] !== UNVISITED) continue;
          label[v] = id;
          const [cx, cy, cz] = coords(v);
          for (const [ox, oy, oz] of NEIGHBORS6) {
            const x = cx + ox, y = cy + oy, z = cz + oz;
            if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
            const u = idx(x, y, z);
            if (mask[u] && dist[u] === h && label[u] === UNVISITED && !seenPatch.has(u)) {
              seenPatch.add(u);
              stack.push(u);
            }
          }
        }
      }
    }
  }
  if (basins < 2) return { mask: Uint8Array.from(mask), basins, removed: 0 };
  const out = new Uint8Array(n);
  let removed = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] && label[i] !== WATERSHED) out[i] = 1;
    else if (mask[i]) removed++;
  }
  return { mask: out, basins, removed };
}
