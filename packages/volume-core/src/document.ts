// Ported from NiiVue nvdocument.ts (DocumentData/Scene/NVConfigOptions subset).
// CPU-only: volumes + meshes + drawBitmap + scene nav + drawing opts.
// Skips: GL render opts, thumbnails, interaction bindings.

import type { NiiVolume } from './nvimage.js';
import type { Mesh } from './mesh.js';

export type SliceType = 'axial' | 'coronal' | 'sagittal' | 'multiplanar' | 'render';
export type PenType = 'pen' | 'rectangle' | 'ellipse';

export interface Scene {
  crosshairPos: [number, number, number];
  gamma: number;
  azimuth: number;
  elevation: number;
  volScaleMultiplier: number;
}

export interface ConfigOptions {
  sliceType: SliceType;
  drawingEnabled: boolean;
  penValue: number;
  penType: PenType;
  penSize: number;
  isFilledPen: boolean;
  floodFillNeighbors: 6 | 18 | 26;
  maxDrawUndoBitmaps: number;
  drawFillOverwrites: boolean;
}

export interface ViewerDocument {
  volumes: NiiVolume[];
  meshes: Mesh[];
  drawBitmap: Uint8Array | null;
  scene: Scene;
  opts: ConfigOptions;
}

export const DEFAULT_SCENE: Scene = {
  crosshairPos: [0.5, 0.5, 0.5],
  gamma: 1.0,
  azimuth: 110,
  elevation: 10,
  volScaleMultiplier: 1.0,
};

export const DEFAULT_OPTS: ConfigOptions = {
  sliceType: 'multiplanar',
  drawingEnabled: false,
  penValue: 1,
  penType: 'pen',
  penSize: 1,
  isFilledPen: false,
  floodFillNeighbors: 6,
  maxDrawUndoBitmaps: 8,
  drawFillOverwrites: true,
};
