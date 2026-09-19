// Rotating maximum-intensity projection: the slab.ts MIP is axis-aligned
// (axial/coronal/sagittal, thickness window); this marches parallel rays along
// the oblique view normal from obliqueBasis(), so the MIP can tumble with the
// same orbit/tilt convention as the mesh rasterizer and volume raycaster.
// Windowing is applied AFTER projection (clinical standard, matches slab.ts).
import type { Volume, WindowLevel } from '@carys/volume-core';
import { applyWindowLevel } from '@carys/volume-core';
import type { Plane } from './mpr.js';
import { obliqueBasis, sampleTrilinear } from './oblique.js';

export interface MipRotateOpts {
  plane?: Plane;
  /** yaw about Y (radians), same convention as vr.ts/raster.ts */
  angleY?: number;
  /** pitch about X (radians) */
  tiltX?: number;
  /** ray reduction: max (MIP) gent, min, or mean over in-bounds samples */
  mode?: 'max' | 'min' | 'mean';
  w: number;
  h: number;
  wl: WindowLevel;
  /** ray step in voxels (default 1 = every voxel along the ray) */
  step?: number;
}

/**
 * Full-depth MIP along the (angleY, tiltX) view direction, framed on the
 * volume center. Out-of-bounds ray segments contribute nothing; rays that
 * never hit the volume render windowed background (0 -> wl-mapped black).
 */
export function mipRotate(vol: Volume, opts: MipRotateOpts): Uint8ClampedArray {
  const { row, col, normal } = obliqueBasis(opts.plane ?? 'axial', opts.tiltX ?? 0, opts.angleY ?? 0);
  const [nx, ny, nz] = vol.dims;
  const cx = (nx - 1) / 2, cy = (ny - 1) / 2, cz = (nz - 1) / 2;
  const R = Math.hypot(nx, ny, nz) / 2;
  const step = Math.max(0.25, opts.step ?? 1);
  const mode = opts.mode ?? 'max';
  const out = new Uint8ClampedArray(opts.w * opts.h * 4);
  // Symmetric grid about t=0 (the center plane): axis-aligned rays land on
  // voxel planes instead of straddling them, so full-depth coverage is exact.
  const n = Math.ceil(R / step);
  for (let j = 0; j < opts.h; j++) {
    for (let i = 0; i < opts.w; i++) {
      const ox = cx + (i - opts.w / 2) * row[0] + (j - opts.h / 2) * col[0];
      const oy = cy + (i - opts.w / 2) * row[1] + (j - opts.h / 2) * col[1];
      const oz = cz + (i - opts.w / 2) * row[2] + (j - opts.h / 2) * col[2];
      let acc = mode === 'min' ? Infinity : mode === 'mean' ? 0 : -Infinity;
      let hits = 0;
      for (let k = -n; k <= n; k++) {
        const t = k * step;
        const v = sampleTrilinear(vol.data, vol.dims, [ox - normal[0] * t, oy - normal[1] * t, oz - normal[2] * t]);
        if (v == null) continue;
        hits++;
        if (mode === 'min') { if (v < acc) acc = v; }
        else if (mode === 'mean') acc += v;
        else if (v > acc) acc = v;
      }
      const proj = mode === 'mean' ? acc / hits : acc;
      const g = hits === 0 ? 0 : applyWindowLevel(proj, opts.wl);
      const o = (j * opts.w + i) * 4;
      out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
    }
  }
  return out;
}
