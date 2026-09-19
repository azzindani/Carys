// Mathematical morphology on binary labelmaps: erode / dilate / open /
// close / outline / smooth / mm-margins. 6-connected cross structuring
// element, pure functions, out-of-place (callers own undo).
import { NEIGHBORS6 } from './drawing.js';

export interface Dims3 {
  nx: number;
  ny: number;
  nz: number;
}

const idx = (d: Dims3, x: number, y: number, z: number): number => x + y * d.nx + z * d.nx * d.ny;

function pass(mask: Uint8Array, d: Dims3, erode: boolean): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let z = 0; z < d.nz; z++) {
    for (let y = 0; y < d.ny; y++) {
      for (let x = 0; x < d.nx; x++) {
        const i = idx(d, x, y, z);
        if (erode) {
          let ok = mask[i] === 1;
          for (const [ox, oy, oz] of NEIGHBORS6) {
            const xx = x + ox, yy = y + oy, zz = z + oz;
            if (xx < 0 || yy < 0 || zz < 0 || xx >= d.nx || yy >= d.ny || zz >= d.nz || mask[idx(d, xx, yy, zz)] !== 1) {
              ok = false;
              break;
            }
          }
          out[i] = ok ? 1 : 0;
        } else {
          let hit = mask[i] === 1;
          for (const [ox, oy, oz] of NEIGHBORS6) {
            const xx = x + ox, yy = y + oy, zz = z + oz;
            if (xx < 0 || yy < 0 || zz < 0 || xx >= d.nx || yy >= d.ny || zz >= d.nz) continue;
            if (mask[idx(d, xx, yy, zz)] === 1) { hit = true; break; }
          }
          out[i] = hit ? 1 : 0;
        }
      }
    }
  }
  return out;
}

/** Erode `iterations` times (peels boundary layers). */
export function erode(mask: Uint8Array, d: Dims3, iterations = 1): Uint8Array {
  let out: Uint8Array = mask.slice();
  for (let i = 0; i < iterations; i++) out = pass(out, d, true);
  return out;
}

/** Dilate `iterations` times (grows boundary layers). */
export function dilate(mask: Uint8Array, d: Dims3, iterations = 1): Uint8Array {
  let out: Uint8Array = mask.slice();
  for (let i = 0; i < iterations; i++) out = pass(out, d, false);
  return out;
}

/** Opening: erode then dilate (removes thin bridges and specks). */
export function open(mask: Uint8Array, d: Dims3, iterations = 1): Uint8Array {
  return dilate(erode(mask, d, iterations), d, iterations);
}

/** Closing: dilate then erode (fills narrow gaps and notches). */
export function close(mask: Uint8Array, d: Dims3, iterations = 1): Uint8Array {
  return erode(dilate(mask, d, iterations), d, iterations);
}

/** Boundary voxels (mask minus its erosion): the editable outline. */
export function outline(mask: Uint8Array, d: Dims3): Uint8Array {
  const e = erode(mask, d, 1);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] === 1 && e[i] !== 1 ? 1 : 0;
  return out;
}

/** Mean-filter smooth: average the 6-neighbourhood, keep >= 0.5. */
export function smoothMask(mask: Uint8Array, d: Dims3, iterations = 1): Uint8Array {
  let cur = Float64Array.from(mask);
  for (let it = 0; it < iterations; it++) {
    const next = new Float64Array(mask.length);
    for (let z = 0; z < d.nz; z++) {
      for (let y = 0; y < d.ny; y++) {
        for (let x = 0; x < d.nx; x++) {
          let sum = cur[idx(d, x, y, z)]!;
          let n = 1;
          for (const [ox, oy, oz] of NEIGHBORS6) {
            const xx = x + ox, yy = y + oy, zz = z + oz;
            if (xx < 0 || yy < 0 || zz < 0 || xx >= d.nx || yy >= d.ny || zz >= d.nz) continue;
            sum += cur[idx(d, xx, yy, zz)]!;
            n++;
          }
          next[idx(d, x, y, z)] = sum / n;
        }
      }
    }
    cur = next;
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = cur[i]! >= 0.5 ? 1 : 0;
  return out;
}

/** Grow/shrink the mask by millimetres using voxel spacing. */
export function marginMm(
  mask: Uint8Array, d: Dims3, spacing: [number, number, number], mm: number,
): Uint8Array {
  const iters = Math.max(1, Math.round(Math.abs(mm) / Math.min(spacing[0], spacing[1], spacing[2])));
  return mm >= 0 ? dilate(mask, d, iters) : erode(mask, d, iters);
}

/** Voxel count (for before/after toasts and QA). */
export function countVoxels(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}
