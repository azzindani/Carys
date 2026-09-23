// One step every loader shares: put a volume with known orientation into
// the display order the MPR panes assume (LPS storage — see
// volume-core/geometry.ts for why), and remember the file's own grid so an
// export can go back to it. A volume without orientation is left exactly as
// stored and carries no geometry: the panes then show no anatomical labels
// rather than guessing them.
import {
  isIdentityReorientation, rasAffineFromGeometry, reorientDims, reorientGeometry, reorientVoxels,
  toLps, type PatientGeometry,
} from '@carys/volume-core';
import type { Plane, SourceLayout, Volume } from './types';

export interface Placement {
  geometry: PatientGeometry;
  qformCode: number;
  sformCode: number;
}

export function toDisplayOrder(v: Volume, placed: Placement | null): Volume {
  if (!placed) return { dims: v.dims, data: v.data, spacing: v.spacing };
  const r = toLps(placed.geometry.direction);
  const source: SourceLayout = {
    dims: v.dims, geometry: placed.geometry, reorient: r,
    qformCode: placed.qformCode, sformCode: placed.sformCode,
  };
  const geometry = reorientGeometry(placed.geometry, v.dims, r);
  if (isIdentityReorientation(r)) {
    return { dims: v.dims, data: v.data, spacing: geometry.spacing, geometry, source };
  }
  return {
    dims: reorientDims(v.dims, r),
    data: reorientVoxels(v.data, v.dims, r),
    spacing: geometry.spacing,
    geometry,
    source,
  };
}

/**
 * A second grid (segmentation, label map) onto the display order of the
 * image it belongs to. With its own orientation it follows that; without
 * one it is taken to share the image's source grid — the usual case for a
 * label file written next to its image — and gets the image's re-layout.
 */
export function alongside(img: Volume, other: Volume): Volume {
  if (other.geometry || !img.source) return other;
  const src = img.source;
  if (other.dims.join() !== src.dims.join()) return other;
  return { ...other, dims: reorientDims(other.dims, src.reorient), data: reorientVoxels(other.data, other.dims, src.reorient), spacing: img.spacing };
}

/** A display-order mask back onto the file's own grid, with its affine. */
export function toSourceOrder(img: Volume, mask: Uint8Array): {
  dims: [number, number, number]; data: Uint8Array; spacing: [number, number, number];
  affine: number[][] | null; qformCode: number; sformCode: number;
} {
  const src = img.source;
  if (!src) {
    return { dims: img.dims, data: mask, spacing: img.spacing ?? [1, 1, 1], affine: null, qformCode: 0, sformCode: 0 };
  }
  return {
    dims: src.dims,
    data: reorientVoxels(mask, src.dims, src.reorient, 'inverse'),
    spacing: src.geometry.spacing,
    affine: rasAffineFromGeometry(src.geometry),
    qformCode: src.qformCode,
    sformCode: src.sformCode,
  };
}

export interface EdgeLabels { left: string; right: string; top: string; bottom: string }

/**
 * Anatomical letters at a pane's edges. Only meaningful once the grid is in
 * display order — which is exactly when it has geometry — so an unplaced
 * volume gets none instead of a confident guess. Coronal and sagittal are
 * drawn superior-up (MprPanes flips k on screen).
 */
export function edgeLabels(img: Volume, plane: Plane): EdgeLabels | null {
  if (!img.geometry) return null;
  if (plane === 'axial') return { left: 'R', right: 'L', top: 'A', bottom: 'P' };
  if (plane === 'coronal') return { left: 'R', right: 'L', top: 'S', bottom: 'I' };
  return { left: 'A', right: 'P', top: 'S', bottom: 'I' };
}
