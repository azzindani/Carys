// CPU volume raycaster: orthographic front-to-back compositing with
// gradient shading, early termination, and AABB-bounded marching.
// Same orbit/tilt convention as the mesh rasterizer (raster.ts).
//
// Quality, both opt-in so a plain call renders as it
// always did:
// - `alphaStep` corrects each sample's opacity for the step it stands
//   for, α' = 1 − (1 − α)^(step / alphaStep), so a coarse draft is as
//   opaque as a fine render.
// - `jitter` makes a frame one pass of a progressive refinement. Rays that
//   all start on one lattice slice a surface into wood-grain rings; each
//   pass instead starts every ray at a stratified fraction of a step,
//   scrambled per pixel by an integer hash (interleaved gradient noise was
//   tried: it leaves a diagonal hatch without temporal blur), and moves it
//   to its cell of a g×g grid inside the pixel. The mean of the passes
//   (`addPass`) is a finer step with anti-aliased edges.
//
// Speed (F9), with every pixel unchanged: the TF is sorted once per frame
// (it was sorted per sample), sampling allocates nothing, and empty space
// is skipped by min/max bricks: a brick whose value range cannot reach the
// opacity the compositor would keep is passed over without sampling. The
// ray still steps through it one step at a time, so every sample it does
// take sits where it always did. `rows` renders an interleaved share of
// the rows, for a pool of workers.
//
// Cinematic lighting (F10, opt-in): soft shadows and ambient light from a
// coarse extinction grid, one light and two sky directions per pass
// (vr-light.ts); the passes of a refinement accumulate them.
import type { Vec3 } from './oblique.js';
import { maxOpacity, sampleSortedTF, sortTF, type TF } from './tf.js';
import { cachedExtinction, cellAt, passLight, SKY_PER_PASS, type PassLight } from './vr-light.js';
import { clipRay, scaleClip, type Clip } from './clip.js';

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
  /** the step (voxels of the finest axis) the TF's opacity is defined for;
   *  default: the step itself, no correction */
  alphaStep?: number;
  /** pass `pass` of `of` (a square: 1, 4, 9 …) of a progressive refinement */
  jitter?: { pass: number; of: number };
  /** skip empty bricks (default on; off exists to prove it changes nothing) */
  skipEmpty?: boolean;
  /** render rows from, from + every, …; the rest stay zero */
  rows?: { from: number; every: number };
  /** soft shadows + ambient light, this pass's share (`jitter`) */
  cinematic?: boolean;
  /** keep only this region, voxels like `bounds` (F13); a cut shows the
   *  volume's inside, and cinematic light passes where it was cut away */
  clip?: Clip;
}

/** Cinematic shading: a small fill no shadow reaches, the sky (ambient,
 *  occluded) and the key light (shadowed). An open surface facing the key
 *  light gets 1.22, as bright as the plain headlight's 1.0 plus the sky. */
const CIN_FILL = 0.12;
const CIN_AMBIENT = 0.5;
const CIN_DIFFUSE = 0.6;

/**
 * One frame from the shares of `rows`-split renders: row y comes from
 * part y mod parts.length. Throws `vr-merge` on parts of the wrong size.
 */
export function mergeRows(parts: Uint8ClampedArray[], width: number, height: number): Uint8ClampedArray {
  const n = parts.length, rowBytes = width * 4;
  if (n === 0 || parts.some((p) => p.length !== rowBytes * height)) throw new RangeError(`vr-merge: ${n} parts for ${width}×${height}`);
  if (n === 1) return parts[0]!;
  const out = new Uint8ClampedArray(rowBytes * height);
  for (let y = 0; y < height; y++) out.set(parts[y % n]!.subarray(y * rowBytes, (y + 1) * rowBytes), y * rowBytes);
  return out;
}

/** Brick edge for empty-space skipping, as a shift: 8 voxels. */
const BRICK_SHIFT = 3;
const BRICK = 1 << BRICK_SHIFT;
/** Samples at or below this opacity are not composited. */
const MIN_ALPHA = 0.003;

/** Value range of each brick, over the voxels a trilinear sample inside it
 *  reads: the brick plus a one-voxel apron on its far faces. */
export interface BrickRanges {
  dims: [number, number, number];
  counts: [number, number, number];
  lo: Float64Array;
  hi: Float64Array;
}

