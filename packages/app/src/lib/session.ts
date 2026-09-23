import type { DicomFileMeta, Nifti1Header } from '@carys/io';
import type {
  DicomTagSummary, EncapsulatedDoc, RtDoseGrid, RtPlan, UsRegion, VlGrid,
} from '@carys/io';
import type { ThresholdSuggestion } from '@carys/volume-core';
import type { Measurement } from '@carys/measure';
import type { FiberSet, Mesh, Volume } from './types';

// JIT caches: fetch once, extract once, pre-build when idle.
// Non-reactive on purpose — canvases paint imperatively; React only
// re-renders chrome when the store version bumps.

const VOL_BUDGET = 300 * 1024 * 1024;

class Session {
  img: Volume | null = null;
  seg: { dims: [number, number, number]; data: Uint8Array } | null = null;
  editMask: Uint8Array | null = null;
  mesh: Mesh | null = null;
  /** STL import pins the mesh: repaints reuse it until series/src/params change. */
  meshPinned: Mesh | null = null;
  fibers: FiberSet | null = null;
  /** Tract import pins streamlines: repaints reuse them like a pinned mesh. */
  fibersPinned: FiberSet | null = null;
  wl: { width: number; center: number } | null = null;
  autoWl: { width: number; center: number } | null = null;
  /** Isosurface range + suggested cut for the loaded volume (see autoThreshold).
   *  Null until a series loads; the 3D slider falls back to [0, 1000]. */
  autoThreshold: ThresholdSuggestion | null = null;
  /** compare overlay window (resolved when the overlay volume loads) */
  compareWl: { width: number; center: number } | null = null;
  axialFrac = 0.5;
  seriesNote = '';
  zoom3d = 1;
  /** Crosshair voxel (synced tap): reference lines on the other MPR panes. */
  crosshair: [number, number, number] | null = null;
  /** DICOM header summary for the open series (tag browser); null when the
   *  volume came from NIfTI/NRRD/Zarr or a PACS pull without file tags. */
  dcmMeta: DicomTagSummary | null = null;
  /** The single-image rule put the axial pane fullscreen (and may undo it). */
  autoSingle = false;
  /** Why the open DICOM stack's geometry is approximate (gaps, tilt,
   *  dropped repeats) — shown on the viewport, never only in a log. */
  stackWarnings: string[] = [];
  /** File identity + stack warnings per DICOM series name, so a cached
   *  revisit or an upload keeps its overlay, VOI window and warnings. */
  seriesMeta = new Map<string, { meta: DicomFileMeta; warnings: string[] }>();
  /** US region rows of the open file (tag browser + Doppler readout). */
  dcmRegions: UsRegion[] = [];
  /** RT adapters of the open file: plan summary and/or dose grid. */
  rtPlan: RtPlan | null = null;
  rtDose: RtDoseGrid | null = null;
  /** VL tile grid + encapsulated document of the open file. */
  vlGrid: VlGrid | null = null;
  /** C2 teaching annotations for the open VL tile (validated, tile pixels). */
  wsiAnnotations: { id: string; region: string; stain: string; rect: [number, number, number, number]; note: string }[] = [];
  encapsulatedDoc: (EncapsulatedDoc & { sopClassUID: string }) | null = null;
  /**
   * Digest pins (digest id → version pin) for knowledge bytes behind the
   * open figure. Empty today — A1 lands the first pins. Reset per volume
   * (see sessionOps), surfaced by DigestRows + carried by the sidecar.
   */
  digestPins: Record<string, string> = {};
  /** Uploads bypass App's sliceInit prop: the init rides here, consumed once by MprView. */
  pendingSliceInit: { ranges: Record<string, number>; values: Record<string, number> } | null = null;

  /** Last painted slice per plane (survives the report route, where the
   *  viewer unmounts; the sidecar reads these, not DOM sliders). */
  slices: Record<'axial' | 'coronal' | 'sagittal', number> = { axial: 0, coronal: 0, sagittal: 0 };
  maskVer = 0;
  paintToken = 0;
  loadCtrl: AbortController | null = null;
  /** 4D cine state: retained raw bytes + header, current frame, baseline. */
  rawNii: { hdr: Nifti1Header; buf: ArrayBuffer } | null = null;
  /** DICOM cine frames (US upload): decoded frame pixels + frame size. */
  dcmFrames: { frames: Float64Array[]; n: number } | null = null;
  timeT = 0;
  timeNt = 1;
  baseFrame: Float64Array | null = null;
  timeDiff: { meanAbs: number; changedFrac: number } | null = null;

  /** tracked measurements (all series) + in-progress points */
  measurements: Measurement[] = [];
  /** in-progress tap points: canvas pixels (drawn) + true 3D voxels (measured) */
  pendingMeasure: [number, number][] = [];
  pendingVoxel: [number, number, number][] = [];
  pendingPlane: 'axial' | 'coronal' | 'sagittal' | null = null;
  /** obliquity key at stroke start — a mid-stroke plane move restarts the stroke */
  pendingFrame: string | null = null;

  private vols = new Map<string, Volume>();
  private volBytes = 0;
  private meshes = new Map<string, Mesh>();
  private inflight = new Map<string, Promise<Mesh>>();

  getVol(name: string): Volume | undefined {
    return this.vols.get(name);
  }

  cacheVol(name: string, v: Volume): void {
    this.vols.delete(name);
    this.vols.set(name, v);
    this.volBytes += v.data.byteLength;
    for (const [k, old] of this.vols) {
      if (this.volBytes <= VOL_BUDGET || this.vols.size <= 1) break;
      this.vols.delete(k);
      this.volBytes -= old.data.byteLength;
    }
  }

  meshKey(series: string, src: string, threshold: number, method: string): string {
    return `${series}|m${this.maskVer}|${src}|${threshold}|${method}`;
  }

  getMesh(key: string): Mesh | undefined {
    return this.meshes.get(key);
  }

  cacheMesh(key: string, mesh: Mesh): void {
    this.meshes.delete(key);
    this.meshes.set(key, mesh);
    while (this.meshes.size > 5) this.meshes.delete(this.meshes.keys().next().value as string);
  }

  /**
   * One extraction per surface key at a time. The idle pre-build and the 3D
   * pane both ask for the default surface the moment a series opens, and
   * used to run it twice — twice the worker time and twice the copies on the
   * main thread, while the reader waited for the first paint.
   */
  meshOnce(key: string, run: () => Promise<Mesh>): Promise<Mesh> {
    const hit = this.inflight.get(key);
    if (hit) return hit;
    const p = run().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** A new volume: no cached surface of the old one may still be shown. */
  clearMeshes(): void {
    this.meshes.clear();
    this.meshPinned = null;
    this.mesh = null;
  }

  beginLoad(): AbortSignal {
    this.loadCtrl?.abort();
    this.loadCtrl = new AbortController();
    return this.loadCtrl.signal;
  }
}

export const session = new Session();

export function idle(fn: () => void): void {
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
  };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 4000 });
  else setTimeout(fn, 1500);
}

export function fmtDims(d: [number, number, number]): string {
  return `${d[0]}×${d[1]}×${d[2]}`;
}
