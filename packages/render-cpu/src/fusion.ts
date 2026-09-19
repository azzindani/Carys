// Dual-volume fusion + follow-up subtraction: two registered volumes, one
// pane. Checkerboard / alpha-blend / subtract composites over grayscale
// windowed samples — mask tinting stays the caller's job (it runs after,
// like every other overlay). Pure, no DOM.
import { applyWindowLevel, type WindowLevel } from '@carys/volume-core';
import type { Volume } from '@carys/volume-core';
import type { Plane } from './mpr.js';

export type FusionMode = 'checker' | 'alpha' | 'subtract';

/** Voxel of plane pixel (i, j) at slice index (orthogonal, clamped). */
function planeVoxel(
  plane: Plane, dims: [number, number, number], i: number, j: number, index: number,
): [number, number, number] {
  const [nx, ny, nz] = dims;
  if (plane === 'axial') {
    return [
      Math.max(0, Math.min(nx - 1, i)), Math.max(0, Math.min(ny - 1, j)),
      Math.max(0, Math.min(nz - 1, index)),
    ];
  }
  if (plane === 'coronal') {
    return [
      Math.max(0, Math.min(nx - 1, i)), Math.max(0, Math.min(ny - 1, index)),
      Math.max(0, Math.min(nz - 1, j)),
    ];
  }
  return [
    Math.max(0, Math.min(nx - 1, index)), Math.max(0, Math.min(ny - 1, i)),
    Math.max(0, Math.min(nz - 1, j)),
  ];
}

/** Nearest sample of a volume at a voxel (volumes may differ in dims). */
function sampleAt(vol: Volume, v: [number, number, number]): number {
  const [nx, ny] = vol.dims;
  return vol.data[v[2] * nx * ny + v[1] * nx + v[0]] as number;
}

/**
 * Fuse the base slice with the overlay slice. Both volumes are sampled on
 * the BASE geometry (plane pixel grid + base slice index); the overlay is
 * nearest-mapped, so unregistered or differently-sized overlays degrade to
 * a loud-ish visual mismatch rather than a crash — registration quality is
 * the caller's contract, documented at the call site.
 *
 * checker: N×N alternating tiles (default 16px); alpha: linear blend;
 * subtract: signed overlay−base difference mapped through the base window
 * around its center (no-change = mid-gray).
 */
export function fuseSlices(
  base: Volume, overlay: Volume, plane: Plane, index: number,
  baseWl: WindowLevel, overWl: WindowLevel,
  mode: FusionMode, alpha = 0.5, checker = 16,
): Uint8ClampedArray {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new RangeError(`fusion-bad-alpha: ${alpha}`);
  }
  if (!Number.isInteger(checker) || checker < 2) {
    throw new RangeError(`fusion-bad-checker: ${checker}`);
  }
  const [nx, ny, nz] = base.dims;
  const w = plane === 'axial' ? nx : plane === 'coronal' ? nx : ny;
  const h = plane === 'axial' ? ny : nz;
  const out = new Uint8ClampedArray(w * h * 4);
  // overlay pixel scale vs base pixels (nearest map, per axis)
  const sx = base.dims[0] / overlay.dims[0];
  const sy = base.dims[1] / overlay.dims[1];
  const sz = base.dims[2] / overlay.dims[2];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [x, y, z] = planeVoxel(plane, base.dims, i, j, index);
      const bv = sampleAt(base, [x, y, z]);
      const [ox, oy, oz] = overlay.dims;
      const ov = sampleAt(overlay, [
        Math.max(0, Math.min(ox - 1, Math.round(x / sx))),
        Math.max(0, Math.min(oy - 1, Math.round(y / sy))),
        Math.max(0, Math.min(oz - 1, Math.round(z / sz))),
      ]);
      let g: number;
      if (mode === 'checker') {
        const useOver = (Math.floor(i / checker) + Math.floor(j / checker)) % 2 === 1;
        g = useOver ? applyWindowLevel(ov, overWl) : applyWindowLevel(bv, baseWl);
      } else if (mode === 'alpha') {
        g = Math.round(
          applyWindowLevel(bv, baseWl) * (1 - alpha) + applyWindowLevel(ov, overWl) * alpha,
        );
      } else {
        // subtract: difference re-centered on the base window center so
        // unchanged tissue renders mid-gray, growth bright, shrinkage dark
        const half = Math.max(1, baseWl.width / 2);
        const t = (ov - bv) / half; // ±1 = full window swing
        g = Math.max(0, Math.min(255, Math.round(127.5 + t * 127.5)));
      }
      const o = (j * w + i) * 4;
      out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
    }
  }
  return out;
}
