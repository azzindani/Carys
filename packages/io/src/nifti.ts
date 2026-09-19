// NIfTI adapter — header via NIFTI-Reader-JS pattern + pako inflate.
// Runs in Worker. See docs/ARCHITECTURE.md.
import type { Volume } from '@carys/volume-core';

export interface NiftiHeader {
  dims: [number, number, number];
  datatype:
    | 'uint8' | 'int8' | 'uint16' | 'int16' | 'uint32' | 'int32'
    | 'float32' | 'float64';
  slope?: number;
  intercept?: number;
}

export function headerToVolume(
  header: NiftiHeader,
  raw: Uint8Array | Int16Array | Float32Array,
): Volume {
  return {
    dims: header.dims,
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    dtype: header.datatype,
    data: raw,
  };
}

// Minimal magic check: .nii (348) or .nii.gz (gzip 1f 8b)
export function isNiftiLike(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return true; // gzip
  const view = new DataView(bytes.buffer, bytes.byteOffset, 4);
  return view.getInt32(0, true) === 348 || view.getInt32(0, false) === 348;
}
