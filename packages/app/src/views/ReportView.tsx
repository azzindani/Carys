import type { JSX } from 'react';
import { maskStats } from '@carys/measure';
import {
  buildReproSidecar, checkOrientation, compressionWarning, reproSidecarToJSON,
  studyReportHtml, teachingSheetHtml, validateVolume,
} from '@carys/study';
import { session } from '../lib/session';
import { getUi } from '../lib/store';
import { toast } from '../lib/toasts';
import { bump, useVersion } from '../lib/version';

function downloadFile(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Validation + printable report for the open series (Week-4 slice). */
export function ReportView(): JSX.Element {
  useVersion();
  const ui = getUi();
  const img = session.img;
  if (!img) return <div className="hint">Open a series first, then report on it.</div>;
  const sp = img.spacing ?? [1, 1, 1];
  const validation = validateVolume(img.dims, sp, img.data.length, img.data.slice(0, 4096));
  // extra QC screens ride the same issues list (orientation sanity + the
  // transfer-syntax compression caution); dose prints from header tags.
  const orient = checkOrientation(img.dims, sp);
  if (!orient.ok) validation.issues.push({ level: 'error', code: 'orientation', message: orient.reason });
  // transfer syntax isn't in the tag summary: compression caution only when
  // the pixels came from DICOM (loud about unknown, never guessing fine)
  const compression = session.dcmMeta ? compressionWarning('') : null;
  const stats = session.editMask
    ? maskStats(session.editMask, {
        dims: img.dims, spacing: sp, origin: [0, 0, 0], dtype: 'uint8', data: img.data,
      })
    : { voxels: 0, volumeMm3: 0, volumeCm3: 0 };
  const generatedAt = new Date().toISOString();
  const measurements = session.measurements.map((m) => ({
    label: m.label, kind: m.kind, value: m.value, unit: m.unit, plane: m.plane, slice: m.slice,
  }));
  const maskCm3 = Math.round(stats.volumeCm3 * 1000) / 1000;
  const html = studyReportHtml({
    series: ui.series || 'series',
    note: session.seriesNote,
    dims: img.dims,
    spacing: sp,
    maskVoxels: stats.voxels,
    maskCm3,
    measurements,
    issues: validation.issues,
    generatedAt,
    digestPins: { ...session.digestPins },
  });
  // Reproducibility sidecar: same inputs regenerate this figure. WL falls
  // back to the auto window (a custom drag always replaces it first).
  const wl = session.wl ?? session.autoWl;
  const downloadSidecar = (): void => {
    if (!wl) {
      toast('No window/level yet — open a series first');
      return;
    }
    const sidecar = buildReproSidecar({
      series: ui.series || 'series',
      studyUID: session.dcmMeta?.studyUID ?? null,
      seriesUID: session.dcmMeta?.seriesUID ?? null,
      dims: img.dims,
      spacing: sp,
      slices: { ...session.slices },
      wl: { ...wl },
      preset: ui.preset,
      lut: ui.lut,
      invert: ui.invert,
      proj: ui.proj,
      slab: ui.slab,
      oblA: ui.oblA,
      oblB: ui.oblB,
      oblPlane: ui.oblPlane,
      src: ui.src,
      threshold: ui.threshold,
      method: ui.method,
      maskVer: session.maskVer,
      meshKey: session.meshKey(ui.series || 'series', ui.src, ui.threshold, ui.method, ui.smooth3d),
      // No digest contributes pixels to this figure today (A1 lands the
      // first pins); the field rides the call so the contract can't drift.
      digestPins: { ...session.digestPins },
      maskVoxels: stats.voxels,
      maskCm3,
      measurements,
      validation: { ok: validation.ok, issues: validation.issues },
      generatedAt,
    });
    downloadFile(`repro-${ui.series || 'series'}.json`, reproSidecarToJSON(sidecar), 'application/json');
    toast(`Sidecar saved: ${sidecar.series} · mask v${sidecar.maskVer} · ${sidecar.measurements.length} measurement(s)`, 'ok');
  };
  return (
    <>
      <div className="view-title" id="title-report">
        <h1>Report</h1>
        <p>{ui.series || '—'} · {validation.ok ? 'valid' : `${validation.issues.length} issue(s)`} · {session.measurements.length} measurement(s)</p>
        <span className="right">
          <button className="iconbtn accent" id="report-download" title="Download standalone HTML report"
            onClick={() => downloadFile(`report-${ui.series || 'series'}.html`, html, 'text/html')}>Download HTML</button>
          <button className="iconbtn" id="report-sidecar" title="Download reproducibility JSON sidecar"
            onClick={downloadSidecar}>Download JSON</button>
          <button className="iconbtn" id="report-sheet" title="Download print-ready teaching sheet (labels + quiz, no answers)"
            onClick={() => {
              const pins = Object.entries(session.digestPins);
              downloadFile(`sheet-${ui.series || 'series'}.html`, teachingSheetHtml({
                title: `${ui.series || 'series'} — teaching sheet`,
                labels: pins.map(([k, v]) => `${k} · ${v}`),
                notes: validation.issues.map((i) => `${i.level} ${i.code}: ${i.message}`),
                quiz: session.measurements.slice(0, 5).map((m) => ({
                  prompt: `${m.label} reads ${m.value} ${m.unit} — within tolerance?`,
                  options: ['Agree (within band)', 'Outside band', 'Cannot tell from this view'],
                })),
                provenance: ['Carys teaching sheet (education only — not for diagnosis)'],
              }), 'text/html');
              toast('Teaching sheet saved (no answers on the sheet)', 'ok');
            }}>Sheet</button>
        </span>
      </div>
      <section className="report" aria-label="Validation issues">
        {validation.issues.length === 0 ? (
          <div className="hint">No validation issues.</div>
        ) : (
          <dl className="kv" id="report-issues">
            {validation.issues.map((iss, i) => (
              <div className="mrow" key={i}>
                <dt>{iss.level} · {iss.code}</dt><dd>{iss.message}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="hint">Mask ≈ {stats.volumeCm3.toFixed(1)} cm³ ({stats.voxels.toLocaleString()} voxels).</div>
        {compression && (
          <div className="hint" id="report-compression">Compression: {compression}</div>
        )}
        {Object.keys(session.digestPins).length > 0 && (
          <dl className="kv" id="report-digests">
            {Object.entries(session.digestPins).map(([k, v]) => (
              <div className="mrow" key={k}>
                <dt>{k}</dt><dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <button className="kbd-btn" onClick={() => bump()}>Refresh</button>
      </section>
    </>
  );
}
