// Single-file DICOM upload (US cine included): decode every frame through
// the pixel pipeline and open it as a series. Split out of sessionOps when
// the US lane pushed it over the 700-line gate; the router still lives
// there, the decode + cine arming lives here (rule 1: one module, one job).
import {
  doseStats, encapsulatedDocLabel, fileMetaToSummary, groupDicomStacks, isEncapsulatedSopClass, stackLabel,
  isRtDoseSopClass, isRtPlanSopClass, isTomoSopClass, isUsSopClass,
  isVlSopClass, parseDicomFrames, parseEncapsulatedDoc, parseRtDose, parseRtPlan,
  parseVlGrid, readDataset, RTSTRUCT_SOP_CLASS, SEG_SOP_CLASS, stackPixelSpacing,
  stackZGap, summarizeDataset, usRegionsFromBuffer, vlGridLabel,
} from '@carys/io';
import { addUploadedSeries } from './catalog';
import { volumeFromStack } from './formatLoaders';
import { importDicomSeg } from './segImport';
import { loadSeries } from './sessionOps';
import { session } from './session';
import { setStatus } from './status';
import { CINE_MAX_FPS } from './cine';
import { setUi } from './store';
import { toast } from './toasts';
import { bump } from './version';

/**
 * Open a single-file DICOM upload (US cine included): decode every frame
 * through the pixel pipeline, keep frame order as the time axis (US frames
 * are time, not z — the cine transport replays them), seed fps from the
 * file's cine tags, tag the row with regions + playback. SEG/RTSTRUCT
 * still route to the segmentation importer first; non-DICOM bytes fall
 * through to the NIfTI path exactly as before (never a new rejection).
 */
