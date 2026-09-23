// Segmentation outlines on a 2D pane (F14): each label's runs
// (render-cpu/labels.ts) drawn in screen px through the pane mapping, set
// half a line inside their label, so two touching labels both show and the
// weight is the same at every zoom.
import { RUN } from '@carys/render-cpu';
import { LABEL_OUTLINE_PX, labelCss } from '../lib/palette';
import { toScreen, type PaneView } from './paneView';

export function drawLabelOutlines(ctx: CanvasRenderingContext2D, outlines: Map<number, Float32Array>, v: PaneView): void {
  const h = LABEL_OUTLINE_PX / 2;
  ctx.save();
  ctx.lineWidth = LABEL_OUTLINE_PX;
  for (const [label, runs] of outlines) {
    ctx.strokeStyle = labelCss(label);
    ctx.beginPath();
    for (let r = 0; r < runs.length; r += RUN) {
      const [x0, y0] = toScreen(v, runs[r]!, runs[r + 1]!);
      const [x1, y1] = toScreen(v, runs[r + 2]!, runs[r + 3]!);
      // into the label, on screen: v runs up the screen when flipped
      const ox = runs[r + 4]! * h, oy = (v.flipV ? -runs[r + 5]! : runs[r + 5]!) * h;
      ctx.moveTo(x0 + ox, y0 + oy);
      ctx.lineTo(x1 + ox, y1 + oy);
    }
    ctx.stroke();
  }
  ctx.restore();
}
