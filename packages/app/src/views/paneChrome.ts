// What a 2D pane draws over its image, in screen px: the crosshair, the
// anatomical edge letters, the scale bar and the measurements. Split out of
// MprPanes (rule 1: one module, one job) — it reads the session and the pane
// mapping, never the component's refs, so it needs only the canvas it draws on.
import { ACCENT, ACCENT_DIM, ACCENT_DIM_FILL, ACCENT_HI, CHROME_FONT_PX, CHROME_HALO, CHROME_TEXT, MONO_STACK, ON_ACCENT } from '../lib/palette';
import { edgeLabels } from '../lib/orient';
import { session } from '../lib/session';
import { getUi } from '../lib/store';
import type { MeasureKind, Plane } from '../lib/types';
import { planeSpacing, scaleBar, toScreen, type PaneView } from './paneView';

/** A measurement value with its unit, as the pane label and toast show it. */
export const fmtVal = (kind: MeasureKind, v: number): string =>
  kind === 'length' ? `${v.toFixed(1)} mm` : kind === 'angle' || kind === 'cobb' ? `${v.toFixed(0)}°`
    : kind === 'ellipse' || kind === 'roi' ? `${v.toFixed(1)} mm²` : `${Math.round(v)}`;

/** CSS px of the canvas' left edge (at height y) under the floating tool
 *  strip, 0 when the strip is elsewhere or hidden (mobile). */
function stripInset(cv: HTMLCanvasElement, y: number): number {
  const strip = document.querySelector('.toolstrip');
  if (!strip) return 0;
  const r = cv.getBoundingClientRect(), t = strip.getBoundingClientRect();
  const yy = r.top + y;
  if (t.width === 0 || yy < t.top || yy > t.bottom || t.right <= r.left || t.left >= r.left + r.width / 2) return 0;
  return t.right - r.left;
}

/** Viewport chrome in screen px: crosshair, anatomical edge letters
 *  (placed volumes only) and a millimetre scale bar. */
export function drawChrome(
  ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, plane: Plane, v: PaneView, dpr: number,
): void {
  const img = session.img;
  if (!img) return;
  const fs = CHROME_FONT_PX;
  ctx.font = `${fs}px ${MONO_STACK}`;
  ctx.fillStyle = CHROME_TEXT;
  // crosshair reference lines (OHIF Reference Lines): the synced voxel
  // drawn on every pane, same axis convention as planePoint.
  const ch = session.crosshair;
  if (ch && getUi().sync) {
    const [cu, cw] = plane === 'axial' ? [ch[0], ch[1]] : plane === 'coronal' ? [ch[0], ch[2]] : [ch[1], ch[2]];
    // Centred on a device pixel: a 1px reference line at a fractional
    // position smears into two half-strength columns and reads as noise.
    const crisp = (c: number): number => (Math.floor(c * dpr) + 0.5) / dpr;
    const [sx0, sy0] = toScreen(v, cu + 0.5, cw + 0.5);
    const x = crisp(sx0), y = crisp(sy0);
    const [x0, y0] = toScreen(v, 0, v.flipV ? v.H : 0);
    const [x1, y1] = toScreen(v, v.W, v.flipV ? 0 : v.H);
    ctx.strokeStyle = ACCENT_DIM;
    ctx.lineWidth = 1 / dpr;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x, y0); ctx.lineTo(x, y1);
    ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Text over imagery needs its own contrast: a dark halo, as the DOM
  // corner readouts get from text-shadow.
  ctx.shadowColor = CHROME_HALO;
  ctx.shadowBlur = 3;
  const lab = edgeLabels(img, plane);
  if (lab) {
    // Mid-edge letters, the way every reading workstation marks a pane.
    // Top/bottom sit below/above the corner readout rows; the left one
    // steps past the floating tool strip when it covers this pane's edge.
    const pad = 8, inset = pad + fs * 3.2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(lab.left, pad + stripInset(cv, v.bh / 2), v.bh / 2);
    ctx.textAlign = 'right';
    ctx.fillText(lab.right, v.bw - pad, v.bh / 2);
    ctx.textAlign = 'center';
    ctx.fillText(lab.top, v.bw / 2, inset);
    ctx.fillText(lab.bottom, v.bw / 2, v.bh - inset);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }
  // scale bar along u, bottom-centre, never longer than a fifth of the box
  const [su] = planeSpacing(plane, img.spacing ?? [1, 1, 1]);
  const bar = scaleBar(su / v.sx, v.bw / 5);
  if (bar && bar.px > 12) {
    const x0 = (v.bw - bar.px) / 2, y0 = v.bh - 8;
    ctx.strokeStyle = CHROME_TEXT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0 + bar.px, y0);
    ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 2);
    ctx.moveTo(x0 + bar.px, y0 - 4); ctx.lineTo(x0 + bar.px, y0 + 2);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(`${bar.mm >= 10 ? Math.round(bar.mm) : bar.mm} mm`, v.bw / 2, y0 - 6);
    ctx.textAlign = 'left';
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

/** Tracked measurements for this plane+slice, drawn in screen px. Points
 *  are voxel taps; they are drawn at voxel centres through the pane map. */
