// Tiny software rasterizer: orthographic projection, per-pixel shading,
// z-buffer, backface culling. Output -> putImageData / PNG.
// Camera looks along -z; larger rotated z = nearer.
//
// Shading (F6, docs/PHASES.md): the three vertex normals are interpolated
// across each triangle and renormalized per pixel, then lit Blinn-Phong —
// the same ambient + Lambert terms the per-face shader used, plus a soft
// white highlight — so a surface reads by its curvature, not its
// triangles. The frame is drawn at twice the size and box-filtered down:
// silhouettes are anti-aliased instead of stair-stepped.
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
  /** samples per pixel along each axis: 2 (default) anti-aliases edges,
   *  1 is a quarter of the fill work for interaction */
  supersample?: 1 | 2;
}

// Light rig, view space. Ambient + diffuse match the old per-face shader.
const AMBIENT = 0.32;
const DIFFUSE = 0.68;
/** Soft highlight: weight and Blinn-Phong exponent. */
const SPECULAR = 0.22;
const SHININESS = 40;
/** Below this half-vector cosine the highlight adds under a quarter of a
 *  grey level: skipped, the power is the costliest term per pixel. */
const SPEC_CUT = (0.25 / (SPECULAR * 255)) ** (1 / SHININESS);

export function renderMesh(
  mesh: TriMesh,
  dims: [number, number, number],
  opts: RasterOpts,
): Uint8ClampedArray {
  const { width: W, height: H, angleY, tiltX, color } = opts;
  const ss = opts.supersample ?? 2;
  if (ss !== 1 && ss !== 2) throw new RangeError(`raster-supersample: ${ss}`);
  const bg = opts.bg ?? [17, 17, 17];
  const SW = W * ss, SH = H * ss;
  // colour at supersampled resolution, background everywhere at first
  const acc = new Float32Array(SW * SH * 3);
  for (let i = 0; i < SW * SH; i++) { acc[i * 3] = bg[0]!; acc[i * 3 + 1] = bg[1]!; acc[i * 3 + 2] = bg[2]!; }
  const depth = new Float32Array(SW * SH).fill(-Infinity);
  const [nx, ny, nz] = dims;
  const maxDim = Math.max(nx, ny, nz);
  const scale = (Math.min(W, H) / maxDim) * 0.92 * (opts.zoom ?? 1) * ss;
  const cy = Math.cos(angleY), sy = Math.sin(angleY);
  const cx = Math.cos(tiltX), sx = Math.sin(tiltX);
  const [ccx, ccy, ccz] = opts.center ?? [nx / 2, ny / 2, nz / 2];
  // every vertex to the screen once (voxel coords about the centre, then
  // orbit and tilt), its normal rotated with it
  const P = mesh.positions, N = mesh.normals, I = mesh.indices;
  const nv = P.length / 3;
  const X = new Float64Array(nv), Y = new Float64Array(nv), Z = new Float64Array(nv);
  const NX = new Float64Array(nv), NY = new Float64Array(nv), NZ = new Float64Array(nv);
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3]! - ccx, y = P[v * 3 + 1]! - ccy, z = P[v * 3 + 2]! - ccz;
    const z1 = -x * sy + z * cy;
    X[v] = SW / 2 + (x * cy + z * sy) * scale;
    Y[v] = SH / 2 - (y * cx - z1 * sx) * scale;
    Z[v] = y * sx + z1 * cx;
    const a = N[v * 3]!, b = N[v * 3 + 1]!, c = N[v * 3 + 2]!;
    const c1 = -a * sy + c * cy;
    NX[v] = a * cy + c * sy; NY[v] = b * cx - c1 * sx; NZ[v] = b * sx + c1 * cx;
  }
  // fixed headlight in view space; the viewer looks down −z, so the half
  // vector is between the light and +z
  const inv = 1 / Math.hypot(0.35, 0.7, 0.62);
  const Lx = 0.35 * inv, Ly = 0.7 * inv, Lz = 0.62 * inv;
  const hl = 1 / Math.hypot(Lx, Ly, Lz + 1);
  const Hx = Lx * hl, Hy = Ly * hl, Hz = (Lz + 1) * hl;
  for (let t = 0; t < I.length; t += 3) {
    const i0 = I[t]!, i1 = I[t + 1]!, i2 = I[t + 2]!;
    // backface cull only when every vertex normal faces away: a mean-normal
    // cull dropped visible silhouette triangles on wrinkled masks (pinholes)
    if (NZ[i0]! <= 0 && NZ[i1]! <= 0 && NZ[i2]! <= 0) continue;
    const x0 = X[i0]!, y0 = Y[i0]!, x1 = X[i1]!, y1 = Y[i1]!, x2 = X[i2]!, y2 = Y[i2]!;
    const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(denom) < 1e-9) continue;
    // barycentric weights as planes over the screen: w = a·x + b·y + c
    const a0 = (y1 - y2) / denom, b0 = (x2 - x1) / denom, c0 = -a0 * x2 - b0 * y2;
    const a1 = (y2 - y0) / denom, b1 = (x0 - x2) / denom, c1 = -a1 * x2 - b1 * y2;
    const z0 = Z[i0]!, z1 = Z[i1]!, z2 = Z[i2]!;
    const xa = Math.max(0, Math.floor(Math.min(x0, x1, x2))), xb = Math.min(SW - 1, Math.ceil(Math.max(x0, x1, x2)));
    const ya = Math.max(0, Math.floor(Math.min(y0, y1, y2))), yb = Math.min(SH - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = ya; y <= yb; y++) {
      // sample at the pixel centre, so 1× and 2× frames line up
      const qy = y + 0.5;
      for (let x = xa; x <= xb; x++) {
        const qx = x + 0.5;
        const w0 = a0 * qx + b0 * qy + c0, w1 = a1 * qx + b1 * qy + c1, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        const o = y * SW + x;
        if (!(z > depth[o]!)) continue;
        depth[o] = z;
        // the surface normal at this pixel
        let ex = w0 * NX[i0]! + w1 * NX[i1]! + w2 * NX[i2]!;
        let ey = w0 * NY[i0]! + w1 * NY[i1]! + w2 * NY[i2]!;
        let ez = w0 * NZ[i0]! + w1 * NZ[i1]! + w2 * NZ[i2]!;
        const l = 1 / (Math.sqrt(ex * ex + ey * ey + ez * ez) || 1);
        ex *= l; ey *= l; ez *= l;
        const d = Math.max(0, ex * Lx + ey * Ly + ez * Lz);
        const h = ex * Hx + ey * Hy + ez * Hz;
        const shade = AMBIENT + DIFFUSE * d;
        const spec = d > 0 && h > SPEC_CUT ? SPECULAR * 255 * h ** SHININESS : 0;
        acc[o * 3] = color[0] * shade + spec;
        acc[o * 3 + 1] = color[1] * shade + spec;
        acc[o * 3 + 2] = color[2] * shade + spec;
      }
    }
  }
  // box-filter the samples down to the frame
  const out = new Uint8ClampedArray(W * H * 4);
  const k = 1 / (ss * ss);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const s = ((y * ss + j) * SW + x * ss + i) * 3;
          r += Math.min(255, acc[s]!); g += Math.min(255, acc[s + 1]!); b += Math.min(255, acc[s + 2]!);
        }
      }
      const o = (y * W + x) * 4;
      out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k; out[o + 3] = 255;
    }
  }
  return out;
}
