// Thick-slab projection: MIP / minIP / mean over a window of slices
// centered at `center` with `thickness` slices (clamped to the volume).
// Windowing is applied AFTER projection (clinical standard: project raw HU,
// then map). Thickness 1 === single-slice reslice.
import type { Volume, WindowLevel } from '@carys/volume-core';
import { applyWindowLevel } from '@carys/volume-core';
import type { Plane } from './mpr.js';

export type SlabMode = 'mip' | 'minip' | 'mean';

function depthOf(dims: [number, number, number], plane: Plane): number {
  return plane === 'axial' ? dims[2] : plane === 'coronal' ? dims[1] : dims[0];
}

function voxelAt(d: ArrayLike<number>, dims: [number, number, number], plane: Plane, i: number, j: number, k: number): number {
  const [nx, ny] = dims;
  return plane === 'axial'
    ? (d[k * nx * ny + j * nx + i] as number)
    : plane === 'coronal'
      ? (d[j * nx * ny + k * nx + i] as number)
      : (d[j * nx * ny + i * nx + k] as number);
}

export function slabRange(depth: number, center: number, thickness: number): { k0: number; k1: number } {
  const t = Math.max(1, Math.floor(thickness));
  const half = Math.floor(t / 2);
  // Preserve thickness at the edges by shifting the window inward.
  const k0 = Math.max(0, Math.min(Math.max(0, depth - t), Math.round(center) - half));
  const k1 = Math.max(k0, Math.min(depth - 1, k0 + t - 1));
  return { k0, k1 };
}

export function slabProject(
  vol: Volume,
  plane: Plane,
  center: number,
  thickness: number,
  mode: SlabMode,
  wl: WindowLevel,
): Uint8ClampedArray {
  const [nx, ny, nz] = vol.dims;
  const w = plane === 'axial' ? nx : plane === 'coronal' ? nx : ny;
  const h = plane === 'axial' ? ny : nz;
  const out = new Uint8ClampedArray(w * h * 4);
  const { k0, k1 } = slabRange(depthOf(vol.dims, plane), center, thickness);
  const d = vol.data;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let acc = mode === 'mip' ? -Infinity : mode === 'minip' ? Infinity : 0;
      for (let k = k0; k <= k1; k++) {
        const v = voxelAt(d, vol.dims, plane, i, j, k);
        if (mode === 'mip') { if (v > acc) acc = v; }
        else if (mode === 'minip') { if (v < acc) acc = v; }
        else acc += v;
      }
      if (mode === 'mean') acc /= k1 - k0 + 1;
      const g = applyWindowLevel(acc, wl);
      const o = (j * w + i) * 4;
      out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
    }
  }
  return out;
}

/** Mask projection for overlay: max over the same slab (any label wins). */
export function slabMask(
  mask: Uint8Array,
  dims: [number, number, number],
  plane: Plane,
  center: number,
  thickness: number,
): Uint8Array {
  const [nx, ny, nz] = dims;
  const w = plane === 'axial' ? nx : plane === 'coronal' ? nx : ny;
  const h = plane === 'axial' ? ny : nz;
  const out = new Uint8Array(w * h);
  const { k0, k1 } = slabRange(depthOf(dims, plane), center, thickness);
  const at = (i: number, j: number, k: number): number =>
    plane === 'axial'
      ? mask[k * nx * ny + j * nx + i]!
      : plane === 'coronal'
        ? mask[j * nx * ny + k * nx + i]!
        : mask[j * nx * ny + i * nx + k]!;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let hit = 0;
      for (let k = k0; k <= k1 && !hit; k++) hit = at(i, j, k) > 0 ? 1 : 0;
      out[j * w + i] = hit;
    }
  }
  return out;
}
