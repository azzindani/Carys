// Mesh-extraction + volume-rendering worker, bundled by Vite.
// Transfer protocol: field buffer in, mesh/RGBA buffers out, zero copies.
// A volume render names its field by `key` and sends the buffer only when
// this worker does not hold that key yet (F9): a refinement's passes and a
// pool's shares reuse one copy, and its brick ranges (render-cpu/vr.ts).
import { extractBoundary, lodChain, renderVolume, vertexNormals } from '@carys/render-cpu';
import { smoothMesh, smoothSurface } from '@carys/render-cpu';
import type { TF } from '@carys/render-cpu';

const CTORS = {
  uint8: Uint8Array, int8: Int8Array, uint16: Uint16Array, int16: Int16Array,
  uint32: Uint32Array, int32: Int32Array, float32: Float32Array, float64: Float64Array,
} as const;

type DType = keyof typeof CTORS;

interface MeshRequest {
  id: number;
  method: 'blocky' | 'smooth';
  /** 0–1 windowed-sinc strength on a smooth surface (0 = as extracted) */
  smoothing?: number;
  /** voxel size (mm): thick slices are interpolated before extraction */
  spacing?: [number, number, number];
  dims: [number, number, number];
  threshold: number;
  dtype: DType;
  buffer: ArrayBuffer;
}

interface VolumeRequest {
  id: number;
  method: 'volume';
  /** the field's identity on the main thread */
  key: number;
  dims: [number, number, number];
  dtype: DType;
  /** absent when this worker already holds `key` */
  buffer?: ArrayBuffer;
  /** this worker's share of the rows */
  rows?: { from: number; every: number };
  w: number;
  h: number;
  angleY: number;
  tiltX: number;
  zoom: number;
  tf: TF;
  step: number;
  shade: boolean;
  density: number;
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
  spacing: [number, number, number];
  alphaStep?: number;
  jitter?: { pass: number; of: number };
  cinematic?: boolean;
}

/** An orbit level of a surface (F11): decimated in mm, returned in voxels. */
interface LodRequest {
  id: number;
  method: 'lod';
  positions: ArrayBuffer;
  indices: ArrayBuffer;
  spacing: [number, number, number];
  budget: number;
  maxError: number;
}

/** Frees the held volume (the 3D view left volume mode). */
interface DropRequest {
  method: 'drop';
}

type Request = MeshRequest | VolumeRequest | DropRequest | LodRequest;

let held: { key: number; field: Float64Array } | null = null;

function toMask(data: Float64Array, threshold: number): Uint8Array {
  const mask = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) mask[i] = data[i] > threshold ? 1 : 0;
  return mask;
}

onmessage = (e: MessageEvent<Request>) => {
  const req = e.data;
  if (req.method === 'drop') { held = null; return; }
  try {
    if (req.method === 'lod') {
      const sp = req.spacing;
      const P = new Float32Array(req.positions);
      for (let i = 0; i < P.length; i++) P[i]! *= sp[i % 3]!;
      const levels = lodChain({ positions: P, normals: new Float32Array(0), indices: new Uint32Array(req.indices) }, { budget: req.budget, maxError: req.maxError });
      const last = levels[levels.length - 1];
      if (!last) { postMessage({ id: req.id, ok: true, kind: 'lod', empty: true }); return; }
      // back to voxels, normals from the voxel geometry, as extraction gives them
      const Q = last.positions;
      for (let i = 0; i < Q.length; i++) Q[i]! /= sp[i % 3]!;
      const normals = Float32Array.from(vertexNormals(Q, last.indices));
      const positions = Q.buffer as ArrayBuffer, nbuf = normals.buffer as ArrayBuffer, indices = last.indices.buffer as ArrayBuffer;
      postMessage({ id: req.id, ok: true, kind: 'lod', tris: last.indices.length / 3, positions, normals: nbuf, indices }, [positions, nbuf, indices]);
      return;
    }
    if (req.method === 'volume') {
      if (req.buffer) held = { key: req.key, field: new (CTORS[req.dtype] ?? Float64Array)(req.buffer) as Float64Array };
      else if (held?.key !== req.key) throw new Error(`vr-volume-missing: key ${req.key}`);
      const { rgba, w, h, ms } = renderVolume(
        { dims: req.dims, data: held!.field },
        {
          width: req.w, height: req.h, angleY: req.angleY, tiltX: req.tiltX,
          zoom: req.zoom, tf: req.tf, step: req.step, shade: req.shade, density: req.density,
          bounds: req.bounds, spacing: req.spacing, alphaStep: req.alphaStep, jitter: req.jitter, rows: req.rows, cinematic: req.cinematic,
        },
      );
      const buf = rgba.buffer as ArrayBuffer;
      postMessage({ id: req.id, ok: true, kind: 'volume', rgba: buf, w, h, ms }, [buf]);
      return;
    }
    const field = new (CTORS[req.dtype] ?? Float64Array)(req.buffer) as Float64Array;
    const [nx, ny, nz] = req.dims;
    // A mask arrives as bytes (extractor.ts). smoothSurface picks the path:
    // thick slices interpolated, else a mask relaxed in its cells, an image
    // placed on its own field.
    const smooth = req.method === 'smooth'
      ? smoothSurface(field, nx, ny, nz, req.spacing ?? [1, 1, 1], req.threshold, req.dtype === 'uint8')
      : null;
    const raw = smooth ? smooth.mesh : extractBoundary(toMask(field, req.threshold), nx, ny, nz);
    // cuberille vertices are per face (unwelded): only smooth surfaces filter
    const strength = req.smoothing ?? 0;
    const mesh = req.method === 'smooth' && strength > 0 ? smoothMesh(raw, { strength }) : raw;
    const positions = mesh.positions.buffer as ArrayBuffer;
    const normals = mesh.normals.buffer as ArrayBuffer;
    const indices = mesh.indices.buffer as ArrayBuffer;
    postMessage(
      { id: req.id, ok: true, kind: 'mesh', tris: mesh.indices.length / 3, factor: smooth?.factor ?? 1, positions, normals, indices },
      [positions, normals, indices],
    );
  } catch (err) {
    // the kind routes the failure to the right caller (a volume error used
    // to be read as a mesh reply and its render never settled)
    postMessage({ id: req.id, ok: false, kind: req.method === 'volume' || req.method === 'lod' ? req.method : 'mesh', error: String((err as Error)?.message ?? err) });
  }
};
