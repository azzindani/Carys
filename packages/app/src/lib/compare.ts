// Dual-volume compare overlay: resolve the second series without
// disturbing the open one, prime its window, and repaint when it lands.
// Split out of sessionOps when geometry-aware loading pushed that module
// past the 700-line gate (rule 1: one module, one job).
import { readFrame } from '@carys/io';
import { SERIES } from './catalog';
import { autoWindow, loadDicomSeries, loadNii, loadNiiRaw, volumeFromNifti } from './loaders';
import { paintBus } from './paintBus';
import { session } from './session';
import { setStatus } from './status';
import { getUi, setUi } from './store';
import { toast } from './toasts';
import type { Volume } from './types';

/**
 * Resolve any series to a display Volume without disturbing the open one:
 * vol cache first, then the same decode path loadSeries uses (NIfTI /
 * DICOM / NRRD / OME-TIFF). Powers the compare overlay. Uploads already
 * live in the vol cache via addUploadedSeries + loadSeries.
 */
export async function resolveCompareVolume(name: string): Promise<Volume> {
  const hit = session.getVol(name);
  if (hit) return hit;
  const spec = SERIES[name] ?? {};
  if (spec.time && spec.img) {
    const raw = await loadNiiRaw(spec.img[0]!);
    const v = volumeFromNifti(raw.hdr, readFrame(raw.hdr, raw.buf, 0));
    session.cacheVol(name, v);
    return v;
  }
  if (spec.dicom) {
    const loaded = await loadDicomSeries(spec.dicom, { pick: spec.stackIndex });
    session.cacheVol(name, loaded.vol);
    return loaded.vol;
  }
  if (spec.img) {
    const v = await loadNii(spec.img[0]!);
    session.cacheVol(name, v);
    return v;
  }
  throw new Error(`compare-no-source: ${name}`);
}

/**
 * Set the compare overlay series + prime its volume and window in the
 * background; the panes repaint with "compare loading…" until it lands.
 * Same series or '' clears the overlay (compare needs two volumes).
 */
export function setCompare(series: string, mode: 'checker' | 'alpha' | 'subtract' | 'off'): void {
  const u = getUi();
  if (mode === 'off' || !series || series === u.series) {
    setUi({ compareSeries: '', compareMode: 'off' });
    session.compareWl = null;
    paintBus.mpr();
    return;
  }
  setUi({ compareSeries: series, compareMode: mode });
  session.compareWl = null;
  paintBus.mpr();
  void resolveCompareVolume(series)
    .then((v) => {
      // overlay hasn't moved on while we fetched: still wanted, still base
      const now = getUi();
      if (now.compareSeries !== series || now.series !== u.series) return;
      session.compareWl = autoWindow(v.data);
      paintBus.mpr();
      toast(`Compare: ${u.series} vs ${series} (${mode})`);
    })
    .catch((e) => {
      setStatus(`compare failed: ${(e as Error).message}`, 'error');
      setUi({ compareSeries: '', compareMode: 'off' });
      paintBus.mpr();
    });
}
