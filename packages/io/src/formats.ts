// Ported from NiiVue nvimage/utils.ts ImageType + FileLoader ext dispatch.
// Single dispatcher: filename -> ImageType -> loader hint. CPU-only; each
// reader behind it stays a Worker pure function. nrrd is live (nrrd.ts);
// Zarr/DICOM-series stay staged behind their loaders.

import { parseImageType, ImageType } from '@carys/volume-core';

export { parseImageType, ImageType };

export type LoaderHint =
  | 'nifti1' | 'nrrd' | 'mrtrix' | 'afni' | 'mgh' | 'itk'
  | 'ecat' | 'dsistudio' | 'brainvoyager' | 'numpy' | 'bitmap'
  | 'zarr-staged' | 'dicom-series' | 'unsupported';

const HINT_MAP: Record<string, LoaderHint> = {
  [ImageType.NII]: 'nifti1', [ImageType.HDR]: 'nifti1',
  [ImageType.NRRD]: 'nrrd', [ImageType.MIF]: 'mrtrix',
  [ImageType.HEAD]: 'afni', [ImageType.MGH]: 'mgh', [ImageType.MGZ]: 'mgh',
  [ImageType.MHD]: 'itk', [ImageType.MHA]: 'itk',
  [ImageType.SRC]: 'dsistudio', [ImageType.FIB]: 'dsistudio',
  [ImageType.V]: 'brainvoyager', [ImageType.VMR]: 'brainvoyager',
  [ImageType.NPY]: 'numpy', [ImageType.NPZ]: 'numpy',
  [ImageType.BMP]: 'bitmap',
  [ImageType.ZARR]: 'zarr-staged', [ImageType.DCM]: 'dicom-series',
};

export function loaderHint(filename: string): LoaderHint {
  return HINT_MAP[parseImageType(filename)] ?? 'unsupported';
}

/** Mesh extensions (NiiVue FileLoader MESH_EXTENSIONS, CPU subset). */
const MESH_EXTS = new Set([
  'gii', 'mz3', 'stl', 'obj', 'ply', 'off', 'asc', 'vtk',
  'dfs', 'nv', 'srf', 'x3d', 'fsm', 'pial', 'orig', 'white',
]);

export function isMeshFile(filename: string): boolean {
  const parts = filename.toLowerCase().split('.');
  return MESH_EXTS.has(parts[parts.length - 1]);
}
