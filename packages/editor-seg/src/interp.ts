// Shape-based slice interpolation: signed chamfer distance transforms of
// two key slices are lerped, then thresholded at zero. Produces morphing
// intermediates instead of cross-fades. fillGaps() propagates labels across
// empty z-runs between annotated slices.
import type { Dims3 } from './morph.js';

/** Approximate signed distance: + outside, - inside (chamfer 3-4, 2 passes). */
export function signedDistance(slice: Uint8Array, w: number, h: number): Float64Array {
  const INF = w + h;
  const dist = new Float64Array(w * h);
  for (let i = 0; i < slice.length; i++) dist[i] = slice[i] ? 0 : INF;
  // forward: distance to nearest labelled voxel (outside distance)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) dist[i] = Math.min(dist[i]!, dist[i - 1]! + 3);
      if (y > 0) dist[i] = Math.min(dist[i]!, dist[i - w]! + 3);
      if (x > 0 && y > 0) dist[i] = Math.min(dist[i]!, dist[i - w - 1]! + 4);
      if (x < w - 1 && y > 0) dist[i] = Math.min(dist[i]!, dist[i - w + 1]! + 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) dist[i] = Math.min(dist[i]!, dist[i + 1]! + 3);
      if (y < h - 1) dist[i] = Math.min(dist[i]!, dist[i + w]! + 3);
      if (x < w - 1 && y < h - 1) dist[i] = Math.min(dist[i]!, dist[i + w + 1]! + 4);
      if (x > 0 && y < h - 1) dist[i] = Math.min(dist[i]!, dist[i + w - 1]! + 4);
    }
  }
  // inside distance: same transform on the inverted slice, then sign
  const inv = new Uint8Array(slice.length);
  for (let i = 0; i < slice.length; i++) inv[i] = slice[i] ? 0 : 1;
  const inside = new Float64Array(w * h).fill(INF);
  for (let i = 0; i < inv.length; i++) if (inv[i]) inside[i] = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) inside[i] = Math.min(inside[i]!, inside[i - 1]! + 3);
      if (y > 0) inside[i] = Math.min(inside[i]!, inside[i - w]! + 3);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) inside[i] = Math.min(inside[i]!, inside[i + 1]! + 3);
      if (y < h - 1) inside[i] = Math.min(inside[i]!, inside[i + w]! + 3);
    }
  }
  const sdf = new Float64Array(w * h);
  for (let i = 0; i < slice.length; i++) {
    sdf[i] = slice[i] ? -inside[i]! / 3 : dist[i]! / 3;
  }
  return sdf;
}

/** Morph slice a -> b at fraction t (0 = a, 1 = b). */
export function interpolateSlices(
  a: Uint8Array, b: Uint8Array, w: number, h: number, t: number,
): Uint8Array {
  const da = signedDistance(a, w, h);
  const db = signedDistance(b, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    out[i] = da[i]! * (1 - t) + db[i]! * t <= 0 ? 1 : 0;
  }
  return out;
}

function sliceHas(mask: Uint8Array, d: Dims3, z: number): boolean {
  const off = z * d.nx * d.ny;
  for (let i = 0; i < d.nx * d.ny; i++) {
    if (mask[off + i]) return true;
  }
  return false;
}

/**
 * Fill empty z-runs between annotated slices by shape morphing.
 * Leading/trailing empties are left alone (no keyframe to morph from).
 * Returns the number of slices filled.
 */
export function fillGaps(mask: Uint8Array, d: Dims3): { mask: Uint8Array; filled: number } {
  const out = mask.slice();
  const keys: number[] = [];
  for (let z = 0; z < d.nz; z++) {
    if (sliceHas(mask, d, z)) keys.push(z);
  }
  let filled = 0;
  for (let k = 0; k + 1 < keys.length; k++) {
    const z0 = keys[k]!, z1 = keys[k + 1]!;
    if (z1 - z0 < 2) continue;
    const a = mask.subarray(z0 * d.nx * d.ny, (z0 + 1) * d.nx * d.ny);
    const b = mask.subarray(z1 * d.nx * d.ny, (z1 + 1) * d.nx * d.ny);
    for (let z = z0 + 1; z < z1; z++) {
      const t = (z - z0) / (z1 - z0);
      const m = interpolateSlices(a, b, d.nx, d.ny, t);
      out.set(m, z * d.nx * d.ny);
      filled++;
    }
  }
  return { mask: out, filled };
}
