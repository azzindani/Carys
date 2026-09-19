// Ported from NiiVue packages/niivue/src/nvimage/ (TypeScript, BSD-2).
// Steals: NVImage CPU fields, TypedVoxelArray, ImageType ext map,
// ParsedVolumeData, overlay view-model. Skips: all WebGL texture/upload,
// VolumeTexture/VolumeManager, Zarr streaming (v1).

import type { Volume } from './types.js';

export type TypedVoxelArray =
  | Float32Array | Uint8Array | Int16Array
  | Float64Array | Uint16Array | Int32Array | Uint32Array;

export enum ImageType {
  NII = 'NII', HDR = 'HDR', MIF = 'MIF', NRRD = 'NRRD',
  MHD = 'MHD', MHA = 'MHA', MGH = 'MGH', MGZ = 'MGZ',
  V = 'V', VMR = 'VMR', HEAD = 'HEAD', SRC = 'SRC', FIB = 'FIB',
  BMP = 'BMP', NPY = 'NPY', NPZ = 'NPZ', ZARR = 'ZARR', DCM = 'DCM',
  UNKNOWN = 'UNKNOWN',
}

const EXT_MAP: Record<string, ImageType> = {
  nii: ImageType.NII, 'nii.gz': ImageType.NII, hdr: ImageType.HDR, img: ImageType.HDR,
  mif: ImageType.MIF, mih: ImageType.MIF, nhdr: ImageType.NRRD, nrrd: ImageType.NRRD,
  mhd: ImageType.MHD, mha: ImageType.MHA, mgh: ImageType.MGH, mgz: ImageType.MGZ,
  v16: ImageType.V, vmr: ImageType.VMR, head: ImageType.HEAD, brik: ImageType.HEAD,
  src: ImageType.SRC, fib: ImageType.FIB, bmp: ImageType.BMP, png: ImageType.BMP,
  npy: ImageType.NPY, npz: ImageType.NPZ, zarr: ImageType.ZARR, dcm: ImageType.DCM,
};

export function parseImageType(filename: string): ImageType {
  const lower = filename.toLowerCase();
  for (const ext of Object.keys(EXT_MAP).sort((a, b) => b.length - a.length)) {
    if (lower.endsWith('.' + ext)) return EXT_MAP[ext];
  }
  return ImageType.UNKNOWN;
}

/** CPU-only volume record (NiiVue NVImage fields minus GL). */
export interface NiiVolume {
  name: string;
  volume: Volume;
  colormap: string;
  opacity: number;
  cal_min: number;
  cal_max: number;
  robust_min: number;
  robust_max: number;
  global_min: number;
  global_max: number;
  frame4D: number;
  nFrame4D: number;
  trustCalMinMax: boolean;
}

export interface ParsedVolumeData {
  hdr: NiftiLikeHeader | null;
  imgRaw: ArrayBuffer;
  imageType: ImageType;
}

export interface NiftiLikeHeader {
  dims: [number, number, number];
  pixDims: number[];
  affine: number[][];
  datatypeCode: number;
  scl_slope: number;
  scl_inter: number;
}
