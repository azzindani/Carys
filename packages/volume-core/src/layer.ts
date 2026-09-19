// Port of VolView layering + Neuroglancer datasource abstraction (CPU cut).
// VolView: TS + ITK-WASM, no server, layers of volumes/meshes.
// Neuroglancer: datasource abstraction (precomputed/N5/Zarr/NIfTI) + 4-pane
// linked navigation (3 orthogonal + 3D share one center). We steal the
// layering + navigation, NOT the VTK/WebGL path.

import type { DataSource } from './datasource.js';

export interface Layer {
  id: string;
  source: DataSource;
  visible: boolean;
  opacity: number;
}

/** 4-pane linked navigation: all panes share one center, own orientation. */
export interface LinkedView {
  /** voxel-space shared center */
  center: [number, number, number];
  axial: number;
  coronal: number;
  sagittal: number;
}

export function moveCenter(v: LinkedView, to: [number, number, number]): LinkedView {
  return { ...v, center: to };
}
