// Shared browser loaders for the thin viewer pages (static, no build).
// Imports compiled dist/ modules by path; volume-core via import map.
import { readHeader, readImage } from '/packages/io/dist/nifti1.js';
import { parseDicomFrames } from '/packages/io/dist/dicom-parse.js';
import { sortSlices, stackToVolume } from '/packages/io/dist/dicom.js';
import { histogram, windowLevelFromRange } from '@carys/volume-core';

const ARRAYS = {
  uint8: Uint8Array, int8: Int8Array, uint16: Uint16Array, int16: Int16Array,
  uint32: Uint32Array, int32: Int32Array, float32: Float32Array, float64: Float64Array,
};

export function loadNiiBuffer(buf) {
  const h = readHeader(buf);
  const raw = new (ARRAYS[h.dtype] ?? Uint8Array)(readImage(h, buf));
  const n = h.dims[0] * h.dims[1] * h.dims[2];
  const data = new Float64Array(n);
  const useSlope = Number.isFinite(h.scl_slope) && h.scl_slope !== 0;
  for (let i = 0; i < n; i++) data[i] = useSlope ? raw[i] * h.scl_slope + h.scl_inter : raw[i];
  return { dims: h.dims, data, spacing: [h.pixDims[1], h.pixDims[2], h.pixDims[3]] };
}

export async function loadNii(url, { signal } = {}) {
  return loadNiiBuffer(await (await fetch(url, { signal })).arrayBuffer());
}

export async function loadDicomSeries(urls, { signal } = {}) {
  const parsed = [];
  for (const u of urls) {
    // multi-frame files expand in file order (stable sort keeps it downstream)
    for (const p of parseDicomFrames(await (await fetch(u, { signal })).arrayBuffer())) parsed.push(p);
  }
  const order = new Map(parsed.map((s) => [s.slice, s.meta.sliceLocation ?? s.meta.instanceNumber ?? 0]));
  const slices = sortSlices(parsed.map((s) => s.slice))
    .sort((a, b) => order.get(a) - order.get(b));
  const locs = parsed.map((s) => s.meta.sliceLocation).filter((v) => v != null).sort((a, b) => a - b);
  let zgap = parsed[0].meta.sliceThickness ?? 1;
  if (locs.length > 1) {
    const gaps = locs.slice(1).map((v, i) => Math.abs(v - locs[i]));
    gaps.sort((a, b) => a - b);
    const med = gaps[Math.floor(gaps.length / 2)];
    if (med > 0 && Number.isFinite(med)) zgap = med;
  }
  const ps = parsed[0].meta.pixelSpacing ?? [1, 1];
  const stacked = stackToVolume(slices);
  const n = stacked.dims[0] * stacked.dims[1] * stacked.dims[2];
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) data[i] = stacked.data[i];
  return { dims: stacked.dims, data, spacing: [ps[1], ps[0], zgap] };
}

export function autoWindow(data) {
  const { hist, min, max } = histogram(data, 256);
  const total = data.length;
  const at = (q) => {
    let acc = 0;
    for (let b = 0; b < hist.length; b++) {
      acc += hist[b];
      if (acc / total >= q / 100) return min + ((b + 0.5) / 256) * (max - min || 1);
    }
    return max;
  };
  return windowLevelFromRange(at(2), at(98));
}

export function toMask(data, threshold = 0) {
  const mask = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) mask[i] = data[i] > threshold ? 1 : 0;
  return mask;
}

// Worker-first mesh extraction with main-thread fallback.
// Loader fns are injected so pages don't hardcode dist paths.
export function createExtractor({ extractBoundary, surfaceNets, workerUrl = './extract.worker.js' }) {
  let worker = null, workerDead = false, nextId = 1, usedWorker = false;
  const pending = new Map();
  const getWorker = () => {
    if (worker || workerDead) return worker;
    try {
      worker = new Worker(workerUrl, { type: 'module' });
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.ok) {
          p.resolve({
            positions: new Float32Array(e.data.positions),
            normals: new Float32Array(e.data.normals),
            indices: new Uint32Array(e.data.indices),
            tris: e.data.tris,
          });
        } else p.reject(new Error(e.data.error));
      };
      worker.onerror = () => { workerDead = true; worker = null; };
    } catch {
      workerDead = true;
    }
    return worker;
  };
  async function extract(data, dims, t, smooth) {
    const w = getWorker();
    if (w) {
      try {
        const id = nextId++;
        const copy = data.slice().buffer;
        const p = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        w.postMessage({ id, method: smooth ? 'smooth' : 'blocky', dims, threshold: t, dtype: 'float64', buffer: copy }, [copy]);
        const r = await p;
        usedWorker = true;
        return r;
      } catch {
        workerDead = true;
      }
    }
    const mesh = smooth
      ? surfaceNets(data, dims[0], dims[1], dims[2], t + 0.5)
      : extractBoundary(toMask(data, t), dims[0], dims[1], dims[2]);
    usedWorker = false;
    return { ...mesh, tris: mesh.indices.length / 3 };
  }
  return { extract, get usedWorker() { return usedWorker; } };
}
