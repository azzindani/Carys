// MPR reslice — worker-side, pure. Output goes to ImageData + Canvas2D.putImageData.
import type { Volume } from '@carys/volume-core';
import { applyWindowLevel, type WindowLevel } from '@carys/volume-core';

export type Plane = 'axial' | 'coronal' | 'sagittal';

export function reslice(
  vol: Volume,
  plane: Plane,
  index: number,
  wl: WindowLevel,
): Uint8ClampedArray {
  const [nx, ny, nz] = vol.dims;
  let w: number;
  let h: number;
  if (plane === 'axial') { w = nx; h = ny; }
  else if (plane === 'coronal') { w = nx; h = nz; }
  else { w = ny; h = nz; }
  const out = new Uint8ClampedArray(w * h * 4);
  const d = vol.data;
  const at = (x: number, y: number, z: number) =>
    d[z * nx * ny + y * nx + x] as number;

  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let v: number;
      if (plane === 'axial') v = at(i, j, index);
      else if (plane === 'coronal') v = at(i, index, j);
      else v = at(index, i, j);
      const g = applyWindowLevel(v, wl);
      const o = (j * w + i) * 4;
      out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
    }
  }
  return out;
}

export function mip(
  vol: Volume,
  plane: Plane,
  wl: WindowLevel,
): Uint8ClampedArray {
  const [nx, ny, nz] = vol.dims;
  let w: number;
  let h: number;
  if (plane === 'axial') { w = nx; h = ny; }
  else if (plane === 'coronal') { w = nx; h = nz; }
  else { w = ny; h = nz; }
  const out = new Uint8ClampedArray(w * h * 4);
  const d = vol.data;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let m = -Infinity;
      if (plane === 'axial') {
        for (let z = 0; z < nz; z++) {
          const v = d[z * nx * ny + j * nx + i] as number;
          if (v > m) m = v;
        }
      } else if (plane === 'coronal') {
        for (let y = 0; y < ny; y++) {
          const v = d[j * nx * ny + y * nx + i] as number;
          if (v > m) m = v;
        }
      } else {
        for (let x = 0; x < nx; x++) {
          const v = d[j * nx * ny + i * nx + x] as number;
          if (v > m) m = v;
        }
      }
      const g = applyWindowLevel(m, wl);
      const o = (j * w + i) * 4;
      out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
    }
  }
  return out;
}