const brickCache = new WeakMap<object, BrickRanges>();

/** Brick ranges of a field, cached per array (fields are not edited in
 *  place; an edited mask arrives as a new array). NaN anywhere in a brick
 *  makes its range NaN, which no TF test rules out. */
export function brickRanges(field: ArrayLike<number>, dims: [number, number, number]): BrickRanges {
  const hit = brickCache.get(field as object);
  if (hit && hit.dims[0] === dims[0] && hit.dims[1] === dims[1] && hit.dims[2] === dims[2]) return hit;
  const [nx, ny, nz] = dims;
  const bx = Math.ceil(nx / BRICK), by = Math.ceil(ny / BRICK), bz = Math.ceil(nz / BRICK);
  const lo = new Float64Array(bx * by * bz), hi = new Float64Array(bx * by * bz);
  for (let k = 0; k < bz; k++) {
    for (let j = 0; j < by; j++) {
      for (let i = 0; i < bx; i++) {
        let mn = Infinity, mx = -Infinity, nan = false;
        for (let z = k * BRICK; z <= Math.min(nz - 1, (k + 1) * BRICK); z++) {
          for (let y = j * BRICK; y <= Math.min(ny - 1, (j + 1) * BRICK); y++) {
            const row = (z * ny + y) * nx;
            for (let x = i * BRICK; x <= Math.min(nx - 1, (i + 1) * BRICK); x++) {
              const v = field[row + x]!;
              if (v < mn) mn = v;
              if (v > mx) mx = v;
              if (v !== v) nan = true;
            }
          }
        }
        const b = (k * by + j) * bx + i;
        lo[b] = nan ? NaN : mn; hi[b] = nan ? NaN : mx;
      }
    }
  }
  const r: BrickRanges = { dims: [nx, ny, nz], counts: [bx, by, bz], lo, hi };
  brickCache.set(field as object, r);
  return r;
}

