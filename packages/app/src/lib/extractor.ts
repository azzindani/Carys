import { extractBoundary, mergeRows, renderVolume, smoothMesh, smoothSurface } from '@carys/render-cpu';
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
  /** the step the TF's opacity is defined for (render-cpu/vr.ts) */
  alphaStep?: number;
  /** one pass of a progressive refinement */
  jitter?: { pass: number; of: number };
  /** soft shadows + ambient light (render-cpu/vr-light.ts) */
  cinematic?: boolean;
}

export interface VrResult {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
  ms: number;
}

// Worker-first mesh extraction with main-thread fallback.
// Loader fns are injected so pages don't hardcode dist paths.
//
// Volume renders (F9) are split across a pool, rows interleaved so the
// dense middle of a body is shared out evenly. Each worker keeps its copy
// of the field under a key, so a refinement's passes copy it once. The
// pool is one worker per spare core, at most VR_MAX_WORKERS, and no more
// than VR_MEMORY_BUDGET of held copies.
const VR_MAX_WORKERS = 4;
const VR_MEMORY_BUDGET = 768 * 2 ** 20;
// Level of detail (F11): a smooth surface over the budget gets an orbit
// level, decimated on its own worker so extraction and VR never queue
// behind it. The bound is the quadric's, in mm: 0.5 keeps the phantoms
// within 0.15 mm of the full surface (render-cpu/src/test/decimate.test.ts).
const ORBIT_BUDGET = 100_000;
const LOD_MAX_ERROR = 0.5;

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
  const pendingLod = new Map<number, (m: Mesh | null) => void>();
  let lodWorker: Worker | null = null;
  // the volume pool: [the shared worker, extra render workers…], the key
  // each one holds, and a key per field array
  const pool: Worker[] = [];
  const holds = new Map<Worker, number>();
  const keys = new WeakMap<Float64Array, number>();
  let nextKey = 1;
  let vrWorkers = 0;

  const spawn = (): Worker => {
    const w = new Worker(new URL('../workers/extract.ts', import.meta.url), { type: 'module' });
    // Single router: mesh and volume replies share the channel.
    w.onmessage = (e: MessageEvent) => {
      if (e.data.kind === 'lod') {
        const done = pendingLod.get(e.data.id);
        pendingLod.delete(e.data.id);
        done?.(e.data.ok && !e.data.empty ? {
          positions: new Float32Array(e.data.positions), normals: new Float32Array(e.data.normals),
          indices: new Uint32Array(e.data.indices), tris: e.data.tris,
        } : null);
        return;
      }
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
    return w;
  };

  const getWorker = (): Worker | null => {
    if (worker || workerDead) return worker;
    try {
      worker = spawn();
      worker.onerror = () => { workerDead = true; worker = null; };
    } catch {
      workerDead = true;
    }
    return worker;
  };

  /** Workers for a render of `bytes`: the shared one first. */
  const poolFor = (bytes: number): Worker[] => {
    const first = getWorker();
    if (!first) return [];
    if (pool.length === 0) pool.push(first);
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    const want = Math.max(1, Math.min(VR_MAX_WORKERS, cores - 1, Math.floor(VR_MEMORY_BUDGET / Math.max(1, bytes))));
    try {
      while (pool.length < want) {
        const w = spawn();
        // a render worker that fails leaves the pool; the shared one stays
        w.onerror = () => { const i = pool.indexOf(w); if (i >= 0) pool.splice(i, 1); holds.delete(w); };
        pool.push(w);
      }
    } catch {
      // no more workers: render with those there are
    }
    return pool.slice(0, want);
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

  /** One worker's share of a volume render, sending the field only when
   *  that worker does not hold it. */
  const renderShare = async (
    w: Worker, data: Float64Array, key: number, dims: [number, number, number], vr: VrParams,
    rows: { from: number; every: number },
  ): Promise<VrResult> => {
    const send = (withField: boolean): Promise<VrResult> => {
      const id = nextId++;
      const p = new Promise<VrResult>((resolve, reject) => pendingVr.set(id, { resolve, reject }));
      const msg = {
        id, method: 'volume', key, dims, dtype: 'float64', rows,
        w: vr.w, h: vr.h, angleY: vr.angleY, tiltX: vr.tiltX, zoom: vr.zoom,
        tf: vr.tf, step: vr.step, shade: vr.shade, density: vr.density,
        bounds: vr.bounds, spacing: vr.spacing, alphaStep: vr.alphaStep, jitter: vr.jitter, cinematic: vr.cinematic,
      };
      if (withField) {
        const copy = data.slice().buffer as ArrayBuffer;
        holds.set(w, key);
        w.postMessage({ ...msg, buffer: copy }, [copy]);
      } else {
        w.postMessage(msg);
      }
      return p;
    };
    if (holds.get(w) === key) {
      try {
        return await send(false);
      } catch (e) {
        if (!/vr-volume-missing/.test((e as Error).message)) throw e;
      }
    }
    return send(true);
  };

  async function renderVr(data: Float64Array, dims: [number, number, number], vr: VrParams): Promise<VrResult> {
    const workers = workerDead ? [] : poolFor(data.byteLength);
    if (workers.length > 0) {
      try {
        let key = keys.get(data);
        if (key === undefined) { key = nextKey++; keys.set(data, key); }
        const t0 = performance.now();
        const parts = await Promise.all(workers.map((w, k) => renderShare(w, data, key!, dims, vr, { from: k, every: workers.length })));
        usedWorker = true;
        vrWorkers = workers.length;
        return { rgba: mergeRows(parts.map((p) => p.rgba), vr.w, vr.h), w: vr.w, h: vr.h, ms: Math.round(performance.now() - t0) };
      } catch {
        workerDead = true;
      }
    }
    const r = renderVolume({ dims, data }, {
      width: vr.w, height: vr.h, angleY: vr.angleY, tiltX: vr.tiltX,
      zoom: vr.zoom, tf: vr.tf, step: vr.step, shade: vr.shade, density: vr.density,
      bounds: vr.bounds, spacing: vr.spacing, alphaStep: vr.alphaStep, jitter: vr.jitter, cinematic: vr.cinematic,
    });
    usedWorker = false;
    vrWorkers = 0;
    return r;
  }

  /**
   * The orbit level of a smooth surface over ORBIT_BUDGET triangles, or
   * null (within budget, nothing the bound allows, no worker). Voxel units
   * like the mesh; `spacing` makes the bound millimetres.
   */
  const lod = async (mesh: Mesh, spacing: [number, number, number]): Promise<Mesh | null> => {
    if (mesh.tris <= ORBIT_BUDGET || workerDead) return null;
    try {
      if (!lodWorker) {
        lodWorker = spawn();
        lodWorker.onerror = () => {
          lodWorker = null;
          for (const done of pendingLod.values()) done(null);
          pendingLod.clear();
        };
      }
      const id = nextId++;
      const p = new Promise<Mesh | null>((resolve) => pendingLod.set(id, resolve));
      const positions = mesh.positions.slice().buffer as ArrayBuffer, indices = mesh.indices.slice().buffer as ArrayBuffer;
      lodWorker.postMessage({ id, method: 'lod', positions, indices, spacing, budget: ORBIT_BUDGET, maxError: LOD_MAX_ERROR }, [positions, indices]);
      return await p;
    } catch {
      return null;
    }
  };

  /** Let the workers free their copies of the volume. */
  const dropVolumes = (): void => {
    for (const w of pool) w.postMessage({ method: 'drop' });
    holds.clear();
  };

  return { extract, renderVr, lod, dropVolumes, get usedWorker() { return usedWorker; }, get vrWorkers() { return vrWorkers; } };
}

export type Extractor = ReturnType<typeof createExtractor>;
