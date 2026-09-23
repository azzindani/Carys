import {
  UndoStack, close, connectedComponents, countVoxels, dilate, drawPenLine, drawPt, erode, fillHoles,
  fillGaps, keepLargest, open, regionGrow, smoothMask, splatFramePoint, strokeFrameLine, watershedSplit,
} from '@carys/editor-seg';
import {
  fileMetaToSummary, isNrrdLike, nrrdDetachedName,
  readDataset, RTSTRUCT_SOP_CLASS, SEG_SOP_CLASS,
  writeNifti1, type DicomFileMeta,
} from '@carys/io';
import { uploadDicomFile } from './dicomUpload';
import { importDicomSeg } from './segImport';
import { fitMeshToBox, fitPointsToBox, isGiftiLike, isMz3Like, isStlLike, isTckLike, isTrkLike, isTrxLike, parseGifti, parseMz3, parseStl, parseTck, parseTrk, parseTrx } from '@carys/render-cpu';
import { autoThreshold, histogram, PRESETS } from '@carys/volume-core';
import { DEFAULT_HANGING, HANGING_RULES, hangingProtocol } from '@carys/study';
import { addUploadedSeries, SERIES } from './catalog';
import { idle, session } from './session';
import { autoWindow, fileWindow, loadDicomSeries, loadNiiRaw, loadNrrdDetached, volumeFromNifti } from './loaders';
import { alongside, toSourceOrder } from './orient';
import { heldStackVolume, isDicomPart10, openDicomFiles, registerSiblingStacks } from './dicomSets';
import { loadVolumeUrl, parseUpload } from './parseClient';
import { readFrame } from '@carys/io';
import { paintBus } from './paintBus';
import { setEngine, setStatus } from './status';
import { getUi, setUi } from './store';
import { toast } from './toasts';
import { bump } from './version';
import type { Extractor } from './extractor';
import type { Plane } from './types';
import type { Volume } from './types';

export const undo = new UndoStack(16);
let extractorRef: Extractor | null = null;

export function setExtractor(e: Extractor): void {
  extractorRef = e;
}

/** Slice-slider ranges + initial positions, applied by MprView after load. */
export interface SliceInit {
  ranges: Record<Plane, number>;
  values: Record<Plane, number>;
}

