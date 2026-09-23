// Shared domain types for the app shell. Engine math stays in packages/*;
// this file only describes what flows between chrome and canvas.
import type { PatientGeometry, Reorientation } from '@carys/volume-core';

export type View = 'mpr';
/** Fullscreen viewport: null = grid, 'v3d' = 3D, or one 2D plane. */
export type Tool = 'view' | 'paint' | 'erase' | 'grow' | 'measure';
export type MeasureKind = 'length' | 'angle' | 'probe' | 'ellipse' | 'roi' | 'cobb';
export type Source = 'mask' | 'image';
export type Method = 'blocky' | 'smooth';
export type Plane = 'axial' | 'coronal' | 'sagittal';

export interface Volume {
  dims: [number, number, number];
  data: Float64Array;
  spacing?: [number, number, number];
  /** Where this grid sits in the patient (LPS). Present only when the file
   *  said so; the viewer then holds the grid in LPS order (lib/orient.ts). */
  geometry?: PatientGeometry;
  /** The file's own grid, kept so exports land back on it exactly. */
  source?: SourceLayout;
}

/** A volume's grid as the file stored it, and how the viewer re-laid it out. */
export interface SourceLayout {
  dims: [number, number, number];
  geometry: PatientGeometry;
  reorient: Reorientation;
  /** NIfTI xform codes to write back (1 = scanner anatomical for DICOM). */
  qformCode: number;
  sformCode: number;
}

export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  tris: number;
}

/** Pinned streamlines (tractogram import): fence-posted offsets into xyz triplets. */
export interface FiberSet {
  pts: Float32Array;
  offsetPt0: Uint32Array;
  /** streamlines with at least 2 points */
  count: number;
  /** per-point scalars (TRK n_scalars / TRX dps), for along-tract profiles */
  scalars: Float32Array | null;
  /** scalar name (TRX dps key) or count label (TRK) */
  scalarName: string | null;
}

export interface SeriesSpec {
  img?: string[];
  seg?: string[];
  /** A seg voxel is foreground above this (0 for labels; 0.5 for a probability map). */
  segThreshold?: number;
  dicom?: string[];
  /** hanging-protocol hints: modality + free-text body part */
  modality?: string;
  bodyPart?: string;
  /** 4D cine NIfTI: retain raw bytes for frame switching */
  time?: boolean;
  color?: [number, number, number];
  axialFrac?: number;
  threshold3d?: number;
  source?: 'nifti' | 'dicom' | 'upload';
  /** Which stack of `dicom` to open when the files hold several (io/dicom-stack). */
  stackIndex?: number;
  /** PACS-pulled series: resolved on demand via DICOMweb. */
  remote?: { endpoint: string; studyUID: string; seriesUID: string };
}

export type ProjMode = 'slice' | 'mip' | 'minip' | 'mean';

/** Dual-volume compare: off, or which second volume rides along. */
export type CompareMode = 'off' | 'checker' | 'alpha' | 'subtract';

/** Viewport layout: equal thirds, or one plane emphasized in the 2D stack. */
export type MprLayout = 'tri' | Plane;
/** Fullscreen viewport: null = grid, 'v3d' = 3D viewport, or one 2D plane. */
export type FullVp = null | 'v3d' | Plane;
/** Mobile viewport: single viewport fills the stage (no scroll anywhere). */
export type MView = 'v3d' | Plane;
/** Mobile toggle panel: null = all closed. Desktop ignores this. */
export type MSheet = null | 'tools' | 'display' | 'files' | 'nav';

export type Render3D = 'surface' | 'volume';

/** Appearance: UI text scale + layout size (chrome prefs, persisted, 5 levels each). */
export type TextSize = 'xs' | 's' | 'm' | 'l' | 'xl';
export type Density = 'xs' | 's' | 'm' | 'l' | 'xl';

export interface UiState {
  view: View;
  render3d: Render3D;
  tool: Tool;
  src: Source;
  method: Method;
  /** 3D surface smoothing, 0 (as extracted) … 1; volume-preserving (F4) */
  smooth3d: number;
  preset: string;
  overlay: boolean;
  brush: number;
  threshold: number;
  series: string;
  /** thick-slab projection (orthogonal planes); 'slice' = single slice */
  proj: ProjMode;
  slab: number;
  /** region-grow intensity window */
  growLo: number;
  growHi: number;
  measureKind: MeasureKind;
  /** viewport layout + crosshair sync across planes */
  layout: MprLayout;
  sync: boolean;
  /** applied hanging-protocol id ('default' = none/auto fallback) */
  hang: string;
  /** dual-volume compare: fused overlay series + mode ('off' = single) */
  compareSeries: string;
  compareMode: CompareMode;
  /** overlay blend 0..1 (alpha mode only) */
  compareAlpha: number;
  /** axial obliquity in radians; 0 = orthogonal (painting needs 0) */
  oblA: number;
  oblB: number;
  /** double-oblique: which plane the tilt applies to (axial default) */
  oblPlane: Plane;
  /** open files (tabs); empty = derive from series */
  tabs: string[];
  /** fullscreen viewport (Esc exits) */
  fullVp: FullVp;
  /** mobile single viewport + open toggle panel (desktop ignores both) */
  mView: MView;
  mSheet: MSheet;
  /** desktop toolbar row visible (mobile uses toggle panels instead) */
  docksOpen: boolean;
  /** desktop details panel visible; collapsing gives its column to the image */
  insOpen: boolean;
  /** cine playback rate (fps); playing flag itself is ephemeral module state */
  cineFps: number;
  /** inverted grayscale (OHIF Invert): applied post-window, pre-overlay */
  invert: boolean;
  /** 2D pane colormap (Papaya LUT name; 'Grayscale' = identity fast path) */
  lut: string;
  /** appearance prefs (persisted to localStorage, applied to <html>) */
  textSize: TextSize;
  density: Density;
}

export const PLANES: Plane[] = ['axial', 'coronal', 'sagittal'];
