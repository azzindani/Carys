import { reslice } from '@carys/render-cpu';
import type { WindowLevel } from '@carys/volume-core';

export interface ThumbVolume {
  dims: [number, number, number];
  data: Float64Array;
}

// Middle-axial thumbnail: reslice at full res, box-downsample to `size`.
// Pure function — chrome draws the returned RGBA into a canvas.
export function renderThumbnail(vol: ThumbVolume, wl: WindowLevel, size = 96): { w: number; h: number; rgba: Uint8ClampedArray } {
  const [nx, ny, nz] = vol.dims;
  const full = reslice(
    { dims: vol.dims, spacing: [1, 1, 1], origin: [0, 0, 0], dtype: 'float64', data: vol.data },
    'axial',
    Math.floor(nz / 2),
    wl,
  );
  const scale = Math.min(1, size / Math.max(nx, ny));
  const w = Math.max(1, Math.round(nx * scale));
  const h = Math.max(1, Math.round(ny * scale));
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(nx - 1, Math.floor(x / scale));
      const sy = Math.min(ny - 1, Math.floor(y / scale));
      const si = (sy * nx + sx) * 4;
      const di = (y * w + x) * 4;
      rgba[di] = full[si]!;
      rgba[di + 1] = full[si + 1]!;
      rgba[di + 2] = full[si + 2]!;
      rgba[di + 3] = 255;
    }
  }
  return { w, h, rgba };
}