export function drawMeasures(ctx: CanvasRenderingContext2D, plane: Plane, v: PaneView, idx: number): void {
  const rows = session.measurements.filter((m) => m.plane === plane && m.slice === idx);
  const pend = session.pendingPlane === plane ? session.pendingMeasure : [];
  const fs = CHROME_FONT_PX;
  const at = (p: [number, number]): [number, number] => toScreen(v, p[0] + 0.5, p[1] + 0.5);
  const dot = 3;
  ctx.font = `${fs}px ${MONO_STACK}`;
  ctx.lineWidth = 1.5;
  /** Label box top-left, shifted inside the pane when past an edge. */
  const drawLabel = (x: number, y: number, label: string): void => {
    const tw = ctx.measureText(label).width;
    const bw = tw + 10, bh = fs + 8;
    const bx = Math.max(2, Math.min(x, v.bw - bw - 2)), by = Math.max(2, Math.min(y, v.bh - bh - 2));
    ctx.fillStyle = ON_ACCENT;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = ACCENT_HI;
    ctx.fillText(label, bx + 5, by + fs + 1);
  };
  const drawSet = (pts: [number, number][], label: string | null, dim: boolean): void => {
    if (pts.length === 0) return;
    const sp = pts.map(at);
    ctx.strokeStyle = dim ? ACCENT_DIM : ACCENT;
    ctx.fillStyle = dim ? ACCENT_DIM_FILL : ACCENT_HI;
    ctx.beginPath();
    ctx.moveTo(sp[0]![0], sp[0]![1]);
    for (const [x, y] of sp.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
    for (const [x, y] of sp) {
      ctx.beginPath();
      ctx.arc(x, y, dot, 0, Math.PI * 2);
      ctx.fill();
    }
    if (label) {
      const [lx, ly] = sp[sp.length - 1]!;
      drawLabel(lx + 6, ly - fs - 8, label);
    }
  };
  /** Ellipse ROI: two corner taps → stroked ellipse + area label. */
  const drawEllipse = (pts: [number, number][], label: string | null, dim: boolean): void => {
    if (pts.length < 2) { drawSet(pts, label, dim); return; }
    const [ax, ay] = at(pts[0]!), [bx, by] = at(pts[1]!);
    const cx = (ax + bx) / 2, cy = (ay + by) / 2;
    const rx = Math.abs(bx - ax) / 2, ry = Math.abs(by - ay) / 2;
    ctx.strokeStyle = dim ? ACCENT_DIM : ACCENT;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
    ctx.stroke();
    if (label) drawLabel(cx + rx + 6, cy - fs - 8, label);
  };
  /** Rectangle ROI: two corner taps → stroked rect + area label. */
  const drawRect = (pts: [number, number][], label: string | null, dim: boolean): void => {
    if (pts.length < 2) { drawSet(pts, label, dim); return; }
    const [ax, ay] = at(pts[0]!), [bx, by] = at(pts[1]!);
    const x = Math.min(ax, bx), y = Math.min(ay, by);
    const w = Math.abs(bx - ax), h = Math.abs(by - ay);
    ctx.strokeStyle = dim ? ACCENT_DIM : ACCENT;
    ctx.beginPath();
    ctx.strokeRect(x, y, Math.max(1, w), Math.max(1, h));
    if (label) drawLabel(x + w + 6, y - 8, label);
  };
  /** Cobb angle: four taps = two lines + angle label at the second line. */
  const drawCobb = (pts: [number, number][], label: string | null, dim: boolean): void => {
    if (pts.length < 4) { drawSet(pts, label, dim); return; }
    const sp = pts.map(at);
    ctx.strokeStyle = dim ? ACCENT_DIM : ACCENT;
    ctx.fillStyle = dim ? ACCENT_DIM_FILL : ACCENT_HI;
    ctx.beginPath();
    ctx.moveTo(sp[0]![0], sp[0]![1]);
    ctx.lineTo(sp[1]![0], sp[1]![1]);
    ctx.moveTo(sp[2]![0], sp[2]![1]);
    ctx.lineTo(sp[3]![0], sp[3]![1]);
    ctx.stroke();
    for (const [x, y] of sp) {
      ctx.beginPath();
      ctx.arc(x, y, dot, 0, Math.PI * 2);
      ctx.fill();
    }
    if (label) {
      const [lx, ly] = sp[3]!;
      drawLabel(lx + 6, ly - fs - 8, label);
    }
  };
  for (const m of rows) {
    const label = m.kind === 'probe' ? `${Math.round(m.value)}` : fmtVal(m.kind as MeasureKind, m.value);
    if (m.kind === 'ellipse') drawEllipse(m.points, label, false);
    else if (m.kind === 'roi') drawRect(m.points, label, false);
    else if (m.kind === 'cobb') drawCobb(m.points, label, false);
    else drawSet(m.points, label, false);
  }
  if (pend.length > 0) {
    const pk = getUi().measureKind;
    if (pk === 'ellipse' && pend.length === 2) drawEllipse(pend, null, true);
    else if (pk === 'roi' && pend.length === 2) drawRect(pend, null, true);
    else drawSet(pend, null, true);
  }
}
