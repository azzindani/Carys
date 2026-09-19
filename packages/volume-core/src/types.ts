// Core types — single source of truth per docs/ARCHITECTURE.md
// Views never own state — they project core. One undo stack owns Annotation[].

export type DType =
  | 'uint8' | 'int8' | 'uint16' | 'int16' | 'uint32' | 'int32'
  | 'float32' | 'float64';

export type TypedArray =
  | Uint8Array | Int8Array | Uint16Array | Int16Array
  | Uint32Array | Int32Array | Float32Array | Float64Array;

export interface Volume {
  dims: [number, number, number]; // [nx, ny, nz]
  spacing: [number, number, number]; // mm per voxel
  origin: [number, number, number];
  dtype: DType;
  data: TypedArray;
}

export type Range = { start: number; end: number };

export interface Selection {
  kind: 'voxel' | 'residue' | 'cell' | 'interval';
  ids: number[] | Range;
}

export interface Annotation {
  id: string;
  label: string;
  mask?: Uint8Array;
  meshRef?: string;
  measurements: Record<string, number>;
}

export function voxelCount(v: Volume): number {
  return v.dims[0] * v.dims[1] * v.dims[2];
}

export function voxelIndex(v: Volume, x: number, y: number, z: number): number {
  return z * v.dims[0] * v.dims[1] + y * v.dims[0] + x;
}
