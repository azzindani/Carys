import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { validateTF, type TF } from '@carys/render-cpu';
import { ACCENT, TF_GRID } from '../lib/palette';

// Piecewise transfer-function editor. Canvas curve (opacity) + draggable
// stops; dbl-click adds, right-click removes (min 2). Colors via inputs.
// Commits on release so the raycaster isn't spammed mid-drag.
export function TfEditor({ tf, range, onCommit }: {
  tf: TF;
  range: [number, number];
  onCommit: (tf: TF) => void;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [draft, setDraft] = useState<TF | null>(null);
  const shown = draft ?? tf;
  const [lo, hi] = range;
  const span = hi - lo || 1;

  const geom = (): { cv: HTMLCanvasElement; r: DOMRect } | null => {
    const cv = canvasRef.current;
    if (!cv) return null;
    return { cv, r: cv.getBoundingClientRect() };
  };
  const toPx = (v: number, a: number, w: number, h: number): [number, number] => [
    ((v - lo) / span) * w,
    h - 8 - a * (h - 16),
  ];
  const fromPx = (x: number, y: number, w: number, h: number): { v: number; a: number } => ({
    v: lo + Math.min(1, Math.max(0, x / w)) * span,
    a: Math.min(1, Math.max(0, (h - 8 - y) / (h - 16))),
  });

  const draw = (): void => {
    const g = geom();
    if (!g) return;
    const { cv, r } = g;
    const w = Math.max(50, Math.floor(r.width));
    const h = 110;
    if (cv.width !== w * 2) { cv.width = w * 2; cv.height = h * 2; }
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = TF_GRID;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    const pts = shown.map((s) => toPx(s.value, s.opacity, w, h));
    ctx.beginPath();
    pts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    pts.forEach(([x, y], i) => {
      const s = shown[i]!;
      ctx.beginPath();
      ctx.arc(x, y, i === drag ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${s.color[0]},${s.color[1]},${s.color[2]})`;
      ctx.fill();
      ctx.strokeStyle = i === drag ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.stroke();
    });
  };
  requestAnimationFrame(draw);

  const stopAt = (x: number, y: number): number => {
    const g = geom();
    if (!g) return -1;
    const w = g.r.width;
    let best = -1, bd = 12;
    shown.forEach((s, i) => {
      const [sx, sy] = toPx(s.value, s.opacity, w, 110);
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  const pos = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  return (
    <div className="tfed">
      <canvas
        ref={canvasRef} className="tfed-curve" style={{ width: '100%', height: 110 }}
        onPointerDown={(e) => {
          const [x, y] = pos(e);
          const i = stopAt(x, y);
          if (i >= 0) {
            setDrag(i);
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (drag == null) return;
          const g = geom();
          if (!g) return;
          const [x, y] = pos(e);
          const { v, a } = fromPx(x, y, g.r.width, 110);
          const moved = { ...shown[drag]!, value: v, opacity: Math.round(a * 100) / 100 };
          const next = [...shown.slice(0, drag), moved, ...shown.slice(drag + 1)];
          next.sort((p, q) => p.value - q.value);
          setDraft(next);
          setDrag(next.indexOf(moved));
        }}
        onPointerUp={() => {
          if (draft) onCommit(draft);
          setDraft(null);
          setDrag(null);
        }}
        onDoubleClick={(e) => {
          const g = geom();
          if (!g) return;
          const [x, y] = pos(e);
          const { v, a } = fromPx(x, y, g.r.width, 110);
          onCommit([...tf, { value: Math.round(v), color: [255, 255, 255], opacity: Math.round(a * 100) / 100 }]);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (tf.length <= 2) return;
          const [x, y] = pos(e);
          const i = stopAt(x, y);
          if (i >= 0) onCommit(tf.filter((_, k) => k !== i));
        }}
      />
      <div className="tfed-stops">
        {shown.map((s, i) => (
          <label key={i} className="tfed-stop" title={`stop ${i}: ${Math.round(s.value)} · α ${s.opacity}`}>
            <input
              type="color" aria-label={`stop ${i} color`}
              value={'#' + s.color.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}
              onChange={(e) => {
                const hex = (e.target as HTMLInputElement).value;
                const color: [number, number, number] = [
                  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
                ];
                onCommit(tf.map((q, k) => (k === i ? { ...q, color } : q)));
              }}
            />
          </label>
        ))}
        <span className="hint">drag · dbl-click adds · right-click removes</span>
      </div>
      {validateTF(shown).length > 0 && <div className="hint">{validateTF(shown).join('; ')}</div>}
    </div>
  );
}
