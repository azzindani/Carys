// Viewport layout + crosshair sync geometry (Domain 9). Pure: planes in,
// indices out. The React shell owns sliders/canvases; this owns the math so
// the behavior is unit-tested instead of click-tested.
import type { Plane } from './mpr.js';

export type Dims3 = [number, number, number];
export type Voxel = [number, number, number];
export type MprLayout = 'tri' | Plane;

/** Slice count of a plane for the given volume dims. */
export function sliceCount(dims: Dims3, plane: Plane): number {
  return plane === 'axial' ? dims[2] : plane === 'coronal' ? dims[1] : dims[0];
}

/** Clamp a slice index into a plane's valid range. */
export function clampSlice(idx: number, dims: Dims3, plane: Plane): number {
  const n = sliceCount(dims, plane);
  if (!Number.isFinite(idx)) return 0;
  return Math.min(n - 1, Math.max(0, Math.floor(idx)));
}

/**
 * Crosshair sync: a voxel picked on any plane becomes the slice index of
 * every plane (axial->z, coronal->y, sagittal->x), clamped into range.
 */
export function voxelSlices(voxel: Voxel, dims: Dims3): Record<Plane, number> {
  return {
    axial: clampSlice(voxel[2], dims, 'axial'),
    coronal: clampSlice(voxel[1], dims, 'coronal'),
    sagittal: clampSlice(voxel[0], dims, 'sagittal'),
  };
}

/** Panes visible under a layout: all three, or exactly the focused plane. */
export function visiblePanes(layout: MprLayout): Plane[] {
  return layout === 'tri' ? ['axial', 'coronal', 'sagittal'] : [layout];
}
