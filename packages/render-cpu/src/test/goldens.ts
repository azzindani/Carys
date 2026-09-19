// Golden-render helper: .nii -> Volume -> mid-axial reslice (+ seg overlay).
// Exercises the real pipeline: nifti1.readHeader/readImage, slope/inter,
// histogram percentile auto-window, mpr.reslice, overlay tint.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readHeader, readImage, parseDicomSlice, sortSlices, stackToVolume } from '@carys/io';
import { histogram, windowLevelFromRange } from '@carys/volume-core';
import type { Volume } from '@carys/volume-core';
import { reslice } from '../mpr.js';
import { encodePngRgba } from './png.js';

function toVolume(path: string): { vol: Volume; slope: number; inter: number } {
  const raw = readFileSync(path);
  const buf = Uint8Array.from(raw).buffer as ArrayBuffer;
  const h = readHeader(buf);
  const bytes = readImage(h, buf);
  const n = h.dims[0] * h.dims[1] * h.dims[2];
  const data =
    h.dtype === 'int16' ? new Int16Array(bytes)
    : h.dtype === 'uint16' ? new Uint16Array(bytes)
    : h.dtype === 'int32' ? new Int32Array(bytes)
    : h.dtype === 'uint32' ? new Uint32Array(bytes)
    : h.dtype === 'float32' ? new Float32Array(bytes)
    : h.dtype === 'float64' ? new Float64Array(bytes)
    : h.dtype === 'int8' ? new Int8Array(bytes)
    : new Uint8Array(bytes);
  const trimmed = data.length > n ? data.slice(0, n) : data;
  return {
    vol: {
      dims: h.dims, spacing: [h.pixDims[1]!, h.pixDims[2]!, h.pixDims[3]!],
      origin: [0, 0, 0], dtype: h.dtype, data: trimmed,
    } as Volume,
    slope: h.scl_slope, inter: h.scl_inter,
  };
}

function loadDicomVolume(paths: string[]): Volume {
  const parsed = paths.map((p) => {
    const buf = Uint8Array.from(readFileSync(p)).buffer as ArrayBuffer;
    return parseDicomSlice(buf);
  });
  // order along scan: sliceLocation, fallback instanceNumber
  const order = new Map(parsed.map((s) => [s.slice, s.meta.sliceLocation ?? s.meta.instanceNumber ?? 0]));
  const slices = sortSlices(parsed.map((s) => s.slice)).sort(
    (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );
  const stacked = stackToVolume(slices);
  const n = stacked.dims[0] * stacked.dims[1] * stacked.dims[2];
  const disp = new Float64Array(n);
  for (let i = 0; i < n; i++) disp[i] = stacked.data[i] as number;
  return { ...stacked, data: disp, dtype: 'float64' } as Volume;
}

function renderDicomGolden(spec: GoldenSpec): { png: Uint8Array; sha256: string; w: number; h: number } {
  const dvol = loadDicomVolume(spec.dicomSeries!);
  const wl = percentileWindow(dvol.data as ArrayLike<number>);
  const z = Math.floor(dvol.dims[2] * (spec.sliceFrac ?? 0.5));
  const out = reslice(dvol, 'axial', z, wl);
  const png = encodePngRgba(out, dvol.dims[0], dvol.dims[1]);
  return {
    png,
    sha256: createHash('sha256').update(png).digest('hex'),
    w: dvol.dims[0], h: dvol.dims[1],
  };
}

function percentileWindow(data: ArrayLike<number>, lo = 0.02, hi = 98): { center: number; width: number } {
  const { hist, min, max } = histogram(data, 256);
  const total = data.length;
  const at = (q: number) => {
    let acc = 0;
    for (let b = 0; b < hist.length; b++) {
      acc += hist[b]!;
      if (acc / total >= q / 100) return min + ((b + 0.5) / 256) * (max - min || 1);
    }
    return max;
  };
  return windowLevelFromRange(at(lo), at(hi));
}

const DTYPE_ARRAYS = {
  uint8: Uint8Array, int8: Int8Array, uint16: Uint16Array, int16: Int16Array,
  uint32: Uint32Array, int32: Int32Array, float32: Float32Array, float64: Float64Array,
} as const;

/** Load a .nii as a float field (slope/intercept applied) for isosurfaces. */
export function loadField(path: string): { dims: [number, number, number]; data: Float64Array } {
  const raw = readFileSync(path);
  const buf = Uint8Array.from(raw).buffer as ArrayBuffer;
  const h = readHeader(buf);
  const bytes = readImage(h, buf);
  const A = new (DTYPE_ARRAYS[h.dtype] ?? Uint8Array)(bytes) as ArrayLike<number>;
  const n = h.dims[0] * h.dims[1] * h.dims[2];
  const data = new Float64Array(n);
  const useSlope = Number.isFinite(h.scl_slope) && h.scl_slope !== 0;
  for (let i = 0; i < n && i < A.length; i++) {
    data[i] = useSlope ? A[i]! * h.scl_slope + h.scl_inter : A[i]!;
  }
  return { dims: h.dims, data };
}

/** Load a .nii as a binary mask volume for surface extraction. */
export function loadMask(path: string, threshold = 0): { dims: [number, number, number]; mask: Uint8Array } {
  const raw = readFileSync(path);
  const buf = Uint8Array.from(raw).buffer as ArrayBuffer;
  const h = readHeader(buf);
  const bytes = readImage(h, buf);
  const A = new (DTYPE_ARRAYS[h.dtype] ?? Uint8Array)(bytes) as ArrayLike<number>;
  const n = h.dims[0] * h.dims[1] * h.dims[2];
  const mask = new Uint8Array(n);
  for (let i = 0; i < n && i < A.length; i++) mask[i] = A[i]! > threshold ? 1 : 0;
  return { dims: h.dims, mask };
}

export interface GoldenSpec {
  name: string;
  img?: string;
  dicomSeries?: string[];
  seg?: string;
  sliceFrac?: number; // fraction of nz, default 0.5
}

export function renderGolden(spec: GoldenSpec): { png: Uint8Array; sha256: string; w: number; h: number } {
  if (spec.dicomSeries) return renderDicomGolden(spec);
  const { vol, slope, inter } = toVolume(spec.img!);
  const n = vol.dims[0] * vol.dims[1] * vol.dims[2];
  // apply slope/intercept for display
  const disp = new Float64Array(n);
  const useSlope = Number.isFinite(slope) && slope !== 0;
  for (let i = 0; i < n; i++) disp[i] = useSlope ? (vol.data[i] as number) * slope + inter : (vol.data[i] as number);
  const wl = percentileWindow(disp);
  const z = Math.floor(vol.dims[2] * (spec.sliceFrac ?? 0.5));
  // reslice needs a Volume; build display volume (float64 covered by DType)
  const dvol = { ...vol, data: disp, dtype: 'float64' } as Volume;
  const out = reslice(dvol, 'axial', z, wl);
  if (spec.seg) {
    const s = toVolume(spec.seg);
    const sn = s.vol.dims[0] * s.vol.dims[1] * s.vol.dims[2];
    if (sn === n) {
      const [nx, ny] = vol.dims;
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          if ((s.vol.data[z * nx * ny + y * nx + x] as number) > 0) {
            const o = (y * nx + x) * 4;
            out[o] = 255; out[o + 1] = 60; out[o + 2] = 60;
          }
        }
      }
    }
  }
  const png = encodePngRgba(out, vol.dims[0], vol.dims[1]);
  return {
    png,
    sha256: createHash('sha256').update(png).digest('hex'),
    w: vol.dims[0], h: vol.dims[1],
  };
}