/** Per-pixel scramble in [0, 1): the murmur3 finalizer over the pixel. */
function scramble(x: number, y: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Running mean of refinement passes: adds pass number `n` (1-based) to
 * `sum` and returns the averaged frame. Throws `vr-pass-size` when the
 * pass does not match the sum.
 */
export function addPass(sum: Float32Array, rgba: Uint8ClampedArray, n: number): Uint8ClampedArray {
  if (sum.length !== rgba.length || !(n >= 1)) throw new RangeError(`vr-pass-size: ${rgba.length} into ${sum.length}, pass ${n}`);
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i++) { sum[i] += rgba[i]!; out[i] = sum[i]! / n; }
  return out;
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

/**
 * Light at a sample under this pass's lights. With a gradient (per mm,
 * world axes) the outward normal is −gradient: the key light is Lambert
 * times its transmittance, the sky a cosine-weighted estimate over the
 * pass's directions (4/K Σ max(0, n·ω) T is unbiased for the hemisphere).
 * Without one, half the key light and the plain mean of the sky. Each
 * light is read one cell toward its source: at the sample itself the
 * coarse grid would mix in the cells behind a lit surface (shadow acne).
 */
function cinematicShade(c: PassLight, toVox: Vec3, x: number, y: number, z: number, g: Vec3 | null): number {
  const bias = Math.max(c.grid.cell[0], c.grid.cell[1], c.grid.cell[2]);
  const read = (T: Float32Array, d: Vec3): number =>
    cellAt(c.grid, T, x + d[0] * bias * toVox[0], y + d[1] * bias * toVox[1], z + d[2] * bias * toVox[2]);
  const S = read(c.shadow, c.light);
  const l = g ? Math.hypot(g[0], g[1], g[2]) : 0;
  let key = 0.5, sky = 0;
  if (g && l > 1e-9) {
    const nx = -g[0] / l, ny = -g[1] / l, nz = -g[2] / l;
    key = Math.max(0, nx * c.light[0] + ny * c.light[1] + nz * c.light[2]);
    for (let k = 0; k < c.sky.length; k++) {
      const w = c.sky[k]!;
      const cos = nx * w[0] + ny * w[1] + nz * w[2];
      if (cos > 0) sky += cos * read(c.skyT[k]!, w);
    }
    sky = Math.min(1, (4 / SKY_PER_PASS) * sky);
  } else {
    for (let k = 0; k < c.sky.length; k++) sky += read(c.skyT[k]!, c.sky[k]!);
    sky /= c.sky.length;
  }
  return CIN_FILL + CIN_AMBIENT * sky + CIN_DIFFUSE * key * S;
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
  if (opts.alphaStep !== undefined && !(opts.alphaStep > 0)) throw new RangeError(`vr-alpha-step: ${opts.alphaStep}`);
  // exponent 1 skips the correction: 1 − (1 − α) is not α in floating point
  const alphaK = opts.alphaStep === undefined ? 1 : (opts.step ?? 2) / opts.alphaStep;
  const jit = opts.jitter ?? null;
  const grid = jit ? Math.round(Math.sqrt(jit.of)) : 1;
  if (jit && !(Number.isInteger(jit.pass) && grid >= 1 && grid * grid === jit.of && jit.pass >= 0 && jit.pass < jit.of)) {
    throw new RangeError(`vr-jitter: pass ${jit.pass} of ${jit.of}`);
  }
  // this pass's cell inside the pixel (0 = the pixel corner, as before)
  const subX = jit ? ((jit.pass % grid) + 0.5) / grid : 0;
  const subY = jit ? (Math.floor(jit.pass / grid) + 0.5) / grid : 0;
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

  // the frame's TF, sorted once, and which bricks it leaves empty
  const stops = sortTF(opts.tf);
  const opacityOf = (a0: number): number => {
    let al = Math.min(1, a0 * density);
    if (alphaK !== 1) al = 1 - (1 - al) ** alphaK;
    return al;
  };
  let empty: Uint8Array | null = null;
  let bnx = 0, bnxy = 0;
  if (opts.skipEmpty ?? true) {
    const br = brickRanges(field, dims);
    bnx = br.counts[0]; bnxy = br.counts[0] * br.counts[1];
    empty = new Uint8Array(br.lo.length);
    // a hair under the cut, so rounding at a stop never skips a kept sample
    for (let i = 0; i < empty.length; i++) empty[i] = opacityOf(maxOpacity(stops, br.lo[i]!, br.hi[i]!)) <= MIN_ALPHA - 1e-9 ? 1 : 0;
  }
  const nxy = nx * ny, nx1 = nx - 1, ny1 = ny - 1, nz1 = nz - 1;
  /** Trilinear sample of a point inside the grid (sampleTrilinear's
   *  arithmetic, without the allocation). */
  const tri = (x: number, y: number, z: number, x0: number, y0: number, z0: number): number => {
    const x1 = Math.min(nx1, x0 + 1), y1 = Math.min(ny1, y0 + 1), z1 = Math.min(nz1, z0 + 1);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    const r00 = z0 * nxy + y0 * nx, r10 = z0 * nxy + y1 * nx, r01 = z1 * nxy + y0 * nx, r11 = z1 * nxy + y1 * nx;
    const c00 = field[r00 + x0]! * (1 - fx) + field[r00 + x1]! * fx;
    const c10 = field[r10 + x0]! * (1 - fx) + field[r10 + x1]! * fx;
    const c01 = field[r01 + x0]! * (1 - fx) + field[r01 + x1]! * fx;
    const c11 = field[r11 + x0]! * (1 - fx) + field[r11 + x1]! * fx;
    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;
    return c0 * (1 - fz) + c1 * fz;
  };
  /** Outside the grid reads 0, as the gradient always has. */
  const tri0 = (x: number, y: number, z: number): number =>
    x < 0 || y < 0 || z < 0 || x > nx1 || y > ny1 || z > nz1 ? 0 : tri(x, y, z, Math.floor(x), Math.floor(y), Math.floor(z));
  // view rotation for gradients
  const cyv = Math.cos(opts.angleY), syv = Math.sin(opts.angleY);
  const cxv = Math.cos(opts.tiltX), sxv = Math.sin(opts.tiltX);
  // this pass's lights: the headlight in world axes, jittered, and the sky
  let cin: PassLight | null = null;
  if (opts.cinematic) {
    const refMm = (opts.alphaStep ?? opts.step ?? 2) * minSp;
    const lw = invRot(opts.angleY, opts.tiltX, light[0], light[1], light[2]);
    cin = passLight(cachedExtinction(field, dims, sp, stops, density, refMm), lw, jit?.pass ?? 0, jit?.of ?? 1, opts.clip);
  }

  const clipMm = opts.clip ? scaleClip(opts.clip, sp) : null;
  const rows = opts.rows ?? { from: 0, every: 1 };
  if (!(Number.isInteger(rows.from) && Number.isInteger(rows.every) && rows.every >= 1 && rows.from >= 0 && rows.from < rows.every)) {
    throw new RangeError(`vr-rows: from ${rows.from} every ${rows.every}`);
  }
  for (let py = rows.from; py < H; py += rows.every) {
    for (let px = 0; px < W; px++) {
      const vx = (px + subX - W / 2) / scale;
      const vy = -(py + subY - H / 2) / scale;
      // ray origin on the view plane, in mm about the volume centre
      const vc = invRot(opts.angleY, opts.tiltX, vx, vy, 0);
      const org: Vec3 = [vc[0] + center[0], vc[1] + center[1], vc[2] + center[2]];
      // ray starts: one lattice for every ray, or this pass's stratum of it
      // scrambled per pixel
      const phase = jit ? ((scramble(px, py) + jit.pass / jit.of) % 1) * step : 0;
      let t0 = -R + phase, t1 = R;
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
        t0 = jit
          ? -R + phase + Math.ceil((t0 - (-R + phase)) / step) * step
          : -R + Math.ceil((t0 + R) / step) * step;
      }
      if (clipMm) {
        // the clip's share of the ray, its start on the same lattice
        const kept = clipRay(clipMm, org, marchDir, t0, t1);
        if (!kept) {
          const o = (py * W + px) * 4;
          out[o] = bg[0]!; out[o + 1] = bg[1]!; out[o + 2] = bg[2]!; out[o + 3] = 255;
          continue;
        }
        if (kept[0] > t0) {
          t0 = jit
            ? -R + phase + Math.ceil((kept[0] - (-R + phase)) / step) * step
            : -R + Math.ceil((kept[0] + R) / step) * step;
        }
        t1 = kept[1];
      }
      let r = 0, g = 0, b = 0, a = 0;
      for (let t = t0; t <= t1 && a < 0.995; t += step) {
        const x = (org[0] + marchDir[0] * t) * toVox[0];
        const y = (org[1] + marchDir[1] * t) * toVox[1];
        const z = (org[2] + marchDir[2] * t) * toVox[2];
        if (x < 0 || y < 0 || z < 0 || x > nx1 || y > ny1 || z > nz1) continue;
        const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
        if (empty && empty[(z0 >> BRICK_SHIFT) * bnxy + (y0 >> BRICK_SHIFT) * bnx + (x0 >> BRICK_SHIFT)]) continue;
        const s = sampleSortedTF(stops, tri(x, y, z, x0, y0, z0));
        const alpha = opacityOf(s.a);
        if (alpha <= MIN_ALPHA) continue;
        let sh = 1;
        if (cin) {
          sh = cinematicShade(cin, toVox, x, y, z, shade ? [
            (tri0(x + 1, y, z) - tri0(x - 1, y, z)) * toVox[0],
            (tri0(x, y + 1, z) - tri0(x, y - 1, z)) * toVox[1],
            (tri0(x, y, z + 1) - tri0(x, y, z - 1)) * toVox[2],
          ] : null);
        } else if (shade) {
          // central differences in voxel space, per mm (the gradient scales
          // by the inverse spacing, or shading tilts on anisotropic grids)
          const gx = (tri0(x + 1, y, z) - tri0(x - 1, y, z)) * toVox[0];
          const gy = (tri0(x, y + 1, z) - tri0(x, y - 1, z)) * toVox[1];
          const gz = (tri0(x, y, z + 1) - tri0(x, y, z - 1)) * toVox[2];
          const l = Math.hypot(gx, gy, gz);
          if (l > 1e-9) {
            // gradient to view space (rotation only)
            const x1 = gx * cyv + gz * syv;
            const z1 = -gx * syv + gz * cyv;
            const d = (x1 * light[0] + (gy * cxv - z1 * sxv) * light[1] + (gy * sxv + z1 * cxv) * light[2]) / l;
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
