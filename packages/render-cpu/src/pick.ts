// 3D → 2D picking (F12, docs/PHASES.md): which point of the volume a click
// on the 3D view lands on. Both picks use their renderer's own frame, so the
// point is under the pixel that was drawn there.
//
// Points come back in voxel space with voxel i spanning [i, i + 1] (the
// meshes' convention; the raycaster samples voxel centres at integers, so
// its points are shifted by half a voxel to match), with the unit direction
// the view ray travels, so a caller can step into what it hit.
import { intersectAABB, type VrOpts, type VrVolume } from './vr.js';
import { sampleSortedTF, sortTF } from './tf.js';
import { sampleTrilinear, type Vec3 } from './oblique.js';
import { clipRay, inClip, scaleClip, type Clip } from './clip.js';
import type { TriMesh } from './surface.js';

export interface PickHit {
  point: Vec3;
  /** unit direction into the screen, voxel axes */
  dir: Vec3;
  /** a surface pick's triangle (its first index / 3) */
  tri?: number;
}

export interface SurfacePickView {
  width: number;
  height: number;
  angleY: number;
  tiltX: number;
  zoom?: number;
  center?: Vec3;
  /** as renderMesh's: clipped points are not there to hit */
  clip?: Clip;
  /** as renderMesh's: a triangle at 0 is not there; a see-through one (under
   *  1) is hit only where no opaque one is, a tap reaching through it to
   *  what it shows (H4) */
  triAlpha?: ArrayLike<number>;
}

/** Opacity a volume ray must reach for its pick. */
const PICK_OPACITY = 0.5;

/**
 * The nearest drawn triangle under canvas point (x, y) of a mesh rendered by
 * `renderMesh(mesh, dims, view)`: same projection, same cull (a face is
 * skipped only when all three vertex normals face away). Null on a miss.
 */
export function pickSurface(mesh: TriMesh, dims: Vec3, view: SurfacePickView, x: number, y: number): PickHit | null {
  const { width: W, height: H } = view;
  const scale = (Math.min(W, H) / Math.max(dims[0], dims[1], dims[2])) * 0.92 * (view.zoom ?? 1);
  const cy = Math.cos(view.angleY), sy = Math.sin(view.angleY);
  const cx = Math.cos(view.tiltX), sx = Math.sin(view.tiltX);
  const [ccx, ccy, ccz] = view.center ?? [dims[0] / 2, dims[1] / 2, dims[2] / 2];
  const P = mesh.positions, N = mesh.normals, I = mesh.indices;
  const nv = P.length / 3;
  const X = new Float64Array(nv), Y = new Float64Array(nv), Z = new Float64Array(nv), NZ = new Float64Array(nv);
  for (let v = 0; v < nv; v++) {
    const px = P[v * 3]! - ccx, py = P[v * 3 + 1]! - ccy, pz = P[v * 3 + 2]! - ccz;
    const z1 = -px * sy + pz * cy;
    X[v] = W / 2 + (px * cy + pz * sy) * scale;
    Y[v] = H / 2 - (py * cx - z1 * sx) * scale;
    Z[v] = py * sx + z1 * cx;
    NZ[v] = N[v * 3 + 1]! * sx + (-N[v * 3]! * sy + N[v * 3 + 2]! * cy) * cx;
  }
  const ta = view.triAlpha;
  if (ta && ta.length !== I.length / 3) throw new RangeError(`pick-trialpha: ${ta.length} values for ${I.length / 3} triangles`);
  let best = -Infinity, hit: Vec3 | null = null, tri = -1;
  // the nearest see-through triangle, kept for where nothing opaque is
  let seeBest = -Infinity, seeHit: Vec3 | null = null, seeTri = -1;
  for (let t = 0; t < I.length; t += 3) {
    const alpha = ta ? ta[t / 3]! : 1;
    if (!(alpha > 0)) continue;
    const a = I[t]!, b = I[t + 1]!, c = I[t + 2]!;
    if (!view.clip && NZ[a]! <= 0 && NZ[b]! <= 0 && NZ[c]! <= 0) continue;
    const x0 = X[a]!, y0 = Y[a]!, x1 = X[b]!, y1 = Y[b]!, x2 = X[c]!, y2 = Y[c]!;
    // see-through: its front only, as renderMesh draws it
    if (alpha < 1 && !view.clip && (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) > 0) continue;
    if (x < Math.min(x0, x1, x2) || x > Math.max(x0, x1, x2) || y < Math.min(y0, y1, y2) || y > Math.max(y0, y1, y2)) continue;
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-12) continue;
    const w0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den;
    const w1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den;
    const w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const z = w0 * Z[a]! + w1 * Z[b]! + w2 * Z[c]!;
    if (z <= (alpha < 1 ? seeBest : best)) continue;
    const p = [0, 1, 2].map((k) => w0 * P[a * 3 + k]! + w1 * P[b * 3 + k]! + w2 * P[c * 3 + k]!) as Vec3;
    if (view.clip && !inClip(view.clip, p[0], p[1], p[2])) continue;
    if (alpha < 1) { seeBest = z; seeHit = p; seeTri = t / 3; continue; }
    best = z;
    hit = p;
    tri = t / 3;
  }
  if (!hit && seeHit) { hit = seeHit; tri = seeTri; }
  // into the screen: minus the view's third axis, in the mesh's axes
  return hit ? { point: hit, dir: [sy * cx, -sx, -cy * cx], tri } : null;
}

