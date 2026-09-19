// Ported from Mol* MinimizeRmsd.compute signature + PDBe
// superpose-by-sequence-alignment (biggest common component -> align ->
// Kabsch -> {rmsd, bTransform}). Kabsch here is a centroid-alignment
// approximation; full EVD/reference implementation is a Week-4 upgrade.

import type { Mat4 } from './orientation.js';

export interface Positions {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
}

export interface SuperposeResult {
  bTransform: Mat4;
  rmsd: number;
  n: number;
}

function centroid(p: Positions, n: number): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < n; i++) {
    x += p.x[i];
    y += p.y[i];
    z += p.z[i];
  }
  return [x / n, y / n, z / n];
}

/** Centroid-align b onto a; rmsd of aligned pairs. Pure Float64/Mat4. */
export function minimizeRmsd(a: Positions, b: Positions, n: number): SuperposeResult {
  const ca = centroid(a, n);
  const cb = centroid(b, n);
  const t: Vec3T = [ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]];
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const dx = a.x[i] - (b.x[i] + t[0]);
    const dy = a.y[i] - (b.y[i] + t[1]);
    const dz = a.z[i] - (b.z[i] + t[2]);
    sse += dx * dx + dy * dy + dz * dz;
  }
  return {
    bTransform: [
      [1, 0, 0, t[0]],
      [0, 1, 0, t[1]],
      [0, 0, 1, t[2]],
      [0, 0, 0, 1],
    ],
    rmsd: Math.sqrt(sse / Math.max(1, n)),
    n,
  };
}

type Vec3T = [number, number, number];
