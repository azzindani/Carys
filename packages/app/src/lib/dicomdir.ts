// DICOMDIR open wiring: resolve a parsed directory tree against the
// user-selected files and load the picked series. Chrome only — tree
// math stays in io/dicomdir.ts (pure), slice decode in loaders.ts.
// No new ids beyond dock-dir: the series picker reuses DarkSelect.
import { parseDicomDir, resolveDicomDirFiles, type DicomDir, type DicomDirSeries } from '@carys/io';
import { parseDicomFrames, stackPixelSpacing, stackZGap, type ParsedDicomSlice } from '@carys/io';
import { sortSlices, stackToVolume } from '@carys/io';
import { addUploadedSeries } from './catalog';
import { loadSeries } from './sessionOps';
import { session } from './session';
import { setStatus } from './status';
import { toast } from './toasts';
import { bump } from './version';
import type { Volume } from './types';

function volumeFromParsed(parts: ParsedDicomSlice[]): Volume {
  const order = new Map(parts.map((s) => [s.slice, s.meta.sliceLocation ?? s.meta.instanceNumber ?? 0]));
  const slices = sortSlices(parts.map((s) => s.slice)).sort((a, b) => order.get(a)! - order.get(b)!);
  const stacked = stackToVolume(slices);
  const n = stacked.dims[0] * stacked.dims[1] * stacked.dims[2];
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) data[i] = stacked.data[i];
  const m0 = parts[0]?.meta;
  const ps = (m0 && stackPixelSpacing(m0)) ?? [1, 1];
  const zgap = m0 ? stackZGap(m0) : 1;
  return { dims: stacked.dims, data, spacing: [ps[1], ps[0], zgap] };
}

/** Parse a DICOMDIR buffer (loud rejects land on the status). */
export async function parseDicomDirFile(f: File): Promise<DicomDir | null> {
  try {
    const dir = parseDicomDir(await f.arrayBuffer());
    setStatus(`DICOMDIR ${f.name}: ${dir.studies.length} studie(s) · ${dir.imageCount} image refs`);
    return dir;
  } catch (err) {
    setStatus(`DICOMDIR rejected: ${(err as Error).message}`, 'error');
    return null;
  }
}

/** Load one directory series: match file ids to uploaded Files, decode
 *  each to slices (multi-frame expands), stack, open as a series. */
export async function openDicomDirSeries(
  dirName: string, series: DicomDirSeries, files: File[],
): Promise<void> {
  const { matched, missing } = resolveDicomDirFiles(series, files);
  if (matched.length === 0) {
    setStatus(`DICOMDIR series has no matching files (refs: ${series.images.map((i) => i.fileId).join(', ') || 'none'}) — select the referenced files alongside DICOMDIR`);
    return;
  }
  try {
    const parts = [];
    for (const f of matched) {
      const real = files.find((x) => x.name === (f as { name: string }).name)!;
      for (const p of parseDicomFrames(await real.arrayBuffer())) parts.push(p);
    }
    const label = series.seriesUID ?? `series-${series.seriesNumber ?? '?'}`;
    const name = `dicomdir: ${dirName} / ${series.modality ?? '?'} ${series.seriesNumber ?? ''}`.trim();
    addUploadedSeries(name);
    const init = await loadSeries(name, volumeFromParsed(parts));
    if (init) {
      session.pendingSliceInit = init;
      bump();
    }
    toast(`DICOMDIR: ${matched.length} file(s) → ${label}`);
    setStatus(
      missing.length > 0
        ? `DICOMDIR series loaded with ${missing.length} missing: ${missing.join(', ')}`
        : `DICOMDIR series loaded: ${matched.length} file(s)`,
    );
  } catch (err) {
    setStatus(`DICOMDIR open failed: ${(err as Error).message}`, 'error');
  }
}
