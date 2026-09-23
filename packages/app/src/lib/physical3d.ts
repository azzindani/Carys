// The 3D view in millimetres.
//
// Extraction, fibres and the 3D cursor all work in voxel indices, and the
// rasterizer fits whatever box it is given — so a 5 mm-slice chest CT was
// drawn with its slices 0.94 mm apart, a surface squashed to a fifth of its
// height. The fix sits here, between the voxel-space engine and the screen:
// positions scale by the voxel spacing, normals by its inverse (normals
// transform by the inverse transpose, or shading tilts on anisotropic
// grids), and the fitting box is the volume's extent in mm. The engine's
// golden-hashed math is untouched; an isotropic volume passes straight
// through.
import type { Mesh } from './types';

type V3 = [number, number, number];

const isUnit = (sp: V3): boolean => sp[0] === 1 && sp[1] === 1 && sp[2] === 1;
const meshCache = new WeakMap<Mesh, { key: string; mesh: Mesh }>();
const ptsCache = new WeakMap<Float32Array, { key: string; pts: Float32Array }>();

/** The mesh with positions in mm (cached per mesh + spacing). */
export function physicalMesh(mesh: Mesh, sp: V3): Mesh {
  if (isUnit(sp)) return mesh;
  const key = sp.join();
  const hit = meshCache.get(mesh);
  if (hit && hit.key === key) return hit.mesh;
  const P = mesh.positions, N = mesh.normals;
  const positions = new Float32Array(P.length);
  const normals = new Float32Array(N.length);
  for (let i = 0; i < P.length; i += 3) {
    positions[i] = P[i]! * sp[0]; positions[i + 1] = P[i + 1]! * sp[1]; positions[i + 2] = P[i + 2]! * sp[2];
    const nx = N[i]! / sp[0], ny = N[i + 1]! / sp[1], nz = N[i + 2]! / sp[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[i] = nx / l; normals[i + 1] = ny / l; normals[i + 2] = nz / l;
  }
  const out: Mesh = { positions, normals, indices: mesh.indices, tris: mesh.tris };
  meshCache.set(mesh, { key, mesh: out });
  return out;
}

/** Streamline points in mm (cached per array + spacing). */
export function physicalPoints(pts: Float32Array, sp: V3): Float32Array {
  if (isUnit(sp)) return pts;
  const key = sp.join();
  const hit = ptsCache.get(pts);
  if (hit && hit.key === key) return hit.pts;
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 3) {
    out[i] = pts[i]! * sp[0]; out[i + 1] = pts[i + 1]! * sp[1]; out[i + 2] = pts[i + 2]! * sp[2];
  }
  ptsCache.set(pts, { key, pts: out });
  return out;
}

/** A voxel-space point (or box extent) in mm. */
export function toMm(p: V3, sp: V3): V3 {
  return [p[0] * sp[0], p[1] * sp[1], p[2] * sp[2]];
}

/**
 * Inclusive voxel box of a mask's set voxels, visiting every `stride`-th
 * voxel (a cheap estimate on big grids — the 3D view only frames with it).
 * Null when no visited voxel is set.
 */
export function maskBox(mask: ArrayLike<number>, dims: V3, stride = 1): { min: V3; max: V3 } | null {
  const [nx, ny] = dims;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -1, y1 = -1, z1 = -1;
  for (let i = 0; i < mask.length; i += stride) {
    if (!mask[i]) continue;
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return x1 < 0 ? null : { min: [x0, y0, z0], max: [x1, y1, z1] };
}

/** The volume render's ray bounds for a mask, voxels: its box (sampled
 *  every other voxel) padded so no sample near the edge is cut. Shared by
 *  the render and the pick, so both march the same rays. */
export function vrBounds(mask: ArrayLike<number>, dims: V3): { min: V3; max: V3 } | null {
  const box = maskBox(mask, dims, 2);
  if (!box) return null;
  return {
    min: [Math.max(0, box.min[0] - 2), Math.max(0, box.min[1] - 2), Math.max(0, box.min[2] - 2)],
    max: [Math.min(dims[0], box.max[0] + 3), Math.min(dims[1], box.max[1] + 3), Math.min(dims[2], box.max[2] + 3)],
  };
}

/** A mask as the volume render's field: every label inside, 1 (a label
 *  map keeps its labels for the panes, F14; the 3D shows the whole mask). */
export function maskField(mask: Uint8Array): Float64Array {
  return Float64Array.from(mask, (v) => (v > 0 ? 1 : 0));
}
