// Where a reslice lands on screen, and where a pointer lands in the reslice.
//
// A pane's slice is a W×H grid of voxels whose two axes rarely have the
// same size in millimetres: a 512×512×58 chest CT has 0.94 mm pixels and
// 5 mm slices, so its coronal is 512 by 58 voxels and 480 by 290 mm. The
// canvas used to be that voxel grid, stretched to fit by CSS — which drew
// every reformat of every thick-slice series squashed flat, and scaled the
// labels and scale bar with the volume (tiny on a 512 grid, huge on a 64).
//
// Now the canvas is the pane's own pixels, and this is the one mapping
// between them: millimetre-true aspect, fit to the box, zoom and pan, and
// the vertical flip that puts superior at the top of coronal and sagittal.
// Painting, measuring and the crosshair all go through it, both ways.
import type { Plane } from '../lib/types';

export interface PaneView {
  /** reslice grid: voxels along the pane's u (right) and v (down) axes */
  W: number; H: number;
  /** CSS px per voxel along u and v */
  sx: number; sy: number;
  /** CSS px of the image's top-left corner inside the canvas box */
  ox: number; oy: number;
  /** v runs up the screen (coronal/sagittal of a placed volume) */
  flipV: boolean;
  /** the canvas box, CSS px */
  bw: number; bh: number;
}

/** mm per voxel along a plane's (u, v) axes. */
export function planeSpacing(plane: Plane, sp: [number, number, number]): [number, number] {
  return plane === 'axial' ? [sp[0], sp[1]] : plane === 'coronal' ? [sp[0], sp[2]] : [sp[1], sp[2]];
}

/**
 * Fit a W×H reslice with (su, sv) mm voxels into a bw×bh box: zoom 1 fills
 * the box on its tighter side (the old object-fit: contain), then zoom
 * scales about the box centre and pan shifts in CSS px.
 */
export function fitPane(
  W: number, H: number, su: number, sv: number, bw: number, bh: number,
  zoom: number, pan: { x: number; y: number }, flipV: boolean,
): PaneView {
  const mmW = W * (su > 0 ? su : 1), mmH = H * (sv > 0 ? sv : 1);
  const k = Math.min(bw / mmW, bh / mmH) * zoom;
  const sx = k * (su > 0 ? su : 1), sy = k * (sv > 0 ? sv : 1);
  return {
    W, H, sx, sy, flipV, bw, bh,
    ox: (bw - W * sx) / 2 + pan.x,
    oy: (bh - H * sy) / 2 + pan.y,
  };
}

/** Reslice coords (continuous; voxel centres at +0.5) → CSS px in the box. */
export function toScreen(v: PaneView, u: number, w: number): [number, number] {
  return [v.ox + u * v.sx, v.flipV ? v.oy + (v.H - w) * v.sy : v.oy + w * v.sy];
}

/** CSS px in the box → reslice coords (continuous; floor for the voxel). */
export function toBitmap(v: PaneView, x: number, y: number): [number, number] {
  const u = (x - v.ox) / v.sx;
  const w = (y - v.oy) / v.sy;
  return [u, v.flipV ? v.H - w : w];
}

/** Nicest 1/2/5×10ⁿ mm bar no longer than `maxPx`, and its length in px. */
export function scaleBar(mmPerPx: number, maxPx: number): { mm: number; px: number } | null {
  if (!(mmPerPx > 0) || !(maxPx > 0)) return null;
  const target = maxPx * mmPerPx;
  const pow = 10 ** Math.floor(Math.log10(target));
  const mm = [5 * pow, 2 * pow, pow].find((c) => c <= target) ?? pow;
  return { mm, px: mm / mmPerPx };
}
