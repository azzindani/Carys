// Oblique reslice: sample the volume on an arbitrary plane with trilinear
// interpolation. The plane is (center, rowDir, colDir); out-of-bounds
// samples render black. Zero rotation reproduces the orthogonal slice.
import type { Volume, WindowLevel } from '@carys/volume-core';
import { applyWindowLevel } from '@carys/volume-core';
import type { Plane } from './mpr.js';

export type Vec3 = [number, number, number];

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Trilinear sample in voxel space; null outside the volume. */
export function sampleTrilinear(data: ArrayLike<number>, dims: [number, number, number], p: Vec3): number | null {
  const [nx, ny, nz] = dims;
  const [x, y, z] = p;
  if (x < 0 || y < 0 || z < 0 || x > nx - 1 || y > ny - 1 || z > nz - 1) return null;
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const x1 = Math.min(nx - 1, x0 + 1), y1 = Math.min(ny - 1, y0 + 1), z1 = Math.min(nz - 1, z0 + 1);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const at = (ix: number, iy: number, iz: number): number =>
    (data[iz * nx * ny + iy * nx + ix] as number);
  const c00 = at(x0, y0, z0) * (1 - fx) + at(x1, y0, z0) * fx;
  const c10 = at(x0, y1, z0) * (1 - fx) + at(x1, y1, z0) * fx;
  const c01 = at(x0, y0, z1) * (1 - fx) + at(x1, y0, z1) * fx;
  const c11 = at(x0, y1, z1) * (1 - fx) + at(x1, y1, z1) * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  return c0 * (1 - fz) + c1 * fz;
}

/**
 * Build an orthonormal basis by rotating the plane's default basis.
 * `a` pitches the normal toward +y (nod), `b` yaws it toward +x (tilt),
 * both in radians. Returns { row, col, normal } in voxel units.
 */
export function obliqueBasis(plane: Plane, a: number, b: number): { row: Vec3; col: Vec3; normal: Vec3 } {
  // default: row=+x, col=+y, normal=+z (axial frame)
  const sa = Math.sin(a), ca = Math.cos(a);
  const sb = Math.sin(b), cb = Math.cos(b);
  // normal after Ry(b) * Rx(a) applied to (0,0,1)
  const normal: Vec3 = [sb * ca, -sa, cb * ca];
  const row: Vec3 = norm([cb, 0, -sb]);
  const col: Vec3 = norm(cross(normal, row));
  if (plane === 'axial') return { row, col, normal };
  if (plane === 'coronal') {
    // default coronal: row=+x, col=+z, normal=-y. Rotate the frame rigidly:
    // permute axial basis (x,y,z) -> (x,z,-y).
    const perm = (v: Vec3): Vec3 => [v[0], v[2], -v[1]];
    return { row: norm(perm(row)), col: norm(perm(col)), normal: norm(perm(normal)) };
  }
  const perm = (v: Vec3): Vec3 => [v[2], v[1], -v[0]]; // sagittal: (x,y,z)->(z,y,-x)
  return { row: norm(perm(row)), col: norm(perm(col)), normal: norm(perm(normal)) };
}

export function resliceOblique(
  vol: Volume,
  center: Vec3,
  row: Vec3,
  col: Vec3,
  w: number,
  h: number,
  wl: WindowLevel,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const d = vol.data;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const px = center[0] + (i - w / 2) * row[0] + (j - h / 2) * col[0];
      const py = center[1] + (i - w / 2) * row[1] + (j - h / 2) * col[1];
      const pz = center[2] + (i - w / 2) * row[2] + (j - h / 2) * col[2];
      const v = sampleTrilinear(d, vol.dims, [px, py, pz]);
      const g = v == null ? 0 : applyWindowLevel(v, wl);
      const o = (j * w + i) * 4;
      out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
    }
  }
  return out;
}
