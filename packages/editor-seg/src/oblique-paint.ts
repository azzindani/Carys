// Paint on the oblique axial frame: canvas pixels → voxels through the
// tilted frame, then stamp/splat (lattice writes via drawPt). Primitives:
//
// - splatFramePoint: nearest-voxel splat of one frame pixel (the honest
//   cut — a tilted brush is a 3D disk, not a 2D one; the splat lands on
//   the lattice voxel the paint sampled, so undo/redo stay exact).
// - strokeFrameLine: Bresenham in FRAME pixels, splat each step (fills
//   the dotted-stroke gaps CACTAS lacks, same contract as drawPenLine).
//
// The caller owns the frame (same basis + center the paint used) and the
// brush radius in frame pixels. Out-of-bounds splats are dropped, never
// clamped — clamping would smear paint along the volume edge. Pure.
import { drawPt } from './drawing.js';

export interface ObliqueFrame {
  center: [number, number, number];
  row: [number, number, number];
  col: [number, number, number];
}

/** Frame pixel (i, j) on a W×H frame → float voxel (paint-forward map). */
export function frameVoxel(
  frame: ObliqueFrame, W: number, H: number, i: number, j: number,
): [number, number, number] {
  const du = i - W / 2, dv = j - H / 2;
  return [
    frame.center[0] + du * frame.row[0] + dv * frame.col[0],
    frame.center[1] + du * frame.row[1] + dv * frame.col[1],
    frame.center[2] + du * frame.row[2] + dv * frame.col[2],
  ];
}

/**
 * Splat one frame pixel (+ brush disk in frame space) into the mask.
 * Returns the voxel count touched. The disk is sampled on integer frame
 * offsets within radius, each mapped + rounded independently — tilted
 * disks stay disks in the viewed plane.
 */
export function splatFramePoint(
  mask: Uint8Array, dims: [number, number, number],
  frame: ObliqueFrame, W: number, H: number,
  i: number, j: number, radius: number, value: number,
): number {
  const [nx, ny, nz] = dims;
  const rad = Math.max(0, Math.floor(radius));
  let n = 0;
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy > rad * rad) continue;
      const [fx, fy, fz] = frameVoxel(frame, W, H, i + dx, j + dy);
      const x = Math.round(fx), y = Math.round(fy), z = Math.round(fz);
      const before = x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz
        ? -1 : mask[z * nx * ny + y * nx + x]!;
      drawPt(mask, nx, ny, nz, x, y, z, value);
      if (before >= 0 && before !== value) n++;
    }
  }
  return n;
}

/** Frame-space Bresenham between two canvas pixels, splatting each step. */
export function strokeFrameLine(
  mask: Uint8Array, dims: [number, number, number],
  frame: ObliqueFrame, W: number, H: number,
  a: [number, number], b: [number, number], radius: number, value: number,
): number {
  let [x0, y0] = [Math.round(a[0]), Math.round(a[1])];
  const [x1, y1] = [Math.round(b[0]), Math.round(b[1])];
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let n = 0;
  if (dx >= dy) {
    let err = 2 * dy - dx;
    for (let k = 0; k <= dx; k++) {
      n += splatFramePoint(mask, dims, frame, W, H, x0, y0, radius, value);
      if (err > 0) { y0 += sy; err -= 2 * dx; }
      err += 2 * dy; x0 += sx;
    }
  } else {
    let err = 2 * dx - dy;
    for (let k = 0; k <= dy; k++) {
      n += splatFramePoint(mask, dims, frame, W, H, x0, y0, radius, value);
      if (err > 0) { x0 += sx; err -= 2 * dy; }
      err += 2 * dx; y0 += sy;
    }
  }
  return n;
}
