import { extractBoundary, renderVolume, smoothMesh, smoothSurface } from '@carys/render-cpu';
import type { TF } from '@carys/render-cpu';
import { toMask } from './loaders';
import type { Mesh } from './types';

export interface VrBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface VrParams {
  w: number;
  h: number;
  angleY: number;
  tiltX: number;
  zoom: number;
  tf: TF;
  step: number;
  shade: boolean;
  density: number;
  bounds: VrBounds | null;
  /** voxel size in mm: the volume is drawn at physical proportions */
  spacing: [number, number, number];
}

export interface VrResult {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
  ms: number;
}

// Worker-first mesh extraction with main-thread fallback.
// Loader fns are injected so pages don't hardcode dist paths.

interface Pending {
  resolve: (m: Mesh) => void;
  reject: (e: Error) => void;
}

interface PendingVr {
  resolve: (r: VrResult) => void;
  reject: (e: Error) => void;
}

export function createExtractor() {
  let worker: Worker | null = null;
  let workerDead = false;
  let nextId = 1;
  let usedWorker = false;
  const pending = new Map<number, Pending>();
  const pendingVr = new Map<number, PendingVr>();

  const getWorker = (): Worker | null => {
    if (worker || workerDead) return worker;
    try {
      worker = new Worker(new URL('../workers/extract.ts', import.meta.url), { type: 'module' });
      // Single router: mesh and volume replies share the channel.
      worker.onmessage = (e: MessageEvent) => {
        if (e.data.kind === 'volume') {
          const pv = pendingVr.get(e.data.id);
          if (!pv) return;
          pendingVr.delete(e.data.id);
          if (e.data.ok) {
            pv.resolve({ rgba: new Uint8ClampedArray(e.data.rgba), w: e.data.w, h: e.data.h, ms: e.data.ms });
          } else pv.reject(new Error(e.data.error));
          return;
        }
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.ok) {
          p.resolve({
            positions: new Float32Array(e.data.positions),
            normals: new Float32Array(e.data.normals),
            indices: new Uint32Array(e.data.indices),
            tris: e.data.tris,
            sliceFactor: e.data.factor,
          });
        } else p.reject(new Error(e.data.error));
      };
      worker.onerror = () => { workerDead = true; worker = null; };
    } catch {
      workerDead = true;
    }
    return worker;
  };

  /**
   * Surface of a field: the image (Float64) or a mask as it is stored
   * (Uint8). A mask used to be widened to Float64 first — 8 bytes a voxel,
   * 72 MB for a 240×240×155 brain, copied again to reach the worker; it now
   * travels at 1 byte a voxel, and the worker reads it by its own dtype.
   * The dtype also picks the smooth surface: a mask's is relaxed inside its
   * cells (maskNets, no terraces), an image's sits on the field itself.
   * `smoothing` (0–1) then filters a smooth surface, keeping its volume;
   * `spacing` lets thick slices be interpolated first (F5).
   */
  async function extract(
    data: Float64Array | Uint8Array, dims: [number, number, number], t: number, smooth: boolean, smoothing = 0,
    spacing: [number, number, number] = [1, 1, 1],
  ): Promise<Mesh> {
    const w = getWorker();
    if (w) {
      try {
        const id = nextId++;
        const copy = data.slice().buffer as ArrayBuffer;
        const dtype = data instanceof Uint8Array ? 'uint8' : 'float64';
        const p = new Promise<Mesh>((resolve, reject) => pending.set(id, { resolve, reject }));
        w.postMessage({ id, method: smooth ? 'smooth' : 'blocky', dims, threshold: t, smoothing, spacing, dtype, buffer: copy }, [copy]);
        const r = await p;
        usedWorker = true;
        return r;
      } catch {
        workerDead = true;
      }
    }
    const s = smooth ? smoothSurface(data, dims[0], dims[1], dims[2], spacing, t, data instanceof Uint8Array) : null;
    const raw = s ? s.mesh : extractBoundary(toMask(data, t), dims[0], dims[1], dims[2]);
    const mesh = smooth && smoothing > 0 ? smoothMesh(raw, { strength: smoothing }) : raw;
    usedWorker = false;
    return { ...mesh, tris: mesh.indices.length / 3, sliceFactor: s?.factor ?? 1 };
  }

  async function renderVr(data: Float64Array, dims: [number, number, number], vr: VrParams): Promise<VrResult> {
    const w = getWorker();
    if (w) {
      try {
        const id = nextId++;
        const copy = data.slice().buffer as ArrayBuffer;
        const p = new Promise<VrResult>((resolve, reject) => pendingVr.set(id, { resolve, reject }));
        w.postMessage({
          id, method: 'volume', dims, dtype: 'float64', buffer: copy,
          w: vr.w, h: vr.h, angleY: vr.angleY, tiltX: vr.tiltX, zoom: vr.zoom,
          tf: vr.tf, step: vr.step, shade: vr.shade, density: vr.density,
          bounds: vr.bounds, spacing: vr.spacing,
        }, [copy]);
        const r = await p;
        usedWorker = true;
        return r;
      } catch {
        workerDead = true;
      }
    }
    const r = renderVolume({ dims, data }, {
      width: vr.w, height: vr.h, angleY: vr.angleY, tiltX: vr.tiltX,
      zoom: vr.zoom, tf: vr.tf, step: vr.step, shade: vr.shade, density: vr.density,
      bounds: vr.bounds, spacing: vr.spacing,
    });
    usedWorker = false;
    return r;
  }

  return { extract, renderVr, get usedWorker() { return usedWorker; } };
}

export type Extractor = ReturnType<typeof createExtractor>;
