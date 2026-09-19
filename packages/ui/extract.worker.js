// Real Web Worker for mesh extraction. Field buffer is transferred in,
// mesh buffers transferred out — no copies on the round trip.
// Protocol: {id, method:'blocky'|'smooth', dims, threshold, dtype, buffer}
//  -> {id, ok, tris, positions, normals, indices} | {id, ok:false, error}
import { extractBoundary } from '/packages/render-cpu/dist/surface.js';
import { surfaceNets } from '/packages/render-cpu/dist/surface-nets.js';

const CTORS = {
  uint8: Uint8Array, int8: Int8Array, uint16: Uint16Array, int16: Int16Array,
  uint32: Uint32Array, int32: Int32Array, float32: Float32Array, float64: Float64Array,
};

function toMask(data, threshold) {
  const mask = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) mask[i] = data[i] > threshold ? 1 : 0;
  return mask;
}

onmessage = (e) => {
  const { id, method, dims, threshold, dtype, buffer } = e.data;
  try {
    const field = new (CTORS[dtype] ?? Float64Array)(buffer);
    const [nx, ny, nz] = dims;
    const mesh = method === 'smooth'
      ? surfaceNets(field, nx, ny, nz, threshold + 0.5)
      : extractBoundary(toMask(field, threshold), nx, ny, nz);
    postMessage({
      id, ok: true,
      tris: mesh.indices.length / 3,
      positions: mesh.positions.buffer,
      normals: mesh.normals.buffer,
      indices: mesh.indices.buffer,
    }, [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer]);
  } catch (err) {
    postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