/**
 * Where the ray through canvas point (x, y) of `renderVolume(vol, opts)`
 * becomes half opaque; where it contributed most if it never does. Samples
 * the same lattice as the plain render (no jitter); spacing, bounds, TF,
 * density and `alphaStep` as given. Null when the ray composites nothing.
 */
export function pickVolume(vol: VrVolume, opts: VrOpts, x: number, y: number): PickHit | null {
  const { dims } = vol;
  const field = opts.field ?? vol.data;
  const sp = opts.spacing ?? [1, 1, 1];
  const toVox: Vec3 = [1 / sp[0], 1 / sp[1], 1 / sp[2]];
  const minSp = Math.min(sp[0], sp[1], sp[2]);
  const ext: Vec3 = [dims[0] * sp[0], dims[1] * sp[1], dims[2] * sp[2]];
  const step = (opts.step ?? 2) * minSp;
  const alphaK = opts.alphaStep === undefined ? 1 : (opts.step ?? 2) / opts.alphaStep;
  const density = opts.density ?? 1;
  const scale = (Math.min(opts.width, opts.height) / Math.max(ext[0], ext[1], ext[2])) * 0.92 * (opts.zoom ?? 1);
  const R = Math.hypot(ext[0], ext[1], ext[2]) / 2 + minSp;
  // the raycaster's inverse view rotation (vr.ts invRot)
  const inv = (vx: number, vy: number, vz: number): Vec3 => {
    const c1 = Math.cos(-opts.tiltX), s1 = Math.sin(-opts.tiltX);
    const y1 = vy * c1 - vz * s1, z1 = vy * s1 + vz * c1;
    const c2 = Math.cos(-opts.angleY), s2 = Math.sin(-opts.angleY);
    return [vx * c2 + z1 * s2, y1, -vx * s2 + z1 * c2];
  };
  const raw = inv(0, 0, -1), dl = Math.hypot(raw[0], raw[1], raw[2]) || 1;
  const dir: Vec3 = [raw[0] / dl, raw[1] / dl, raw[2] / dl];
  const vc = inv((x - opts.width / 2) / scale, -(y - opts.height / 2) / scale, 0);
  const org: Vec3 = [vc[0] + ext[0] / 2, vc[1] + ext[1] / 2, vc[2] + ext[2] / 2];
  let t0 = -R, t1 = R;
  if (opts.bounds) {
    const b = opts.bounds;
    const hit = intersectAABB(org, dir, [b.min[0] * sp[0], b.min[1] * sp[1], b.min[2] * sp[2]], [b.max[0] * sp[0], b.max[1] * sp[1], b.max[2] * sp[2]]);
    if (!hit) return null;
    t0 = -R + Math.ceil((Math.max(t0, hit[0]) + R) / step) * step;
    t1 = Math.min(t1, hit[1]);
  }
  if (opts.clip) {
    const kept = clipRay(scaleClip(opts.clip, sp), org, dir, t0, t1);
    if (!kept) return null;
    if (kept[0] > t0) t0 = -R + Math.ceil((kept[0] + R) / step) * step;
    t1 = kept[1];
  }
  const stops = sortTF(opts.tf);
  let a = 0, most = 0, mostAt: Vec3 | null = null;
  for (let t = t0; t <= t1; t += step) {
    const p: Vec3 = [(org[0] + dir[0] * t) * toVox[0], (org[1] + dir[1] * t) * toVox[1], (org[2] + dir[2] * t) * toVox[2]];
    const v = sampleTrilinear(field, dims, p);
    if (v == null) continue;
    let alpha = Math.min(1, sampleSortedTF(stops, v).a * density);
    if (alphaK !== 1) alpha = 1 - (1 - alpha) ** alphaK;
    if (alpha <= 0.003) continue;
    const gain = (1 - a) * alpha;
    a += gain;
    const at: Vec3 = [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5];
    if (a >= PICK_OPACITY) { mostAt = at; break; }
    if (gain > most) { most = gain; mostAt = at; }
  }
  if (!mostAt) return null;
  const d: Vec3 = [dir[0] * toVox[0], dir[1] * toVox[1], dir[2] * toVox[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  return { point: mostAt, dir: [d[0] / l, d[1] / l, d[2] / l] };
}