export async function uploadDicomFile(f: File): Promise<void> {
  try {
    const buf = await f.arrayBuffer();
    let sop: string | null = null;
    // loadSeries starts every volume from a clean session (vlGrid included),
    // so a grid parsed before it is re-applied after it.
    let vlGrid: ReturnType<typeof parseVlGrid> | null = null;
    try {
      sop = readDataset(buf.slice(0)).text('00080016');
    } catch { /* not a dataset: fall through to NIfTI */ }
    if (sop === SEG_SOP_CLASS || sop === RTSTRUCT_SOP_CLASS) {
      await importDicomSeg(buf, f.name);
      return;
    }
    // VL whole-slide: tile grid onto the session + tag browser (the
    // representative tile opens as the image — full pyramids stay out).
    if (sop != null && isVlSopClass(sop)) {
      let grid;
      try {
        grid = parseVlGrid(readDataset(buf.slice(0)));
      } catch (e) {
        setStatus(`VL rejected: ${(e as Error).message}`, 'error');
        return;
      }
      const name = `vl: ${f.name}`;
      addUploadedSeries(name);
      vlGrid = grid;
      session.vlGrid = grid;
      session.wsiAnnotations = [];
      session.dcmMeta = summarizeDataset(readDataset(buf.slice(0)));
      // fall through to the pixel pipeline below: the file's own tile
      // decodes as the representative image (never a fake volume)
    }
    // Encapsulated PDF/CDA: metadata row only (bytes never interpreted).
    if (sop != null && isEncapsulatedSopClass(sop)) {
      let doc;
      try {
        doc = parseEncapsulatedDoc(readDataset(buf.slice(0)));
      } catch (e) {
        setStatus(`Document rejected: ${(e as Error).message}`, 'error');
        return;
      }
      const name = `doc: ${f.name}`;
      addUploadedSeries(name);
      session.encapsulatedDoc = { ...doc, sopClassUID: sop };
      session.dcmMeta = summarizeDataset(readDataset(buf.slice(0)));
      setStatus(`Document ${f.name}: ${encapsulatedDocLabel(doc, sop)}`);
      toast(`Document loaded: ${doc.title ?? f.name}`);
      bump();
      return;
    }
    // RTPLAN: plan summary onto the session + tag browser (no pixels).
    if (sop != null && isRtPlanSopClass(sop)) {
      let plan;
      try {
        plan = parseRtPlan(readDataset(buf.slice(0)));
      } catch (e) {
        setStatus(`RTPLAN rejected: ${(e as Error).message}`, 'error');
        return;
      }
      // No pixels: keep the current image on screen, register the plan as
      // a series row so it appears in the worklist without a fake volume.
      const name = `rtplan: ${f.name}`;
      addUploadedSeries(name);
      session.rtPlan = plan;
      session.dcmMeta = summarizeDataset(readDataset(buf.slice(0)));
      setStatus(`RTPLAN ${f.name}: ${plan.label ?? plan.name ?? '?'} · ${plan.beams.length} beam(s)`
        + `${plan.fractionsPlanned != null ? ` · ${plan.fractionsPlanned} fx` : ''}`
        + `${plan.prescriptionDoses[0] != null ? ` · Rx ${plan.prescriptionDoses[0]} Gy` : ''}`);
      toast(`RTPLAN loaded: ${plan.label ?? plan.name ?? f.name}`);
      bump();
      return;
    }
    // RTDOSE: Gy grid opens as the volume (isodose-ready), DVH rides along.
    if (sop != null && isRtDoseSopClass(sop)) {
      let grid;
      try {
        grid = parseRtDose(readDataset(buf.slice(0)));
      } catch (e) {
        setStatus(`RTDOSE rejected: ${(e as Error).message}`, 'error');
        return;
      }
      const st = doseStats(grid);
      const name = `rtdose: ${f.name}`;
      addUploadedSeries(name);
      session.rtDose = grid;
      const n = grid.rows * grid.cols * grid.frames;
      const data = new Float64Array(n);
      for (let i = 0; i < n; i++) data[i] = grid.data[i]!;
      const init = await loadSeries(name, {
        dims: [grid.cols, grid.rows, grid.frames], data,
        spacing: [grid.pixelSpacing[1], grid.pixelSpacing[0],
          grid.frames > 1
            ? Math.abs(grid.gridOffsets[1]! - grid.gridOffsets[0]!) || 1
            : 1],
      });
      if (init) {
        session.pendingSliceInit = init;
        session.dcmRegions = [];
        session.dcmMeta = summarizeDataset(readDataset(buf.slice(0)));
        setStatus(`RTDOSE ${f.name}: max ${st.max.toFixed(2)} Gy · mean ${st.mean.toFixed(2)} Gy`
          + `${grid.dvhs.length > 0 ? ` · DVH ${grid.dvhs.length} ROI(s)` : ''}`);
        bump();
      }
      return;
    }
    let parts;
    try {
      parts = parseDicomFrames(buf.slice(0));
    } catch (e) {
      setStatus(`DICOM rejected: ${(e as Error).message}`, 'error');
      return;
    }
    const first = parts[0]!.meta;
    // Cross-sectional images (a CT slice, an Enhanced CT/MR multi-frame with
    // per-frame positions) are space, not time: they go through the same
    // stack builder as a folder — ordered by position, placed in the patient,
    // oriented on screen. US cine, tomo and whole-slide tiles keep frame order.
    if (!isUsSopClass(first.sopClassUID) && !isTomoSopClass(first.sopClassUID) && !isVlSopClass(first.sopClassUID)) {
      const stack = groupDicomStacks(parts)[0]!;
      const name = `uploaded: ${f.name}`;
      addUploadedSeries(name, undefined, { modality: first.modality ?? undefined });
      session.seriesMeta.set(name, { meta: stack.meta, warnings: stack.warnings.map((w) => w.message) });
      const init = await loadSeries(name, volumeFromStack(stack));
      if (init) {
        session.pendingSliceInit = init;
        session.dcmMeta = fileMetaToSummary(stack.meta, stack.meta.sopClassUID, usRegionsFromBuffer(buf.slice(0)));
        // The result goes on the status line too: the toast is gone in
        // seconds, the status is what a reader glances back at.
        setStatus(`Loaded ${f.name}: ${stackLabel(stack)}`);
        toast(`Loaded ${f.name}`);
        bump();
      }
      return;
    }
    const n = first.rows * first.cols;
    const frames = parts.map((p) => p.slice.pixelData);
    const data = new Float64Array(n * frames.length);
    frames.forEach((px, fi) => {
      for (let i = 0; i < n; i++) data[fi * n + i] = px[i]!;
    });
    const regions = usRegionsFromBuffer(buf.slice(0));
    const name = `uploaded: ${f.name}`;
    addUploadedSeries(name);
    session.dcmRegions = regions;
    const fps = first.cineFps;
    if (fps != null) setUi({ cineFps: Math.min(CINE_MAX_FPS, Math.max(1, Math.round(fps))) });
    const asFrames = frames.map((px) => {
      const f64 = new Float64Array(n);
      for (let i = 0; i < n; i++) f64[i] = px[i]!;
      return f64;
    });
    // Stack geometry resolves through the tomo helpers (imager spacing +
    // slice interval fallbacks) — one derivation for every stack.
    const usp = stackPixelSpacing(first) ?? [1, 1];
    const init = await loadSeries(name, {
      dims: [first.cols, first.rows, frames.length], data,
      spacing: [usp[1], usp[0], stackZGap(first)],
    });
    if (init) {
      session.pendingSliceInit = init;
      if (vlGrid) session.vlGrid = vlGrid;
      session.dcmFrames = { frames: asFrames, n };
      // A VL tile's tag browser is its dataset (grid, optical paths), which
      // the frame summary does not carry.
      session.dcmMeta = vlGrid
        ? summarizeDataset(readDataset(buf.slice(0)))
        : fileMetaToSummary(first, first.sopClassUID, regions);
      if (isUsSopClass(first.sopClassUID) && frames.length > 1) {
        session.timeNt = frames.length;
        session.baseFrame = Float64Array.from(data.subarray(0, n));
        setStatus(`US cine ${f.name}: ${frames.length} frames @ ${fps != null ? `${fps} fps` : 'file rate unknown — slider default'}${regions.length > 0 ? ` · ${regions.length} region(s)` : ''}`);
      } else if (isTomoSopClass(first.sopClassUID)) {
        const lat = first.imageLaterality ?? first.laterality;
        setStatus(`Tomo ${f.name}: ${frames.length} slice(s)${lat ? ` · ${lat}` : ''}${first.viewPosition ? ` ${first.viewPosition}` : ''} · Δ ${stackZGap(first)} mm`);
      } else if (isVlSopClass(first.sopClassUID)) {
        const label = session.vlGrid ? vlGridLabel(session.vlGrid) : null;
        setStatus(`VL ${f.name}: tile ${first.cols}×${first.rows}${label ? ` · ${label}` : ''} (representative — full pyramid stays out)`);
      } else {
        toast(`Loaded ${f.name}`);
      }
      bump(); // MprView consumes the pending init on this version
    }
  } catch (err) {
    setStatus(`upload failed: ${(err as Error).message}`, 'error');
  }
}
