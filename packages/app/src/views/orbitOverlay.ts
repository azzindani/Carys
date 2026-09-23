// What the 3D view draws over the rendered surface: tract polylines and the
// synced 2D cursor. Split out of SurfaceView (rule 1: one module, one job)
// when F6's interactive/settled repaint needed the room. Everything is in
// mm (lib/physical3d.ts), on the same orbit, tilt, zoom and centre as the
// surface, so a line or dot lands on the pixel it names.
import { cursorAxes, cursorOnCanvas, projectCursor, projectFibers } from '@carys/render-cpu';
import { ACCENT } from '../lib/palette';
import { physicalPoints, toMm } from '../lib/physical3d';
import type { FiberSet } from '../lib/types';

type V3 = [number, number, number];

/** The frame both overlays share with the surface. */
export interface OrbitView {
  width: number;
  height: number;
  angleY: number;
  tiltX: number;
  zoom: number;
  center?: V3;
}

/** Direction-coloured polylines (tractography convention), far to near. */
export function drawFibers(ctx: CanvasRenderingContext2D, fibers: FiberSet, sp: V3, box: V3, view: OrbitView): void {
  const lines = projectFibers(physicalPoints(fibers.pts, sp), fibers.offsetPt0, box, view)
    .filter((l) => l.length > 1).sort((a, b) => a[0]!.z - b[0]!.z);
  ctx.lineWidth = 1.5;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      ctx.strokeStyle = `rgb(${Math.round(255 * Math.abs(dx) / l)},${Math.round(255 * Math.abs(dy) / l)},${Math.round(255 * Math.abs(dz) / l)})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}

/**
 * V2 3D cursor: the synced 2D tap (session.crosshair) drawn in 3D —
 * NiiVue's "crosshair visible in 3D". Short axis nubs, not full-span
 * lines: a marker, never a measurement claim. An out-of-volume crosshair
 * (a stale series switch) draws nothing; the 2D panes already clamp.
 */
export function drawCursor3d(ctx: CanvasRenderingContext2D, ch: V3, sp: V3, box: V3, view: OrbitView): void {
  try {
    const at = toMm(ch, sp);
    const dot = projectCursor(at, box, view);
    if (!cursorOnCanvas(dot, view)) return;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    for (const seg of cursorAxes(at, box, view, 6)) {
      ctx.beginPath();
      ctx.moveTo(seg.a.x, seg.a.y);
      ctx.lineTo(seg.b.x, seg.b.y);
      ctx.stroke();
    }
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, 3, 0, Math.PI * 2);
    ctx.fill();
  } catch {
    // out of volume: the 3D view stays clean
  }
}
