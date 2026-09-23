// The straightened view along the Curve tool's curve (F16), under the 3D
// image: render-cpu/cpr.ts resamples the volume across the curve at the
// finest voxel size, millimetre-true both ways, from the pane the curve
// was drawn on (turned about the curve by Rotate). Ticks mark the clicks;
// a tap on the view moves every pane to the voxel under it.
import { useEffect, useRef, type JSX } from 'react';
import { cprVoxel, straightenedCpr, type Cpr } from '@carys/render-cpu';
import { CURVE_COLOR } from '../lib/palette';
import { paintBus } from '../lib/paintBus';
import { session } from '../lib/session';
import { setStatus } from '../lib/status';
import { getUi, setUi, useUi } from '../lib/store';
import { bump, useVersion } from '../lib/version';
import { Chip, IconBtn, SliderRow } from '../ui/primitives';
import { curveLength } from './paneCurve';

type V3 = [number, number, number];

/** The normal of each pane: the curve's vector of interest. */
const NORMAL: Record<'axial' | 'coronal' | 'sagittal', V3> = { axial: [0, 0, 1], coronal: [0, 1, 0], sagittal: [1, 0, 0] };
/** Pixels in a view at most; a longer curve steps coarser to fit. */
const MAX_PIXELS = 2_000_000;
/** Tick marking a click on the view, pixels. */
const TICK = 3;

export function CprPanel(): JSX.Element | null {
  const ver = useVersion();
  const ui = useUi();
  const cvRef = useRef<HTMLCanvasElement>(null);
  const cprRef = useRef<Cpr | null>(null);
  const curve = session.curve;
  const n = curve?.pts.length ?? 0;
  const show = ui.tool === 'curve' || n > 0;

  useEffect(() => {
    const cv = cvRef.current, img = session.img, c = session.curve, wl = session.wl;
    cprRef.current = null;
    if (!cv) return;
    if (!img || !c || c.pts.length < 2 || !wl) {
      cv.width = 1; cv.height = 1;
      return;
    }
    const sp = img.spacing ?? [1, 1, 1];
    const len = curveLength() ?? 0;
    let step = Math.min(sp[0], sp[1], sp[2]);
    step = Math.max(step, Math.sqrt((len * 2 * ui.cprWidth) / MAX_PIXELS));
    try {
      const r = straightenedCpr(
        { dims: img.dims, spacing: sp, origin: [0, 0, 0], dtype: 'float64', data: img.data },
        c.pts, wl, { step, halfWidth: ui.cprWidth, up: NORMAL[c.plane], angle: (ui.cprAngle * Math.PI) / 180 },
      );
      cprRef.current = r;
      cv.width = r.width; cv.height = r.height;
      const ctx = cv.getContext('2d')!;
      ctx.putImageData(new ImageData(r.rgba as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), 0, 0);
      ctx.fillStyle = CURVE_COLOR;
      for (const k of r.knots) { ctx.fillRect(k, 0, 1, TICK); ctx.fillRect(k, r.height - TICK, 1, TICK); }
      const ro = document.getElementById('ro-cpr');
      if (ro) ro.textContent = `${r.length.toFixed(1)} mm · ${c.pts.length} points · ${r.step.toFixed(2)} mm px`;
    } catch (e) {
      setStatus(`curved reformat failed: ${(e as Error).message}`, 'error');
    }
  }, [ver, ui.cprWidth, ui.cprAngle, ui.series, show]);

  if (!show) return null;

  /** A tap on the view: every pane to the voxel under it. */
  const onTap = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const r = cprRef.current, cv = cvRef.current, img = session.img;
    if (!r || !cv || !img) return;
    // the canvas is object-fit: contain in its box
    const b = cv.getBoundingClientRect();
    const k = Math.min(b.width / r.width, b.height / r.height);
    const col = (e.clientX - b.left - (b.width - r.width * k) / 2) / k - 0.5;
    const row = (e.clientY - b.top - (b.height - r.height * k) / 2) / k - 0.5;
    if (col < -0.5 || row < -0.5 || col > r.width - 0.5 || row > r.height - 0.5) return;
    const [nx, ny, nz] = img.dims;
    const q = cprVoxel(r, col, row);
    const v: V3 = [
      Math.min(nx - 1, Math.max(0, Math.round(q[0]))), Math.min(ny - 1, Math.max(0, Math.round(q[1]))), Math.min(nz - 1, Math.max(0, Math.round(q[2]))),
    ];
    paintBus.jumpTo(v);
    const i = (v[2] * ny + v[1]) * nx + v[0], value = img.data[i]!;
    const label = session.editMask ? ` · label ${session.editMask[i]}` : '';
    setStatus(`CPR → voxel (${v.join(', ')}) · value ${Number.isInteger(value) ? value : value.toFixed(1)}${label}`);
  };

  const undoPoint = (): void => {
    if (!session.curve) return;
    session.curve.pts.pop();
    if (session.curve.pts.length === 0) session.curve = null;
    bump();
  };

  return (
    <div className="pane cprpane" id="pane-cpr">
      <div className="pane-head">
        <span className="name">Curved reformat</span>
        <Chip><span id="ro-cpr">{n < 2 ? 'click 2 points or more along a vessel or spine' : '…'}</span></Chip>
      </div>
      <div className="cprwrap">
        <canvas
          id="c-cpr" ref={cvRef} width={1} height={1} role="img"
          aria-label="Straightened view along the curve. Tap to move the panes there."
          onPointerDown={onTap}
        />
        <div className="cprctl">
          <SliderRow label="Width mm" min={5} max={80} step={1} value={ui.cprWidth} onInput={(v) => setUi({ cprWidth: v })} />
          <SliderRow label="Rotate °" min={-90} max={90} step={5} value={ui.cprAngle} onInput={(v) => setUi({ cprAngle: v })} />
          <IconBtn title="Remove the last point" onClick={undoPoint}>Undo point</IconBtn>
          <IconBtn title="Clear the curve" onClick={() => { session.curve = null; bump(); }}>Clear curve</IconBtn>
          {getUi().tool !== 'curve' && (
            <IconBtn title="Add points with the Curve tool" onClick={() => setUi({ tool: 'curve' })}>Add points</IconBtn>
          )}
        </div>
      </div>
    </div>
  );
}
