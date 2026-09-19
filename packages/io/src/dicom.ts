// DICOM series adapter — runs in Worker, returns transferables, never touches DOM.
// Pattern: readImageDicomFileSeries (ITK-WASM) + Daikon tag read,
// sort by InstanceNumber / SliceLocation. See docs/ARCHITECTURE.md.
import type { Volume } from '@carys/volume-core';

export interface DicomSlice {
  instanceNumber: number;
  sliceLocation?: number;
  rows: number;
  cols: number;
  pixelData: Int16Array | Uint8Array;
  /** zero-based frame index inside its file (multi-frame only) */
  frameIndex?: number;
  /** per-frame ImagePositionPatient from functional groups (Enhanced MR/CT) */
  ipp?: [number, number, number];
  /** per-frame ImageOrientationPatient from functional groups */
  iop?: [number, number, number, number, number, number];
  /** per-frame DimensionIndexValues (FrameContentSequence), if present */
  dimensionIndexValues?: number[];
  /** per-frame PixelSpacing from functional groups (Enhanced MR/CT) */
  pixelSpacing?: [number, number];
  /** per-frame SliceThickness from functional groups */
  sliceThickness?: number;
}

export function sortSlices(slices: DicomSlice[]): DicomSlice[] {
  return [...slices].sort((a, b) => {
    if (a.sliceLocation !== undefined && b.sliceLocation !== undefined) {
      return a.sliceLocation - b.sliceLocation;
    }
    return a.instanceNumber - b.instanceNumber;
  });
}

export function stackToVolume(slices: DicomSlice[]): Volume {
  const sorted = sortSlices(slices);
  if (sorted.length === 0) throw new Error('No DICOM slices');
  const nx = sorted[0].cols;
  const ny = sorted[0].rows;
  const nz = sorted.length;
  const dtype = sorted[0].pixelData instanceof Int16Array ? 'int16' : 'uint8';
  const data =
    dtype === 'int16'
      ? new Int16Array(nx * ny * nz)
      : new Uint8Array(nx * ny * nz);
  sorted.forEach((s, k) => {
    (data as Int16Array).set(s.pixelData as Int16Array, k * nx * ny);
  });
  return {
    dims: [nx, ny, nz],
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    dtype: dtype as Volume['dtype'],
    data,
  };
}