export async function loadSeries(name: string, uploadedVol?: Volume): Promise<SliceInit | null> {
  const spec = SERIES[name] ?? {};
  const signal = session.beginLoad();
  setUi({ series: name });
  try {
    const cached = uploadedVol ? undefined : session.getVol(name);
    setStatus(cached ? `loading ${name} (cached)…` : `fetching ${name}…`);
    session.rawNii = null; session.timeT = 0; session.timeNt = 1;
    session.baseFrame = null; session.timeDiff = null;
    session.dcmFrames = null; session.dcmRegions = [];
    session.rtPlan = null; session.rtDose = null;
    session.vlGrid = null; session.encapsulatedDoc = null; session.wsiAnnotations = [];
    session.digestPins = {};
    session.crosshair = null;
    // a new volume invalidates any in-progress stroke (voxels are stale)
    session.pendingMeasure = [];
    session.pendingVoxel = [];
    session.pendingPlane = null;
    session.pendingFrame = null;
    session.dcmMeta = null;
    session.stackWarnings = [];
    let img: Volume;
    let dicomMeta: DicomFileMeta | null = null;
    if (!uploadedVol && !cached && spec.time && spec.img) {
      const raw = await loadNiiRaw(spec.img[0], { signal });
      if (signal.aborted) return null;
      session.rawNii = raw;
      session.timeNt = raw.hdr.nt;
      img = volumeFromNifti(raw.hdr, readFrame(raw.hdr, raw.buf, 0));
    } else if (!uploadedVol && !cached && spec.dicom) {
      const loaded = await loadDicomSeries(spec.dicom, { signal, pick: spec.stackIndex });
      if (signal.aborted) return null;
      img = loaded.vol;
      dicomMeta = loaded.meta;
      session.stackWarnings = loaded.stack.warnings.map((w) => w.message);
      session.seriesMeta.set(name, { meta: dicomMeta, warnings: session.stackWarnings });
      // Files that turned out to be several series open as several series.
      if (spec.stackIndex == null && loaded.stacks.length > 1) {
        registerSiblingStacks(name, spec, loaded.stacks);
      }
    } else {
      img = uploadedVol ?? cached ?? heldStackVolume(name)?.vol ?? await loadVolumeUrl(spec.img![0], { signal });
      // A revisit (cache) or an upload arrives without its file identity;
      // the meta recorded when its files were read rides along instead.
      const known = session.seriesMeta.get(name);
      if (known) { dicomMeta = known.meta; session.stackWarnings = known.warnings; }
    }
    if (signal.aborted) return null;
    if (session.rawNii) session.baseFrame = Float64Array.from(img.data);
    session.img = img;
    // Time series keep raw 4D bytes in session.rawNii instead of the vol cache.
    if (!uploadedVol && !cached && !spec.time) session.cacheVol(name, img);

    const segRaw = !uploadedVol && spec.seg ? await loadVolumeUrl(spec.seg[0], { signal }) : null;
    if (signal.aborted) return null;
    const base = segRaw ? alongside(img, segRaw) : null;
    let note: string;
    if (base && base.data.length !== img.data.length) {
      session.editMask = new Uint8Array(img.data.length);
      note = 'seg dims mismatch — empty mask';
    } else if (base) {
      // A label map keeps its labels, which the panes colour one by one
      // (F14); a probability map (the catalog names its cut) is one mask.
      const m = new Uint8Array(img.data.length);
      const cut = spec.segThreshold;
      const seen = new Set<number>();
      let over = 0;
      for (let i = 0; i < m.length; i++) {
        const v = base.data[i]!;
        if (!(v > (cut ?? 0))) continue;
        if (cut !== undefined || !Number.isInteger(v)) m[i] = 1;
        else if (v > 255) { m[i] = 255; over++; } else m[i] = v;
        seen.add(m[i]!);
      }
      session.editMask = m;
      note = `editing copy of seg${seen.size > 1 ? ` · ${seen.size} labels` : ''}${over ? ` · ${over} voxels of labels over 255 shown as 255` : ''}`;
    } else {
      session.editMask = new Uint8Array(img.data.length);
      note = uploadedVol ? 'uploaded volume' : 'no seg — empty mask';
    }
    // Auto-hanging: the modality (catalog, else the file's own tag) picks
    // layout + preset + proj before the window is computed, so the series
    // opens read-ready. With no modality at all the window is data-driven:
    // a CT preset left over from the previous series would put an MR or a
    // microscopy stack on a Hounsfield window and show it white.
    const modality = spec.modality ?? dicomMeta?.modality ?? null;
    if (modality && (!uploadedVol || dicomMeta)) {
      const hang = hangingProtocol(modality, spec.bodyPart ?? dicomMeta?.seriesDescription ?? name);
      setUi({ layout: hang.layout, preset: hang.preset, proj: hang.proj, hang: hang.protocol });
      note += ` · hanging: ${hang.protocol}`;
    } else if (!modality) {
      setUi({ preset: 'auto', hang: DEFAULT_HANGING.protocol });
    }
    if (session.rawNii) note += ` · 4D cine (${session.timeNt} frames, mask overlays current frame)`;
    session.seriesNote = note;
    if (dicomMeta) session.dcmMeta = fileMetaToSummary(dicomMeta, dicomMeta.sopClassUID);
    session.seg = { dims: img.dims, data: session.editMask };
    undo.clear();
    undo.push(session.editMask);
    session.maskVer++;
    session.clearMeshes();

    // 'auto' is the file's own VOI window when it has one (what the
    // modality intended), else the data-driven percentile window.
    // One histogram of the image feeds the window, the grow seed and the 3D
    // cut: each used to take its own pass over every voxel.
    const imgHist = histogram(img.data, 256);
    session.autoWl = fileWindow(dicomMeta) ?? autoWindow(img.data, imgHist);
    session.wl = getUi().preset === 'auto' ? session.autoWl : PRESETS[getUi().preset];
    // Data-driven grow default: start at the 90th percentile so the flood
    // begins in bright tissue (lesion) instead of the whole brain.
    try {
      const { hist, min, max } = imgHist;
      const total = img.data.length;
      let acc = 0, p90 = max;
      for (let bIdx = 0; bIdx < hist.length; bIdx++) {
        acc += hist[bIdx]!;
        if (acc / total >= 0.9) { p90 = min + ((bIdx + 0.5) / 256) * (max - min || 1); break; }
      }
      setUi({ growLo: Math.round(p90), growHi: Math.ceil(max) });
    } catch { /* keep previous window */ }
    // The 3D view is data-driven for the same reason the window and the grow
    // seed are.
    //
    // Source: it defaulted to the segmentation mask, so any series arriving
    // without one — which is every plain DICOM series, since a segmentation is
    // a separate object — opened the 3D pane on "empty mask" and looked like
    // 3D was unsupported for that format. It never was: the extractor takes a
    // Float64Array and dims and cannot tell DICOM from NIfTI. Fall back to the
    // image when there is nothing segmented to show.
    //
    // Threshold: a fixed 0 fused brain and skull into one shell on every
    // Hounsfield volume, and a fixed ceiling of 1000 could not reach cortical
    // bone at ~1100 HU. A catalog entry may still pin its own.
    const haveMask = session.editMask.some((v) => v > 0);
    const imageHint = autoThreshold(img.data, 256, imgHist);
    const maskHint = autoThreshold(session.editMask);
    session.thresholds = {
      image: { hint: imageHint, value: spec.threshold3d ?? imageHint.value },
      mask: { hint: maskHint, value: maskHint.value },
    };
    const src3d = haveMask ? 'mask' : 'image';
    session.autoThreshold = session.thresholds[src3d].hint;
    setUi({ src: src3d, threshold: session.thresholds[src3d].value });

    const [nx, ny, nz] = img.dims;
    // The catalog may name where the anatomy is (BraTS opens on the tumour,
    // 0.72 of the way up — the slice its render golden pins). The last
    // commit dropped this line and every series opened mid-volume.
    session.axialFrac = spec.axialFrac ?? 0.5;
    const init: SliceInit = {
      ranges: { axial: nz, coronal: ny, sagittal: nx },
      values: {
        axial: Math.floor(nz * session.axialFrac),
        coronal: Math.floor((ny - 1) / 2),
        sagittal: Math.floor((nx - 1) / 2),
      },
    };
    // Seed the sidecar slice record: a direct #/report visit never paints,
    // so the report route would otherwise read viewer defaults.
    session.slices = { ...init.values };
    // A single image has no depth: its reformats are one-voxel lines and a
    // "surface" of it is a slab. Open it as the 2D image it is; undo that
    // for the next real volume only if it was this rule that did it.
    if (nz === 1) {
      session.autoSingle = true;
      setUi({ fullVp: 'axial', mView: 'axial' });
    } else if (session.autoSingle) {
      session.autoSingle = false;
      if (getUi().fullVp === 'axial') setUi({ fullVp: null });
    }
    // Idle pre-reconstruction: default 3D surface ready before it's opened.
    const v0 = session.maskVer;
    idle(() => {
      void (async () => {
        try {
          const ui = getUi();
          if (v0 !== session.maskVer || ui.view !== 'mpr' || !extractorRef || !session.img) return;
          if (session.img.dims[2] < 2) return;
          const useMask = ui.src === 'mask' && session.editMask?.some((v) => v > 0);
          const field = useMask ? session.editMask! : session.img.data;
          if (getUi().series !== name) return;
          const key = session.meshKey(name, ui.src, ui.threshold, ui.method, ui.smooth3d);
          const dims = session.img.dims, ex = extractorRef;
          const mesh = await session.meshOnce(key, () => ex.extract(field, dims, ui.threshold, ui.method === 'smooth', ui.smooth3d, session.img!.spacing));
          if (v0 !== session.maskVer) return;
          session.cacheMesh(key, mesh);
        } catch { /* idle best-effort only */ }
      })();
    });

    bump();
    return init;
  } catch (e) {
    if (signal.aborted || (e as Error)?.name === 'AbortError') return null;
    setStatus(`failed: ${(e as Error).message}`, 'error');
    return null;
  }
}

