// Presentation save/load wiring: snapshot the read from session + store +
// pane transforms, and restore an uploaded file back onto the same series.
// Chrome only — engine ownership stays in study/present.ts (pure) and
// MprPanes (transform refs via paintBus). No new ids beyond dock-present:
// markers.mjs only pins ids consumed by e2e.
import {
  audit, buildPresentState, GSPS_SOP_CLASS, parsePresentState, presentStateToJSON,
} from '@carys/study';
import { paintBus } from './paintBus';
import { session } from './session';
import { getUi, setUi } from './store';
import { setStatus } from './status';
import { toast } from './toasts';
import { bump } from './version';

function downloadFile(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Save the read as a GSPS-flavored JSON presentation (WL + slices +
 *  per-pane zoom/pan + annotations). Announce through the visible status,
 *  like every other import/export. */
export function savePresentState(): void {
  const ui = getUi();
  const img = session.img;
  if (!img || !session.wl) {
    setStatus('open a series first — nothing to save as a presentation');
    return;
  }
  const mv = paintBus.getMprView();
  if (!mv) {
    setStatus('viewer panes not mounted — open the viewer before saving');
    return;
  }
  const kindOk = (k: string): boolean =>
    k === 'length' || k === 'angle' || k === 'probe' || k === 'roi' || k === 'ellipse' || k === 'cobb';
  const annotations = session.measurements
    .filter((m) => m.series === ui.series && kindOk(m.kind))
    .map((m) => ({
      id: m.id, kind: m.kind as 'length' | 'angle' | 'probe' | 'roi' | 'ellipse' | 'cobb',
      label: m.label, plane: m.plane, slice: m.slice, points: m.points,
      value: m.value, unit: m.unit, series: m.series, createdAt: m.createdAt,
    }));
  try {
    const st = buildPresentState({
      series: ui.series || 'series',
      studyUID: session.dcmMeta?.studyUID ?? null,
      seriesUID: session.dcmMeta?.seriesUID ?? null,
      dims: img.dims,
      spacing: img.spacing ?? [1, 1, 1],
      slices: mv.slices,
      wl: { ...session.wl },
      preset: ui.preset,
      lut: ui.lut,
      invert: ui.invert,
      proj: ui.proj,
      slab: ui.slab,
      oblA: ui.oblA,
      oblB: ui.oblB,
      oblPlane: ui.oblPlane,
      view: mv.view,
      annotations,
    });
    downloadFile(`present-${ui.series || 'series'}.json`, presentStateToJSON(st), 'application/json');
    audit('report.export', ui.series, `GSPS presentation ${annotations.length} annotation(s)`);
    toast(`Presentation saved: ${st.series} · ${mv.slices.axial}/${mv.slices.coronal}/${mv.slices.sagittal} · ${annotations.length} annotation(s)`);
    setStatus(`presentation saved: ${st.series} (GSPS ${GSPS_SOP_CLASS}, JSON shape)`);
  } catch (err) {
    setStatus(`presentation save failed: ${(err as Error).message}`);
  }
}

/** Load a presentation file back onto the open series. Loud rejects (never
 *  silent): wrong series or different dims abort with the reason visible. */
export async function loadPresentStateFile(f: File): Promise<void> {
  const ui = getUi();
  if (!session.img) {
    setStatus('open a series first — presentations restore onto a series');
    return;
  }
  let text: string;
  try {
    text = await f.text();
  } catch {
    setStatus(`presentation unreadable: ${f.name}`);
    return;
  }
  let st: ReturnType<typeof parsePresentState>;
  try {
    st = parsePresentState(text);
  } catch (err) {
    setStatus(`presentation rejected: ${(err as Error).message}`);
    return;
  }
  if (st.series !== ui.series) {
    setStatus(`presentation is for "${st.series}", open series is "${ui.series}" — open the matching series first`);
    return;
  }
  const img = session.img;
  if (st.dims.join('×') !== img.dims.join('×')) {
    setStatus(`presentation dims ${st.dims.join('×')} != open ${img.dims.join('×')} — refusing to apply`);
    return;
  }
  session.wl = { ...st.wl };
  if (st.proj !== 'slice' && st.proj !== 'mip' && st.proj !== 'minip' && st.proj !== 'mean') {
    setStatus(`presentation rejected: unknown projection "${st.proj}"`);
    return;
  }
  setUi({
    preset: st.preset, lut: st.lut, invert: st.invert, proj: st.proj, slab: st.slab,
    oblA: st.oblA, oblB: st.oblB, oblPlane: st.oblPlane,
  });
  session.crosshair = null;
  session.pendingMeasure = [];
  session.pendingVoxel = [];
  session.pendingPlane = null;
  session.pendingFrame = null;
  session.measurements = session.measurements
    .filter((m) => m.series !== ui.series)
    .concat(st.annotations.map((m) => ({ ...m })));
  paintBus.setMprView(st.slices, st.view);
  bump();
  audit('report.export', ui.series, `GSPS presentation loaded (${st.annotations.length} annotation(s))`);
  toast(`Presentation loaded: ${st.series} · ${st.annotations.length} annotation(s)`);
  setStatus(`presentation loaded: ${st.series} · WL ${Math.round(st.wl.width)}/${Math.round(st.wl.center)}`);
}
