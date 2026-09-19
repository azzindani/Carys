// Parse client: file uploads decode in the parse worker, main-thread
// loaders stay as the fallback. Same id-routed contract as the extractor
// (single worker, pending map, transferable input, workerDead latch).
import { loadNiiBuffer, loadNrrdBuffer, loadOmeTiffBuffer } from './loaders';
import type { Volume } from './types';

interface Pending {
  resolve: (v: Volume) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let workerDead = false;
let nextId = 1;
const pending = new Map<number, Pending>();

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
        });
      } else p.reject(new Error(e.data.error));
    };
    worker.onerror = () => { workerDead = true; worker = null; };
  } catch {
    workerDead = true;
  }
  return worker;
}

/**
 * Decode upload bytes to a display Volume: worker first, main-thread
 * loaders on worker failure (same sniff order both sides).
 */
export async function parseUpload(buf: ArrayBuffer, name: string): Promise<Volume> {
  const w = getWorker();
  if (w) {
    try {
      const id = nextId++;
      const p = new Promise<Volume>((resolve, reject) => pending.set(id, { resolve, reject }));
      w.postMessage({ id, buffer: buf, name });
      return await p;
    } catch {
      workerDead = true;
    }
  }
  // fallback mirrors the worker's sniff order (nrrd → tiff → nifti)
  const { isNrrdLike, isTiffLike } = await import('@carys/io');
  const bytes = new Uint8Array(buf);
  if (isNrrdLike(bytes)) return loadNrrdBuffer(buf);
  if (isTiffLike(bytes)) return loadOmeTiffBuffer(buf);
  return loadNiiBuffer(buf);
}

/** Test hook: is the parse worker alive (or latched dead)? */
export function parseWorkerState(): 'alive' | 'dead' | 'idle' {
  if (workerDead) return 'dead';
  return worker ? 'alive' : 'idle';
}
