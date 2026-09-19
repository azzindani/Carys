// Tiny software rasterizer: orthographic projection, per-face Lambert
// shading, z-buffer, backface culling. Output -> putImageData / PNG.
// Camera looks along -z; larger rotated z = nearer.
import type { TriMesh } from './surface.js';

export interface RasterOpts {
  width: number;
  height: number;
  angleY: number; // orbit radians
  tiltX: number; // tilt radians
  color: [number, number, number];
  bg?: [number, number, number];
  zoom?: number; // view multiplier, default 1
  /** rotation center in voxel coords; default = volume center. Pointing it
   *  at a mask bbox center fills the frame with small segmentations. */
  center?: [number, number, number];
}

export function renderMesh(
  mesh: TriMesh,
  dims: [number, number, number],
  opts: RasterOpts,
): Uint8ClampedArray {
  const { width: W, height: H, angleY, tiltX, color } = opts;
  const bg = opts.bg ?? [17, 17, 17];
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = bg[0]!; out[i * 4 + 1] = bg[1]!; out[i * 4 + 2] = bg[2]!; out[i * 4 + 3] = 255;
  }
  const depth = new Float32Array(W * H).fill(-Infinity);
  const [nx, ny, nz] = dims;
  const maxDim = Math.max(nx, ny, nz);
  const scale = (Math.min(W, H) / maxDim) * 0.92 * (opts.zoom ?? 1);
  const cy = Math.cos(angleY), sy = Math.sin(angleY);
  const cx = Math.cos(tiltX), sx = Math.sin(tiltX);
  // rotate point (voxel coords, centered)
  const [ccx, ccy, ccz] = opts.center ?? [nx / 2, ny / 2, nz / 2];
  const rot = (x: number, y: number, z: number): [number, number, number] => {
    x -= ccx; y -= ccy; z -= ccz;
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const y1 = y * cx - z1 * sx;
    const z2 = y * sx + z1 * cx;
    return [x1, y1, z2];
  };
  // fixed headlight in view space
  const inv = 1 / Math.hypot(0.35, 0.7, 0.62);
  const light: [number, number, number] = [0.35 * inv, 0.7 * inv, 0.62 * inv];
  const P = mesh.positions, N = mesh.normals, I = mesh.indices;
  const px = new Float64Array(3), py = new Float64Array(3), pz = new Float64Array(3);
  for (let t = 0; t < I.length; t += 3) {
    // rotate normal (rotation only, no translation)
    const nv = (k: number): [number, number, number] => {
      const x = N[I[t + k]! * 3]!, y = N[I[t + k]! * 3 + 1]!, z = N[I[t + k]! * 3 + 2]!;
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      return [x1, y * cx - z1 * sx, y * sx + z1 * cx];
    };
    const n0 = nv(0);
    if (n0[2] <= 0) continue; // backface cull
    const shade = 0.32 + 0.68 * Math.max(0, n0[0] * light[0] + n0[1] * light[1] + n0[2] * light[2]);
    const r = Math.min(255, color[0] * shade) | 0;
    const g = Math.min(255, color[1] * shade) | 0;
    const b = Math.min(255, color[2] * shade) | 0;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = I[t + k]! * 3;
      const [rx, ry, rz] = rot(P[v]!, P[v + 1]!, P[v + 2]!);
      px[k] = W / 2 + rx * scale;
      py[k] = H / 2 - ry * scale;
      pz[k] = rz;
      if (px[k]! < x0) x0 = px[k]!;
      if (px[k]! > x1) x1 = px[k]!;
      if (py[k]! < y0) y0 = py[k]!;
      if (py[k]! > y1) y1 = py[k]!;
    }
    const denom = (py[1]! - py[2]!) * (px[0]! - px[2]!) + (px[2]! - px[1]!) * (py[0]! - py[2]!);
    if (Math.abs(denom) < 1e-9) continue;
    const xa = Math.max(0, Math.floor(x0)), xb = Math.min(W - 1, Math.ceil(x1));
    const ya = Math.max(0, Math.floor(y0)), yb = Math.min(H - 1, Math.ceil(y1));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const w1 = ((py[1]! - py[2]!) * (x - px[2]!) + (px[2]! - px[1]!) * (y - py[2]!)) / denom;
        const w2 = ((py[2]! - py[0]!) * (x - px[2]!) + (px[0]! - px[2]!) * (y - py[2]!)) / denom;
        const w0 = 1 - w1 - w2;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * pz[0]! + w1 * pz[1]! + w2 * pz[2]!;
        const o = y * W + x;
        if (z > depth[o]!) {
          depth[o] = z;
          out[o * 4] = r; out[o * 4 + 1] = g; out[o * 4 + 2] = b;
        }
      }
    }
  }
  return out;
}
