// Parse client: file uploads decode in the parse worker, main-thread
// loaders stay as the fallback. Same id-routed contract as the extractor
// (single worker, pending map, transferable input, workerDead latch).
import { isNrrdLike, isTiffLike } from '@carys/io';
import { fetchSample, loadNiiBuffer } from './loaders';
import type { Volume } from './types';

interface Pending {
  resolve: (v: Volume) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let workerDead = false;
let nextId = 1;
const pending = new Map<number, Pending>();

/** The worker itself died (load failure, crash) — not a verdict on the bytes. */
class WorkerDown extends Error {}

function getWorker(): Worker | null {
  if (worker || workerDead) return worker;
  try {
    worker = new Worker(new URL('../workers/parse.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) {
        p.resolve({
          dims: e.data.dims,
          spacing: e.data.spacing,
          data: new Float64Array(e.data.data),
          ...(e.data.geometry ? { geometry: e.data.geometry, source: e.data.source } : {}),
        });
      } else p.reject(new Error(e.data.error));
    };
    // A dead worker answers nothing: fail every request in flight so its
    // caller falls back, instead of awaiting a reply that never comes.
    worker.onerror = () => {
      workerDead = true;
      worker = null;
      for (const p of pending.values()) p.reject(new WorkerDown('parse worker died'));
      pending.clear();
    };
  } catch {
    workerDead = true;
  }
  return worker;
}

/**
 * Decode upload bytes to a display Volume: worker first, main-thread
 * loaders when the worker is unavailable (same sniff order both sides).
 * A file the decoder rejects is reported as that rejection: it used to latch
 * the worker off for the session, so one bad upload moved every later decode
 * onto the main thread.
 */
export async function parseUpload(buf: ArrayBuffer, name: string): Promise<Volume> {
  const w = getWorker();
  if (w) {
    try {
      const id = nextId++;
      const p = new Promise<Volume>((resolve, reject) => pending.set(id, { resolve, reject }));
      w.postMessage({ id, buffer: buf, name });
      return await p;
    } catch (e) {
      if (!(e instanceof WorkerDown)) throw e;
    }
  }
  // fallback mirrors the worker's sniff order (nrrd → tiff → nifti)
  const bytes = new Uint8Array(buf);
  if (isNrrdLike(bytes)) return (await import('./formatLoaders')).loadNrrdBuffer(buf);
  if (isTiffLike(bytes)) return (await import('./formatLoaders')).loadOmeTiffBuffer(buf);
  return loadNiiBuffer(buf);
}

/**
 * A catalog volume, fetched here and decoded in the parse worker. Decoding a
 * 9M-voxel NIfTI (plus its re-layout) on the main thread froze the viewer
 * for most of a second on every series open, the same way an upload would
 * have if uploads had not already gone through the worker.
 */
export async function loadVolumeUrl(url: string, opts: { signal?: AbortSignal } = {}): Promise<Volume> {
  return parseUpload(await fetchSample(url, opts.signal), url.split('/').pop() ?? url);
}

/** Test hook: is the parse worker alive (or latched dead)? */
export function parseWorkerState(): 'alive' | 'dead' | 'idle' {
  if (workerDead) return 'dead';
  return worker ? 'alive' : 'idle';
}
