// Mesh-extraction + volume-rendering worker, bundled by Vite.
// Transfer protocol: field buffer in, mesh/RGBA buffers out, zero copies.
import { extractBoundary, renderVolume } from '@carys/render-cpu';
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
  dims: [number, number, number];
  dtype: DType;
  buffer: ArrayBuffer;
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
}

type Request = MeshRequest | VolumeRequest;

function toMask(data: Float64Array, threshold: number): Uint8Array {
  const mask = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) mask[i] = data[i] > threshold ? 1 : 0;
  return mask;
}

onmessage = (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    const field = new (CTORS[req.dtype] ?? Float64Array)(req.buffer) as Float64Array;
    if (req.method === 'volume') {
      const { rgba, w, h, ms } = renderVolume(
        { dims: req.dims, data: field },
        {
          width: req.w, height: req.h, angleY: req.angleY, tiltX: req.tiltX,
          zoom: req.zoom, tf: req.tf, step: req.step, shade: req.shade, density: req.density,
          bounds: req.bounds, spacing: req.spacing,
        },
      );
      const buf = rgba.buffer as ArrayBuffer;
      postMessage({ id: req.id, ok: true, kind: 'volume', rgba: buf, w, h, ms }, [buf]);
      return;
    }
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
    postMessage({ id: req.id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
