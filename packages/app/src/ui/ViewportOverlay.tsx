import type { JSX } from 'react';
import { EDUCATION_BADGE } from '@carys/study';
import { fmtDims, session } from '../lib/session';
import { useUiPick } from '../lib/store';
import { useVersion } from '../lib/version';

/**
 * Viewport corner overlay.
 *
 * Every reading workstation puts study identity in the four corners of each
 * viewport, because that is what a reader checks before calling anything:
 * who this is, when it was taken, which series, and on what window. This
 * replaces the decorative corner brackets that previously sat exactly where
 * that information belongs.
 *
 * Purely a readout — `pointer-events: none`, so painting and window/level
 * drags pass straight through to the canvas underneath. The anatomical edge
 * letters and the mm scale bar stay rasterised on the canvas itself
 * (`iopEdgeLabels`), so there is one implementation of each, not two (§4).
 */
export function ViewportOverlay({ compact = false }: { compact?: boolean }): JSX.Element {
  useVersion();
  const series = useUiPick('series');
  const m = session.dcmMeta;
  const img = session.img;
  const wl = session.wl;

  // DICOM dates are YYYYMMDD; show them the way a reader expects to read them.
  const date = m?.studyDate && /^\d{8}$/.test(m.studyDate)
    ? `${m.studyDate.slice(0, 4)}-${m.studyDate.slice(4, 6)}-${m.studyDate.slice(6, 8)}`
    : m?.studyDate ?? '';

  const tl = [m?.patientName, m?.patientID].filter(Boolean) as string[];
  const tr = [m?.modality, date].filter(Boolean) as string[];
  const bl = [m?.seriesDescription ?? series, img ? fmtDims(img.dims) : null].filter(Boolean) as string[];
  const br: string[] = [];
  if (wl) br.push(`W ${Math.round(wl.width)} · C ${Math.round(wl.center)}`);
  if (m?.sliceThickness) br.push(`${m.sliceThickness} mm`);

  return (
    <div className="vp-ov" aria-hidden="true">
      <div className="vp-ov-tl">{tl.map((t) => <span key={t}>{t}</span>)}</div>
      <div className="vp-ov-tr">{tr.map((t) => <span key={t}>{t}</span>)}</div>
      {!compact && <div className="vp-ov-bl">{bl.map((t) => <span key={t}>{t}</span>)}</div>}
      <div className="vp-ov-br">{br.map((t) => <span key={t}>{t}</span>)}</div>
      {/* A non-diagnostic viewer says so on the image, not only in a footnote. */}
      <div className="vp-ov-warn">{EDUCATION_BADGE}</div>
    </div>
  );
}