export function doUndo(): void {
  if (!session.editMask || !session.img) { toast('Nothing to undo', 'error'); return; }
  const prev = undo.undo(session.editMask.length);
  if (prev) {
    session.editMask.set(prev);
    session.maskVer++;
    session.seg = { dims: session.img.dims, data: session.editMask };
    bump();
  } else toast('Nothing to undo', 'error');
}

export function doClear(): void {
  if (!session.editMask) return;
  undo.push(session.editMask);
  session.editMask.fill(0);
  session.maskVer++;
  bump();
  toast('Mask cleared', 'ok');
}

export function stampAt(x: number, y: number, z: number, value: number): void {
  const { editMask } = session;
  const img = session.img;
  if (!editMask || !img) return;
  const [nx, ny, nz] = img.dims;
  const rad = getUi().brush;
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy <= rad * rad) drawPt(editMask, nx, ny, nz, x + dx, y + dy, z, value);
    }
  }
}

export function strokeTo(a: [number, number, number], b: [number, number, number], value: number): void {
  const { editMask } = session;
  const img = session.img;
  if (!editMask || !img) return;
  const [nx, ny, nz] = img.dims;
  drawPenLine(editMask, nx, ny, nz, a, b, value);
}

export function pushUndo(): void {
  if (session.editMask) undo.push(session.editMask);
}

