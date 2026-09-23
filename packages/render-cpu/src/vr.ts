// CPU volume raycaster: orthographic front-to-back compositing with
// gradient shading, early termination, and AABB-bounded marching.
// Same orbit/tilt convention as the mesh rasterizer (raster.ts).
import { sampleTrilinear, type Vec3 } from './oblique.js';
import { sampleTF, type TF } from './tf.js';

export interface VrVolume {
  dims: [number, number, number];
  data: Float64Array;
}

export interface VrOpts {
  width: number;
  height: number;
  angleY: number;
  tiltX: number;
  zoom?: number;
  bg?: [number, number, number];
  tf: TF;
  /** ray step in voxels of the finest axis (draft 3, full ~1.5) */
  step?: number;
  /** voxel size in mm (x, y, z). Rays march and the frame fits in mm, so a
   *  5 mm-slice CT is not drawn a fifth of its height. Default: 1 mm cubes. */
  spacing?: Vec3;
  /** gradient shading on/off */
  shade?: boolean;
  /** global opacity multiplier */
  density?: number;
  /** field selector: image values or mask-as-field */
  field?: Float64Array | null;
  /** tight voxel-space bounds (padded by caller): rays march only inside */
  bounds?: { min: Vec3; max: Vec3 } | null;
}

/** Slab-method ray/AABB intersect. Returns [tEnter, tExit] or null. */
export function intersectAABB(o: Vec3, d: Vec3, min: Vec3, max: Vec3): [number, number] | null {
  let t0 = -Infinity, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    const oi = o[i]!, di = d[i]!;
    if (Math.abs(di) < 1e-12) {
      if (oi < min[i]! || oi > max[i]!) return null;
    } else {
      let a = (min[i]! - oi) / di;
      let b = (max[i]! - oi) / di;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return null;
    }
  }
  return [t0, t1];
}

function invRot(angleY: number, tiltX: number, vx: number, vy: number, vz: number): Vec3 {
  // inverse of Ry(angleY) then Rx(tiltX): Rx(-tiltX) then Ry(-angleY)
  const cx = Math.cos(-tiltX), sx = Math.sin(-tiltX);
  const y1 = vy * cx - vz * sx;
  const z1 = vy * sx + vz * cx;
  const cy = Math.cos(-angleY), sy = Math.sin(-angleY);
  return [vx * cy + z1 * sy, y1, -vx * sy + z1 * cy];
}

