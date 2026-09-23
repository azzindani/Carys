// The Curve tool on the 2D panes (F16): a tap adds a point (the voxel under
// it) to the session's curve, and every pane draws the curve the
// straightened view follows (render-cpu/cpr.ts cprPath), its clicks as
// dots: filled on the slice they were clicked on, hollow elsewhere.
import { centerlineLength, cprPath } from '@carys/render-cpu';
import { CURVE_COLOR, CURVE_DIM } from '../lib/palette';
import { session } from '../lib/session';
import { setStatus } from '../lib/status';
import { bump } from '../lib/version';
import type { Plane } from '../lib/types';
import { planePoint, type PaintHost, type TapEvent } from './PanePaint';
import { toScreen, type PaneView } from './paneView';

type V3 = [number, number, number];

/** A voxel on a pane: its (u, w) there (centre of the voxel), and its slice. */
function onPane(p: V3, plane: Plane): { u: number; w: number; slice: number } {
  return plane === 'axial' ? { u: p[0] + 0.5, w: p[1] + 0.5, slice: p[2] }
    : plane === 'coronal' ? { u: p[0] + 0.5, w: p[2] + 0.5, slice: p[1] }
      : { u: p[1] + 0.5, w: p[2] + 0.5, slice: p[0] };
}

/** The curve's length so far, mm, or null under two points. */
export function curveLength(): number | null {
  const c = session.curve, img = session.img;
  if (!c || !img || c.pts.length < 2) return null;
  const sp = img.spacing ?? [1, 1, 1];
  return centerlineLength(cprPath(c.pts, sp, Math.min(sp[0], sp[1], sp[2]) / 2), sp).total;
}

/** A Curve-tool tap: the voxel under it joins the curve. */
export function curveClick(host: PaintHost, plane: Plane, e: TapEvent): void {
  const hit = planePoint(host, e, plane);
  if (!hit) return;
  if (!session.curve) session.curve = { plane, pts: [] };
  const pts = session.curve.pts;
  const last = pts[pts.length - 1];
  const v = hit.voxel3;
  if (last && last[0] === v[0] && last[1] === v[1] && last[2] === v[2]) return;
  pts.push([v[0], v[1], v[2]]);
  const mm = curveLength();
  setStatus(pts.length < 2
    ? 'curve: 1 point — click on along the vessel or spine'
    : `curve: ${pts.length} points · ${mm!.toFixed(1)} mm — the straightened view is under the 3D`);
  bump();
}

/** The curve on one pane, over its image. */
export function drawCurve(ctx: CanvasRenderingContext2D, plane: Plane, v: PaneView, idx: number): void {
  const c = session.curve, img = session.img;
  if (!c || !img || c.pts.length === 0) return;
  const sp = img.spacing ?? [1, 1, 1];
  ctx.save();
  ctx.lineWidth = 1.5;
  if (c.pts.length > 1) {
    ctx.strokeStyle = CURVE_COLOR;
    ctx.beginPath();
    cprPath(c.pts, sp, Math.min(sp[0], sp[1], sp[2])).forEach((p, i) => {
      const q = onPane(p, plane), [x, y] = toScreen(v, q.u, q.w);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  for (const p of c.pts) {
    const q = onPane(p, plane), [x, y] = toScreen(v, q.u, q.w);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
    if (Math.abs(q.slice - idx) < 0.5) { ctx.fillStyle = CURVE_COLOR; ctx.fill(); } else { ctx.strokeStyle = CURVE_DIM; ctx.stroke(); }
  }
  ctx.restore();
}