/** Oblique-axial stamp: frame pixel + brush disk through the tilted frame. */
export function stampFrameAt(
  frame: { center: [number, number, number]; row: [number, number, number]; col: [number, number, number] },
  W: number, H: number, i: number, j: number, value: number,
): number {
  const { editMask, img } = session;
  if (!editMask || !img) return 0;
  return splatFramePoint(editMask, img.dims, frame, W, H, i, j, getUi().brush, value);
}

/** Oblique-axial stroke: frame-space Bresenham, splatting each step. */
export function strokeFrameTo(
  frame: { center: [number, number, number]; row: [number, number, number]; col: [number, number, number] },
  W: number, H: number, a: [number, number], b: [number, number], value: number,
): number {
  const { editMask, img } = session;
  if (!editMask || !img) return 0;
  return strokeFrameLine(editMask, img.dims, frame, W, H, a, b, getUi().brush, value);
}

export function saveAxialPng(canvas: HTMLCanvasElement): void {
  const a = document.createElement('a');
  a.download = `axial-${getUi().series}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
  toast('Axial PNG saved', 'ok');
}

export function saveMaskNii(): void {
  const { editMask, img } = session;
  if (!editMask || !img) return;
  // Back onto the file's own grid, with its affine: the mask then overlays
  // the source scan in ITK-SNAP / Slicer / nibabel, not just in this viewer.
  const out = toSourceOrder(img, editMask);
  const buf = writeNifti1({
    dims: out.dims, spacing: out.spacing,
    origin: [0, 0, 0], dtype: 'uint8', data: out.data,
  }, out.affine ? { affine: out.affine, qformCode: out.qformCode || 1, sformCode: out.sformCode || 1 } : {});
  const a = document.createElement('a');
  a.download = `mask-${getUi().series}.nii`;
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(out.affine ? 'Mask .nii saved on the source grid (with orientation)' : 'Mask .nii saved (source had no orientation)', 'ok');
}

/** Shared file-open router (desktop toolbar + mobile Files panel + drop):
 *  routes chosen files to the paired-NRRD, mesh, tract, DICOM or volume
 *  importer. */
export function handleOpenFiles(files: File[]): void {
  if (files.length === 0) return;
  if (files.some((f) => /\.nhdr$/i.test(f.name))) { void uploadNrrdPair(files); return; }
  const f = files[0]!;
  if (/\.(stl|mz3|gii)$/i.test(f.name)) { void importMeshFile(f); return; }
  if (/\.(tck|trk|trx)$/i.test(f.name)) { void importTractFile(f); return; }
  void routeVolumeFiles(files);
}

/**
 * DICOM is recognised by content, not extension: PACS exports and CD
 * folders are full of extensionless "IM0001"-style files. One DICOM file
 * keeps the single-file path (SEG/RTSTRUCT/RT/US/VL/document routing);
 * several open as the series they contain. Everything else is a volume.
 */
async function routeVolumeFiles(files: File[]): Promise<void> {
  const dicom: File[] = [];
  for (const f of files) {
    if (/\.dcm$/i.test(f.name) || isDicomPart10(new Uint8Array(await f.slice(0, 132).arrayBuffer()))) dicom.push(f);
  }
  if (dicom.length > 1) {
    await openDicomFiles(dicom, async (name, vol) => {
      const init = await loadSeries(name, vol);
      if (init) session.pendingSliceInit = init;
    });
    return;
  }
  if (dicom.length === 1) { await uploadDicomFile(dicom[0]!); return; }
  await uploadNiiFile(files[0]!);
}

export async function uploadNiiFile(f: File): Promise<void> {
  try {
    const buf = await f.arrayBuffer();
    // Content sniffing, not extensions: downloads and PACS drops often
    // arrive without one. SEG/RTSTRUCT win on SOP UID, else NIfTI.
    let sop: string | null = null;
    try {
      sop = readDataset(buf.slice(0)).text('00080016');
    } catch { /* not a dataset: fall through to NIfTI */ }
    if (sop === SEG_SOP_CLASS || sop === RTSTRUCT_SOP_CLASS) {
      await importDicomSeg(buf, f.name);
      return;
    }
    // uploads decode in the parse worker (main-thread fallback inside)
    const v = await parseUpload(buf, f.name);
    const name = `uploaded: ${f.name}`;
    addUploadedSeries(name);
    const init = await loadSeries(name, v);
    if (init) {
      session.pendingSliceInit = init;
      bump(); // MprView consumes the pending init on this version
    }
    toast(`Loaded ${f.name}`);
  } catch (err) {
    setStatus(`upload failed: ${(err as Error).message}`, 'error');
  }
}

/**
 * Open a detached .nhdr + data-file pair selected together in the file
 * picker. The header's "data file" name picks the sibling (exact filename
 * match; a lone second file is accepted as the payload). A bare .nhdr with
 * no sibling reports what to do instead of a decode error.
 */
export async function uploadNrrdPair(files: File[]): Promise<void> {
  try {
    const heads: File[] = [];
    for (const f of files) {
      if (/\.nhdr$/i.test(f.name)) { heads.push(f); continue; }
      const probe = new Uint8Array(await f.arrayBuffer()).slice(0, 8);
      if (isNrrdLike(probe)) heads.push(f);
    }
    if (heads.length === 0) throw new Error('no .nhdr header among the selected files');
    if (heads.length > 1) throw new Error(`ambiguous headers: ${heads.map((f) => f.name).join(', ')}`);
    const h = heads[0]!;
    const headerBuf = await h.arrayBuffer();
    let want: string | null = null;
    try {
      want = nrrdDetachedName(headerBuf.slice(0));
    } catch { /* not a header: fall through to the loud message below */ }
    if (want === null) throw new Error(`${h.name} names no "data file" — open an attached .nrrd, or select the header with its payload`);
    const others = files.filter((f) => f !== h);
    const dataFile = others.find((f) => f.name === want)
      ?? (others.length === 1 ? others[0]! : undefined);
    if (!dataFile) throw new Error(`${h.name} wants "${want}" — select it alongside the header`);
    const v = loadNrrdDetached(headerBuf, new Uint8Array(await dataFile.arrayBuffer()));
    const name = `uploaded: ${h.name} + ${dataFile.name}`;
    addUploadedSeries(name);
    const init = await loadSeries(name, v);
    if (init) {
      session.pendingSliceInit = init;
      bump(); // MprView consumes the pending init on this version
    }
    toast(`Loaded pair ${h.name} + ${dataFile.name}`);
  } catch (err) {
    setStatus(`upload failed: ${(err as Error).message}`, 'error');
  }
}

/** Import an .stl/.mz3/.gii mesh for the 3D view (framed into the open series viewBox). Content-sniffed. */
export async function importMeshFile(f: File): Promise<void> {
  const img = session.img;
  if (!img) {
    setStatus('open a series first — the mesh frames into its viewBox');
    return;
  }
  try {
    const buf = await f.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let parsed: { positions: Float32Array; normals: Float32Array; indices: Uint32Array } | null = null;
    if (isStlLike(bytes)) parsed = parseStl(buf);
    else if (isMz3Like(bytes)) parsed = parseMz3(buf).mesh;
    else if (isGiftiLike(bytes)) parsed = parseGifti(buf).mesh;
    if (!parsed) {
      setStatus(isGiftiLike(bytes)
        ? `no triangles in ${f.name} (scalar-only GIFTI overlay)`
        : `not a mesh file: ${f.name} (want .stl/.mz3/.gii)`);
      return;
    }
    const fitted = fitMeshToBox(parsed, img.dims);
    const tris = fitted.indices.length / 3;
    const mesh = { positions: fitted.positions, normals: fitted.normals, indices: fitted.indices, tris };
    session.meshPinned = mesh;
    session.mesh = mesh;
    bump();
    setStatus(`${tris.toLocaleString()} tris imported from ${f.name} — src/threshold edits re-extract`);
    toast(`Mesh imported: ${tris.toLocaleString()} triangles`, 'ok');
  } catch (err) {
    setStatus(`mesh import failed: ${(err as Error).message}`, 'error');
  }
}

/** Import an .stl mesh for the 3D view (legacy entry: sniffs .stl/.mz3/.gii). */
export async function importStlFile(f: File): Promise<void> {
  return importMeshFile(f);
}

/** Import a tractogram (.tck MRtrix / .trk TrackVis / .trx TRX) as pinned
 *  streamlines drawn over the 3D view. Content-sniffed: extensions only
 *  route here, the magic bytes decide the parser. */
export async function importTractFile(f: File): Promise<void> {
  const img = session.img;
  if (!img) {
    setStatus('open a series first — tracts frame into its viewBox');
    return;
  }
  try {
    const buf = await f.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let pts: Float32Array | null = null;
    let offsetPt0: Uint32Array | null = null;
    let scalars: Float32Array | null = null;
    let scalarName: string | null = null;
    if (isTckLike(bytes)) {
      const tck = parseTck(buf);
      pts = tck.pts; offsetPt0 = tck.offsetPt0;
    } else if (isTrkLike(bytes)) {
      const trk = parseTrk(buf);
      pts = trk.pts; offsetPt0 = trk.offsetPt0;
      if (trk.scalars) {
        // first scalar channel rides along for the along-tract profile
        const n = pts.length / 3;
        scalars = new Float32Array(n);
        for (let i = 0; i < n; i++) scalars[i] = trk.scalars[i * trk.nScalars]!;
        scalarName = `${trk.nScalars} per-vertex scalar(s), ch 0 shown`;
      }
    } else if (isTrxLike(bytes)) {
      const trx = parseTrx(buf);
      pts = trx.pts; offsetPt0 = trx.offsetPt0;
      const first = trx.dps.keys().next();
      if (!first.done) {
        scalars = trx.dps.get(first.value)!;
        scalarName = first.value;
      }
    } else {
      setStatus(`not a tract file: ${f.name}`);
      return;
    }
    let count = 0;
    for (let s = 0; s + 1 < offsetPt0.length; s++) {
      if (offsetPt0[s + 1]! - offsetPt0[s]! >= 2) count++;
    }
    if (count === 0) {
      setStatus(`no drawable streamlines in ${f.name}`);
      return;
    }
    const set = { pts: fitPointsToBox(pts, img.dims), offsetPt0, count, scalars, scalarName };
    session.fibersPinned = set;
    session.fibers = set;
    bump();
    const noun = count === 1 ? 'streamline' : 'streamlines';
    const extra = scalarName ? ` · scalars: ${scalarName}` : '';
    setStatus(`${count.toLocaleString()} ${noun} imported from ${f.name}${extra}`);
    toast(`Tracts imported: ${count.toLocaleString()} ${noun}${extra}`, 'ok');
  } catch (err) {
    setStatus(`tract import failed: ${(err as Error).message}`, 'error');
  }
}

/** Import a DICOM-SEG or RTSTRUCT file as the editable mask. */
export function setEngineFromExtractor(): void {
  if (extractorRef) setEngine(extractorRef.usedWorker ? 'worker' : 'main');
}

/* ---------- segmentation ops: every op is undoable, counted, toasted ---------- */

export type SegOpName =
  | 'islands' | 'holes' | 'erode' | 'dilate' | 'open' | 'close' | 'smooth' | 'interp' | 'split' | 'multilab';

export const SEG_OPS: { name: SegOpName; label: string; title: string }[] = [
  { name: 'islands', label: 'Islands', title: 'Keep largest component' },
  { name: 'holes', label: 'Holes', title: 'Fill holes (per-slice)' },
  { name: 'erode', label: 'Erode', title: 'Peel one layer' },
  { name: 'dilate', label: 'Dilate', title: 'Grow one layer' },
  { name: 'open', label: 'Open', title: 'Remove specks (erode→dilate)' },
  { name: 'close', label: 'Close', title: 'Fill notches (dilate→erode)' },
  { name: 'smooth', label: 'Smooth', title: 'Mean-filter smooth' },
  { name: 'interp', label: 'Interp Z', title: 'Morph across empty slices' },
  { name: 'split', label: 'Split', title: 'Watershed split at shape necks' },
  { name: 'multilab', label: 'Multi-Lbl', title: 'Split mask into per-component label values' },
];

/** Run a mask-wide op async (yields so the status paints first). */
export async function applySegOp(op: SegOpName): Promise<void> {
  const { editMask, img } = session;
  if (!editMask || !img) return;
  const [nx, ny, nz] = img.dims;
  const d = { nx, ny, nz };
  const before = countVoxels(editMask);
  setStatus(`${op}…`);
  await new Promise((r) => setTimeout(r, 10));
  pushUndo();
  let filled = 0;
  let basins = 0;
  switch (op) {
    case 'islands': session.editMask = keepLargest(editMask, d); break;
    case 'holes': session.editMask = fillHoles(editMask, nx, ny, nz); break;
    case 'erode': session.editMask = erode(editMask, d, 1); break;
    case 'dilate': session.editMask = dilate(editMask, d, 1); break;
    case 'open': session.editMask = open(editMask, d, 1); break;
    case 'close': session.editMask = close(editMask, d, 1); break;
    case 'smooth': session.editMask = smoothMask(editMask, d, 1); break;
    case 'interp': {
      const r = fillGaps(editMask, d);
      session.editMask = r.mask;
      filled = r.filled;
      break;
    }
    case 'split': {
      const r = watershedSplit(editMask, d);
      session.editMask = r.mask;
      basins = r.basins;
      break;
    }
    case 'multilab': {
      // one label value per connected island (1..N): the binary mask becomes
      // a multi-label SEG source; the segments table (Inspector) reports it
      const { labels, count } = connectedComponents(editMask, nx, ny, nz);
      const lm = new Uint8Array(editMask.length);
      for (let i = 0; i < labels.length; i++) {
        lm[i] = editMask[i] ? Math.min(255, labels[i]! + 1) : 0;
      }
      session.editMask = lm;
      basins = count;
      break;
    }
  }
  session.maskVer++;
  session.seg = { dims: img.dims, data: session.editMask };
  const after = countVoxels(session.editMask);
  bump();
  // Order matters: the bump-triggered repaint writes a generic status first;
  // the op summary lands after it so it survives.
  await new Promise((r) => setTimeout(r, 60));
  const extra = op === 'interp' ? ` · ${filled} slices` : op === 'split' ? ` · ${basins} basins` : '';
  setStatus(`${op}: ${before.toLocaleString()} → ${after.toLocaleString()} vox${extra}`);
  toast(`${op}: ${before.toLocaleString()} → ${after.toLocaleString()} voxels${extra}`);
}

/** Apply a hanging protocol by rule id (or 'default'): layout + preset + proj. */
export function applyHanging(id: string): void {
  const rule = HANGING_RULES.find((r) => r.id === id);
  const c = rule ? rule.choice : DEFAULT_HANGING;
  setUi({ layout: c.layout, preset: c.preset, proj: c.proj, hang: rule?.id ?? 'default' });
  session.wl = c.preset === 'auto' ? session.autoWl : PRESETS[c.preset];
  bump();
  setStatus(`hanging: ${rule?.id ?? 'default'} → ${c.layout} · ${c.preset} · ${c.proj}`);
}

export function hangingOptions(): { id: string; label: string }[] {
  return [
    { id: 'default', label: 'Default 3-up' },
    ...HANGING_RULES.map((r) => ({ id: r.id, label: `${r.id} (${r.modality})` })),
  ];
}

/** Calibrate pixel spacing (OHIF Calibration): override one voxel axis in
 *  mm, live for measures/scale bar. Clears derived 3D surfaces (baked in
 *  old units); fibers are voxel-box pinned and unaffected. */
export function setSpacing(axis: 0 | 1 | 2, raw: string): void {
  const img = session.img;
  if (!img) {
    setStatus('open a series first — nothing to calibrate');
    return;
  }
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0 || v > 1000) {
    setStatus(`spacing rejected: "${raw}" is not a positive mm value`, 'error');
    return;
  }
  const sp: [number, number, number] = [...(img.spacing ?? [1, 1, 1])] as [number, number, number];
  sp[axis] = v;
  img.spacing = sp;
  session.clearMeshes();
  bump();
  paintBus.mpr();
  paintBus.surface();
  setStatus(`spacing calibrated: ${sp.map((s) => Number(s).toFixed(3)).join(' × ')} mm`);
  toast(`Spacing calibrated: ${sp.map((s) => Number(s).toFixed(3)).join(' × ')} mm`);
}
/** Region-grow from a seed voxel into the intensity window, OR-ed in. */
export function growFromSeed(x: number, y: number, z: number): number {
  const { editMask, img } = session;
  if (!editMask || !img) return 0;
  const { growLo, growHi } = getUi();
  const grown = regionGrow(
    {
      dims: img.dims, spacing: img.spacing ?? [1, 1, 1], origin: [0, 0, 0],
      dtype: 'float64', data: img.data,
    },
    [x, y, z],
    growLo, growHi,
  );
  let n = 0;
  for (let i = 0; i < editMask.length; i++) {
    if (grown[i]) { if (!editMask[i]) n++; editMask[i] = 1; }
  }
  if (n > 0) {
    session.maskVer++;
    session.seg = { dims: img.dims, data: editMask };
    bump();
  }
  return n;
}