export function renderVolume(vol: VrVolume, opts: VrOpts): { rgba: Uint8ClampedArray; w: number; h: number; ms: number } {
  const t0 = Date.now();
  const { dims, data } = vol;
  const [nx, ny, nz] = dims;
  const W = opts.width, H = opts.height;
  const bg = opts.bg ?? [17, 17, 17];
  const sp = opts.spacing ?? [1, 1, 1];
  if (!(sp[0] > 0 && sp[1] > 0 && sp[2] > 0)) throw new RangeError(`vr-spacing: ${sp.join(',')}`);
  // Rays live in mm and go back to voxel coordinates only to sample (and the
  // gradient comes out per mm). With the default spacing every conversion is
  // a multiply by exactly 1, so the voxel-space renders stay bit-identical.
  const toVox: Vec3 = [1 / sp[0], 1 / sp[1], 1 / sp[2]];
  const minSp = Math.min(sp[0], sp[1], sp[2]);
  const ext: Vec3 = [nx * sp[0], ny * sp[1], nz * sp[2]];
  const step = (opts.step ?? 2) * minSp;
  const shade = opts.shade ?? true;
  const density = opts.density ?? 1;
  const field = opts.field ?? data;
  const maxDim = Math.max(ext[0], ext[1], ext[2]);
  const scale = (Math.min(W, H) / maxDim) * 0.92 * (opts.zoom ?? 1);
  const R = Math.hypot(ext[0], ext[1], ext[2]) / 2 + minSp;
  // view-space headlight, fixed (matches raster.ts)
  const inv = 1 / Math.hypot(0.35, 0.7, 0.62);
  const light: Vec3 = [0.35 * inv, 0.7 * inv, 0.62 * inv];

  const out = new Uint8ClampedArray(W * H * 4);
  // Orthographic march direction in mm (constant for the frame): view
  // (0,0,-1) pushed through the inverse view rotation, normalized.
  const rawDir = invRot(opts.angleY, opts.tiltX, 0, 0, -1);
  const dl = Math.hypot(rawDir[0], rawDir[1], rawDir[2]) || 1;
  const marchDir: Vec3 = [rawDir[0] / dl, rawDir[1] / dl, rawDir[2] / dl];
  const center: Vec3 = [ext[0] / 2, ext[1] / 2, ext[2] / 2];
  // callers pass bounds in voxels; the rays clip against them in mm
  const bounds = opts.bounds
    ? {
      min: [opts.bounds.min[0] * sp[0], opts.bounds.min[1] * sp[1], opts.bounds.min[2] * sp[2]] as Vec3,
      max: [opts.bounds.max[0] * sp[0], opts.bounds.max[1] * sp[1], opts.bounds.max[2] * sp[2]] as Vec3,
    }
    : null;

  const grad = (x: number, y: number, z: number): Vec3 => {
    // central differences in voxel space, per mm (the gradient scales by the
    // inverse spacing, or shading tilts on anisotropic grids)
    const gx = (sampleTrilinear(field, dims, [x + 1, y, z]) ?? 0) - (sampleTrilinear(field, dims, [x - 1, y, z]) ?? 0);
    const gy = (sampleTrilinear(field, dims, [x, y + 1, z]) ?? 0) - (sampleTrilinear(field, dims, [x, y - 1, z]) ?? 0);
    const gz = (sampleTrilinear(field, dims, [x, y, z + 1]) ?? 0) - (sampleTrilinear(field, dims, [x, y, z - 1]) ?? 0);
    return [gx * toVox[0], gy * toVox[1], gz * toVox[2]];
  };

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const vx = (px - W / 2) / scale;
      const vy = -(py - H / 2) / scale;
      // ray origin on the view plane, in mm about the volume centre
      const vc = invRot(opts.angleY, opts.tiltX, vx, vy, 0);
      const org: Vec3 = [vc[0] + center[0], vc[1] + center[1], vc[2] + center[2]];
      let t0 = -R, t1 = R;
      if (bounds) {
        const hit = intersectAABB(org, marchDir, bounds.min, bounds.max);
        if (!hit) {
          // ray misses the region of interest: solid background, not blank
          const o = (py * W + px) * 4;
          out[o] = bg[0]!; out[o + 1] = bg[1]!; out[o + 2] = bg[2]!; out[o + 3] = 255;
          continue;
        }
        t0 = Math.max(t0, hit[0]);
        t1 = Math.min(t1, hit[1]);
        // Phase-lock to the unbounded lattice so bounded and unbounded
        // renders sample identical positions (bit-exact, not just close).
        t0 = -R + Math.ceil((t0 + R) / step) * step;
      }
      let r = 0, g = 0, b = 0, a = 0;
      for (let t = t0; t <= t1 && a < 0.995; t += step) {
        const x = (org[0] + marchDir[0] * t) * toVox[0];
        const y = (org[1] + marchDir[1] * t) * toVox[1];
        const z = (org[2] + marchDir[2] * t) * toVox[2];
        const v = sampleTrilinear(field, dims, [x, y, z]);
        if (v == null) continue;
        const s = sampleTF(opts.tf, v);
        const alpha = Math.min(1, s.a * density);
        if (alpha <= 0.003) continue;
        let sh = 1;
        if (shade) {
          const gr = grad(x, y, z);
          const l = Math.hypot(gr[0], gr[1], gr[2]);
          if (l > 1e-9) {
            // gradient to view space (rotation only): reuse forward rotation
            const cy = Math.cos(opts.angleY), sy = Math.sin(opts.angleY);
            const cxx = Math.cos(opts.tiltX), sxx = Math.sin(opts.tiltX);
            const x1 = gr[0] * cy + gr[2] * sy;
            const z1 = -gr[0] * sy + gr[2] * cy;
            const gv: Vec3 = [x1, gr[1] * cxx - z1 * sxx, gr[1] * sxx + z1 * cxx];
            const d = (gv[0] * light[0] + gv[1] * light[1] + gv[2] * light[2]) / l;
            sh = 0.35 + 0.65 * Math.max(0, -d);
          }
        }
        r += (1 - a) * alpha * s.r * sh;
        g += (1 - a) * alpha * s.g * sh;
        b += (1 - a) * alpha * s.b * sh;
        a += (1 - a) * alpha;
      }
      const o = (py * W + px) * 4;
      out[o] = Math.min(255, r + bg[0] * (1 - a));
      out[o + 1] = Math.min(255, g + bg[1] * (1 - a));
      out[o + 2] = Math.min(255, b + bg[2] * (1 - a));
      out[o + 3] = 255;
    }
  }
  return { rgba: out, w: W, h: H, ms: Date.now() - t0 };
}
