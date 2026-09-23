import { audit, EDUCATION_BADGE } from '@carys/study';
import { segmentsTable, segmentsTableToCSV } from '@carys/editor-seg';
import {
  importRadiomicsCsv, importTid1500, lesionDeltaTable, lesionDeltaTableToCSV, maskStatsToCSV, measurementsToCSV,
  measurementsToJSON, measurementsToSR, measurementsToTid1500,
} from '@carys/measure';
import {
  clipWsiRect, physicalUnitsName, regionDataTypeName, sopClassName,
  validateWsiAnnotations, wsiAnnotationLabel,
} from '@carys/io';
import { WSI_DEMO_ANNOTATIONS, WSI_DEMO_SET } from '@carys/volume-core';
import { fmtDims, session } from '../lib/session';
import { setStatus } from '../lib/status';
import type { JSX } from 'react';
import { useUi } from '../lib/store';
import { bump, useVersion } from '../lib/version';
import { doClear, doUndo, setSpacing } from '../lib/sessionOps';
import { labelCss } from '../lib/palette';

function download(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function useMaskStats(): { est: number; vox: number; frac: number } | null {
  useVersion();
  const { editMask, img } = session;
  if (!editMask || !img) return null;
  let n = 0;
  for (let i = 0; i < editMask.length; i += 7) if (editMask[i]) n++;
  const vox = n * 7;
  const sp = img.spacing ?? [1, 1, 1];
  const est = Math.round(vox * sp[0] * sp[1] * sp[2] / 1000);
  return { est, vox, frac: Math.min(100, (vox / editMask.length) * 100) };
}

/** DICOM tag browser rows: every present field, absent tags omitted. */
function DcmRows(): JSX.Element {
  const m = session.dcmMeta!;
  const rows: [string, string][] = [];
  if (m.sopClassUID) rows.push(['SOP', `${sopClassName(m.sopClassUID)}`]);
  if (m.modality) rows.push(['modality', m.modality]);
  if (m.seriesDescription) rows.push(['series', m.seriesDescription]);
  if (m.seriesNumber != null) rows.push(['series #', String(m.seriesNumber)]);
  if (m.patientName) rows.push(['patient', m.patientName]);
  if (m.patientID) rows.push(['patient ID', m.patientID]);
  if (m.studyDate) rows.push(['study date', m.studyDate + (m.studyTime ? ` ${m.studyTime}` : '')]);
  if (m.manufacturer) rows.push(['scanner', m.manufacturer + (m.model ? ` ${m.model}` : '')]);
  if (m.institution) rows.push(['site', m.institution]);
  if (m.rows != null && m.cols != null) {
    rows.push(['matrix', `${m.cols}×${m.rows}${m.bitsStored != null ? ` · ${m.bitsStored}-bit` : ''}`]);
  }
  if (m.windowCenter != null && m.windowWidth != null) {
    rows.push(['window', `${m.windowCenter}/${m.windowWidth}`]);
  }
  if (m.pixelSpacing) rows.push(['spacing', `${m.pixelSpacing[0]}×${m.pixelSpacing[1]}${m.sliceThickness != null ? `×${m.sliceThickness}` : ''} mm`]);
  if (m.frames != null && m.frames > 1) {
    rows.push(['cine', m.cineFps != null
      ? `${m.frames} frames @ ${m.cineFps} fps${m.frameTimeMs != null ? ` (${m.frameTimeMs} ms)` : ''}`
      : `${m.frames} frames (no rate in file)`]);
  }
  if (m.usRegions != null) {
    rows.push(['US regions', `${m.usRegions}${m.usTypes ? ` · ${m.usTypes}` : ''}`
      + `${m.usSpacingMm ? ` · ${m.usSpacingMm[0].toFixed(3)}×${m.usSpacingMm[1].toFixed(3)} mm/px` : ''}`]);
  }
  if (m.tomoSpacingMm || m.tomoZGapMm != null || m.imageLaterality || m.laterality || m.viewPosition) {
    const lat = m.imageLaterality ?? m.laterality;
    rows.push(['tomo', `${lat ?? '?'}${m.viewPosition ? ` ${m.viewPosition}` : ''}`
      + `${m.tomoSpacingMm ? ` · ${m.tomoSpacingMm[0].toFixed(3)}×${m.tomoSpacingMm[1].toFixed(3)} mm/px` : ''}`
      + `${m.tomoZGapMm != null ? ` · Δ ${m.tomoZGapMm} mm` : ''}`]);
  }
  if (m.rtPlanLabel != null || m.rtBeams != null || m.rtFractions != null || m.rtPrescriptionGy != null) {
    rows.push(['RT plan', `${m.rtPlanLabel ?? '?'}`
      + `${m.rtBeams != null ? ` · ${m.rtBeams} beam(s)` : ''}`
      + `${m.rtFractions != null ? ` · ${m.rtFractions} fx` : ''}`
      + `${m.rtPrescriptionGy != null ? ` · Rx ${m.rtPrescriptionGy} Gy` : ''}`]);
  }
  if (m.rtDoseMaxGy != null || m.rtDvh != null) {
    rows.push(['RT dose', `${m.rtDoseMaxGy != null ? `max ${m.rtDoseMaxGy.toFixed(2)} Gy` : '?'}`
      + `${m.rtDvh ? ` · DVH ${m.rtDvh}` : ''}`]);
  }
  if (m.vlTiles != null || m.vlFocusPlanes != null || m.vlOpticalPaths != null) {
    rows.push(['VL grid', `${m.vlTiles ?? '?'}`
      + `${m.vlFocusPlanes != null ? ` · ${m.vlFocusPlanes} focus` : ''}`
      + `${m.vlOpticalPaths != null ? ` · ${m.vlOpticalPaths} path(s)` : ''}`]);
  }
  if (m.encapsulatedDoc != null) {
    rows.push(['document', m.encapsulatedDoc]);
  }
  if (m.studyUID) rows.push(['study UID', m.studyUID]);
  if (m.seriesUID) rows.push(['series UID', m.seriesUID]);
  if (m.sopClassUID) rows.push(['SOP UID', m.sopClassUID]);
  return (
    <>
      {rows.map(([k, v]) => (
        <div className="mrow" key={k}>
          <dt>{k}</dt><dd>{v}</dd>
        </div>
      ))}
      <UsRegionsTable />
      <WsiAnnotationTable />
      <DigestRows />
    </>
  );
}

/** US region table: one row per calibration region (type + rect +
 *  units), the Doppler readout without a second decode. Hidden when the
 *  open file carries no regions. */
function UsRegionsTable(): JSX.Element | null {
  const regions = session.dcmRegions;
  if (regions.length === 0) return null;
  return (
    <>
      {regions.map((r, i) => (
        <div className="mrow" key={i}>
          <dt>{regionDataTypeName(r.dataType)}</dt>
          <dd>
            {r.x0 != null && r.y0 != null && r.x1 != null && r.y1 != null
              ? `[${r.x0},${r.y0}]–[${r.x1},${r.y1}]`
              : 'no rect'}
            {` · ${physicalUnitsName(r.unitsX)} × ${physicalUnitsName(r.unitsY)}`}
            {r.deltaX != null && r.deltaY != null ? ` · Δ ${r.deltaX}/${r.deltaY}` : ''}
          </dd>
        </div>
      ))}
    </>
  );
}

/** C2 teaching annotations: display-only region/stain rows for the
 *  open VL tile (clipped rects + skip counts, never detection/grading).
 *  Real uploads start empty (no invented overlays); the demo button loads
 *  the hand-authored set for the 64×48 demo tile. Hidden without a grid. */
function WsiAnnotationTable(): JSX.Element | null {
  useVersion();
  const grid = session.vlGrid;
  if (!grid) return null;
  const anns = session.wsiAnnotations;
  const cols = grid.totalCols ?? session.img?.dims[0] ?? 0;
  const rows = grid.totalRows ?? session.img?.dims[1] ?? 0;
  const skipped = anns.filter((a) => clipWsiRect(a.rect, cols, rows) === null).length;
  const loadDemo = (): void => {
    try {
      session.wsiAnnotations = validateWsiAnnotations(
        JSON.parse(JSON.stringify(WSI_DEMO_ANNOTATIONS)),
      );
      bump();
      setStatus(`demo annotations loaded: ${WSI_DEMO_SET} (${WSI_DEMO_ANNOTATIONS.length} regions)`);
    } catch (e) {
      setStatus(`demo annotations rejected: ${(e as Error).message}`, 'error');
    }
  };
  return (
    <>
      {anns.map((a) => {
        const clipped = clipWsiRect(a.rect, cols, rows);
        return (
          <div className="mrow" key={a.id}>
            <dt>{wsiAnnotationLabel(a)}</dt>
            <dd>
              {clipped ? `[${clipped[0]},${clipped[1]}]–[${clipped[2]},${clipped[3]}]` : 'off-tile (skipped)'}
              {` · ${a.note}`}
            </dd>
          </div>
        );
      })}
      <div className="mrow">
        <dt>teaching regions</dt>
        <dd>
          <button id="wsi-demo" title="Load the hand-authored demo annotation set (64×48 tile only)"
            onClick={loadDemo}>Demo</button>
          {anns.length > 0 ? ` ${anns.length} shown` : ' none'}
          {skipped > 0 ? ` · ${skipped} off-tile skipped` : ''}
          {` · ${EDUCATION_BADGE}`}
        </dd>
      </div>
    </>
  );
}

/** Digest provenance rows: the open file's SOURCES sidecar + quarantine
 *  badge, carried on #dcm-meta beside the tag rows. Hidden when no digest
 *  contributed (today: always hidden until A1 lands pins — the row exists
 *  so the quarantine UI ships before the first digest, not after). */
function DigestRows(): JSX.Element | null {
  const pins = session.digestPins;
  const ids = Object.keys(pins);
  if (ids.length === 0) return null;
  return (
    <>
      {ids.map((id) => (
        <div className="mrow" key={id}>
          <dt>digest {id}</dt><dd>pin {pins[id]} · {EDUCATION_BADGE}</dd>
        </div>
      ))}
    </>
  );
}

/** Multi-label segments table: value + label + voxels + mm³, with CSV
 *  export. Hidden for pure binary masks (single value 1 keeps the panel
 *  quiet); the Multi-Lbl seg op is what populates it. */
function SegmentsTable(): JSX.Element | null {
  useVersion();
  const { editMask, img } = session;
  const ui = useUi();
  if (!editMask || !img) return null;
  const rows = segmentsTable(editMask, img.spacing ?? [1, 1, 1]);
  if (rows.length <= 1 && (rows[0]?.value ?? 1) === 1) return null;
  return (
    <dl className="kv" id="seginfo">
      {rows.map((r) => (
        <div className="mrow" key={r.value}>
          <dt><span className="lblswatch" style={{ background: labelCss(r.value) }} aria-hidden="true" />L{r.value} · {r.label}</dt>
          <dd>{r.voxels.toLocaleString()} vox · {(Math.round(r.volumeMm3 / 100) / 10).toFixed(1)} cm³</dd>
        </div>
      ))}
      <div className="mrow">
        <dt>segments CSV</dt>
        <dd><button id="seg-csv" title="Export segments table CSV"
          onClick={() => download(`segments-${ui.series}.csv`, segmentsTableToCSV(rows), 'text/csv')}>CSV</button></dd>
      </div>
    </dl>
  );
}

/** Lesion delta table: baseline ↔ follow-up pairing over the tracked
 *  lengths. Baseline = current series rows, follow-up = compare-series
 *  rows when a compare overlay is on (else self = empty deltas). */
function LesionDeltas(): JSX.Element | null {
  useVersion();
  const ui = useUi();
  const base = session.measurements.filter((m) => m.series === ui.series);
  const cmp = ui.compareSeries
    ? session.measurements.filter((m) => m.series === ui.compareSeries)
    : [];
  if (base.length === 0) return null;
  const rows = lesionDeltaTable(base, cmp.length > 0 ? cmp : base);
  return (
    <dl className="kv" id="deltainfo">
      {rows.map((r) => (
        <div className="mrow" key={r.label}>
          <dt>{r.label}</dt>
          <dd>
            {r.baseline !== null ? r.baseline.toFixed(1) : '—'}
            {r.followup !== null && r.followup !== r.baseline ? ` → ${r.followup.toFixed(1)}` : ''}
            {r.deltaMm !== null && r.deltaMm !== 0
              ? ` ${r.deltaMm > 0 ? '+' : ''}${r.deltaMm.toFixed(1)} ${r.unit}${r.pctChange !== null && Number.isFinite(r.pctChange) ? ` (${r.pctChange > 0 ? '+' : ''}${r.pctChange.toFixed(0)}%)` : ''}`
              : ''}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Inspector(): JSX.Element {  const ui = useUi();
  useVersion();
  const mask = useMaskStats();
  const img = session.img;
  const sp = img?.spacing ?? [1, 1, 1];

  return (
    <aside className="inspector">
      <section>
        <h2>Series</h2>
        <div className="bigstat" id="series-big">{ui.series || '—'}</div>
        <div className="hint" id="series-note">{session.seriesNote}</div>
      </section>
      <section>
        <h2>Volume</h2>
        <dl className="kv" id="volinfo">
          {img ? (
            <>
              <dt>dims</dt><dd>{fmtDims(img.dims)}</dd>
              <dt>spacing</dt><dd>{sp.map((v) => Number(v).toFixed(2)).join(' · ')}</dd>
              <dt>calibrate</dt><dd>
                {(['x', 'y', 'z'] as const).map((ax, i) => (
                  <input
                    key={`${ui.series}-${ax}`} id={`cal-s${ax}`} type="number" className="cal"
                    title={`Pixel spacing ${ax} (mm)`}
                    aria-label={`Pixel spacing ${ax} in mm`} min={0} step="any"
                    defaultValue={Number(sp[i]).toFixed(3)}
                    onChange={(e) => setSpacing(i as 0 | 1 | 2, e.target.value)}
                  />
                ))}
              </dd>
              <dt>voxels</dt><dd>{(img.dims[0] * img.dims[1] * img.dims[2]).toLocaleString()}</dd>
            </>
          ) : (<><dt>volume</dt><dd>—</dd></>)}
        </dl>
      </section>
      {session.dcmMeta && (
        <section>
          <h2>DICOM</h2>
          <dl className="kv" id="dcm-meta">
            <DcmRows />
          </dl>
        </section>
      )}
      <section>
        <h2>Mask
          <span className="act">
            <button id="mask-csv" title="Export mask stats CSV"
              onClick={() => {
                if (session.editMask && img) {
                  const vol = {
                    dims: img.dims, spacing: img.spacing ?? [1, 1, 1] as [number, number, number],
                    origin: [0, 0, 0] as [number, number, number], dtype: 'uint8' as const, data: img.data,
                  };
                  download(`mask-${ui.series}.csv`, maskStatsToCSV(ui.series || 'series', session.editMask, vol), 'text/csv');
                }
              }}>CSV</button>
            <button id="mask-undo" title="Undo" onClick={doUndo}>↩</button>
            <button id="mask-clear" title="Clear" onClick={doClear}>✕</button>
          </span>
        </h2>
        <div className="bigstat" id="mask-big">
          {mask ? <>≈ {mask.est.toLocaleString()} <small>cm³</small></> : '—'}
        </div>
        <dl className="kv" id="maskinfo">
          {mask ? (
            <>
              <dt>volume</dt><dd>≈ {mask.est.toLocaleString()} cm³</dd>
              <dt>voxels</dt><dd>{mask.vox.toLocaleString()}</dd>
            </>
          ) : (<><dt>volume</dt><dd>—</dd></>)}
        </dl>
        <div className="meter"><i id="maskbar" style={{ width: `${mask?.frac.toFixed(1) ?? 0}%` }} /></div>
        <SegmentsTable />
      </section>
      <section>
        <h2>Measure
          <span className="act">
            <button id="meas-csv" title="Export CSV"
              onClick={() => download(`measure-${ui.series}.csv`, measurementsToCSV(session.measurements), 'text/csv')}>CSV</button>
            <button id="meas-json" title="Export JSON"
              onClick={() => download(`measure-${ui.series}.json`, measurementsToJSON(session.measurements), 'application/json')}>JSON</button>
            <button id="meas-sr" title="Export SR JSON"
              onClick={() => download(`measure-${ui.series}-sr.json`, JSON.stringify(measurementsToSR(session.measurements), null, 2), 'application/json')}>SR</button>
            <button id="meas-tid1500" title="Export TID1500 measurement report JSON"
              onClick={() => {
                download(`measure-${ui.series}-tid1500.json`, JSON.stringify(measurementsToTid1500(session.measurements, session.dcmMeta?.seriesUID ?? 'unspecified'), null, 2), 'application/json');
                audit('report.export', ui.series, `TID1500 ${session.measurements.length} measurement(s)`);
              }}>TID1500</button>
            <label className="iconbtn" id="meas-radiomics-import" htmlFor="radiomics-upload" title="Import a pyradiomics CSV (offline features; rows tagged radiomics import)">Radiomics</label>
            <input
              type="file" id="radiomics-upload" accept=".csv,text/csv" hidden
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                (e.target as HTMLInputElement).value = '';
                if (!f) return;
                void (async () => {
                  try {
                    const rows = importRadiomicsCsv(await f.text(), ui.series || 'series');
                    session.measurements = [...session.measurements, ...rows];
                    audit('seg.import', ui.series || 'series', `Radiomics import ${rows.length} row(s)`);
                    setStatus(`Radiomics import: ${rows.length} row(s), tagged radiomics import`);
                    bump();
                  } catch (err) {
                    setStatus(`Radiomics import failed: ${(err as Error).message}`, 'error');
                  }
                })();
              }}
            />
            <label className="iconbtn" id="meas-tid1500-import" htmlFor="tid1500-upload" title="Import a TID1500 report JSON (own-shape; rows tagged SR import)">TID in</label>
            <input
              type="file" id="tid1500-upload" accept=".json,application/json" hidden
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                (e.target as HTMLInputElement).value = '';
                if (!f) return;
                void (async () => {
                  try {
                    const tree = JSON.parse(await f.text());
                    const rows = importTid1500(tree, ui.series || 'series');
                    session.measurements = [...session.measurements, ...rows];
                    audit('seg.import', ui.series || 'series', `TID1500 import ${rows.length} row(s)`);
                    setStatus(`TID1500 import: ${rows.length} row(s), tagged SR import`);
                    bump();
                  } catch (err) {
                    setStatus(`TID1500 import failed: ${(err as Error).message}`, 'error');
                  }
                })();
              }}
            />
          </span>
        </h2>
        {session.measurements.length === 0 ? (
          <div className="hint">Measure tool → click on any plane. Esc cancels.</div>
        ) : (
          <dl className="kv" id="measureinfo">
            {session.measurements.map((m) => (
              <div className="mrow" key={m.id}>
                <dt>{m.label}</dt>
                <dd>
                  {m.kind === 'angle' || m.kind === 'cobb' ? `${m.value.toFixed(0)}°` : m.kind === 'probe' ? `${Math.round(m.value)} ${m.unit}` : `${m.value.toFixed(1)} ${m.unit}`}
                  <button className="mx" title="Delete" onClick={() => {
                    session.measurements = session.measurements.filter((x) => x.id !== m.id);
                    audit('measure.delete', ui.series, m.label);
                    bump();
                  }}>✕</button>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section>
        <h2>Lesion deltas
          <span className="act">
            <button id="delta-csv" title="Export lesion delta table CSV"
              onClick={() => {
                const base = session.measurements.filter((m) => m.series === ui.series);
                const cmp = ui.compareSeries
                  ? session.measurements.filter((m) => m.series === ui.compareSeries)
                  : base;
                download(`deltas-${ui.series}.csv`, lesionDeltaTableToCSV(lesionDeltaTable(base, cmp)), 'text/csv');
              }}>CSV</button>
          </span>
        </h2>
        <LesionDeltas />
      </section>
      <section>
        <h2>Shortcuts</h2>
        <div className="hint">
          <kbd>2</kbd> 3D full · <kbd>↑</kbd><kbd>↓</kbd> slice · <kbd>[</kbd><kbd>]</kbd> brush · <kbd>⌘K</kbd> palette · wheel zoom · dbl-click resets
        </div>
      </section>
    </aside>
  );
}
