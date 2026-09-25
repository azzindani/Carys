// Sphere rasterizer (H7): atoms, residue beads or chain beads as shaded
// spheres into a z-buffer, orthographic, the view convention of
// protein.ts' rotateAtoms (orbit about y, then tilt about x; larger view
// z is nearer). A million-atom capsid is a million spheres a few pixels
// wide, so the fill pass only writes depth and which sphere won each
// pixel; shading runs once per pixel afterwards from that sphere's
// centre (the normal of a sphere at a pixel is known from where the pixel
// sits in its disc). Covered spheres cost their disc test, nothing more.
//
// Depth cues: the far side of the shell darkens with depth (fog towards
// the background), and ambient occlusion (screen-space.ts, the surface
// renderer's) darkens the gaps between subunits — both optional.

import { ambientOcclusion } from './screen-space.js';

export interface SphereSet {
  count: number;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
  r: ArrayLike<number>;
  /** RGB per sphere */
  rgb: Uint8Array;
}

export interface SphereView {
  width: number;
  height: number;
  /** radians about y, then about x */
  orbit: number;
  tilt: number;
  /** world point drawn at the frame centre, and the rotation centre */
  centre: [number, number, number];
  /** pixels per world unit */
  scale: number;
  bg: [number, number, number];
  /** half the depth the scene spans about the centre: fog runs from
   *  +depthSpan (none) to −depthSpan (full) */
  depthSpan: number;
  /** darkening towards the background at the far side, 0..1 */
  fog: number;
  /** ambient occlusion between spheres */
  ao: boolean;
}

export interface SphereFrame {
  width: number;
  height: number;
  /** backed by a plain ArrayBuffer, so ImageData takes it as it is */
  rgba: Uint8ClampedArray<ArrayBuffer>;
  /** view z per pixel, −∞ where nothing drew */
  depth: Float32Array;
  /** sphere index per pixel, −1 where nothing drew */
  id: Int32Array;
  /** spheres with at least one pixel tested inside the frame */
  drawn: number;
}

/** Reusable per-sphere screen state, so a million-sphere redraw does not
 *  allocate. */
export interface SphereScratch {
  sx: Float32Array;
  sy: Float32Array;
  rp: Float32Array;
}

export function sphereScratch(count: number): SphereScratch {
  return { sx: new Float32Array(count), sy: new Float32Array(count), rp: new Float32Array(count) };
}

const AMBIENT = 0.3;
const DIFFUSE = 0.62;
const SPECULAR = 0.2;
const SHININESS = 32;
/** Light from the upper left, towards the viewer (view space, unit). */
const LIGHT = ((): [number, number, number] => {
  const v = [-0.35, 0.45, 0.82];
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / n, v[1]! / n, v[2]! / n];
})();
/** Blinn half vector between the light and the view direction (0,0,1). */
const HALF = ((): [number, number, number] => {
  const v = [LIGHT[0], LIGHT[1], LIGHT[2] + 1];
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / n, v[1]! / n, v[2]! / n];
})();
/** A sphere under this many pixels across is one pixel. */
const POINT_RADIUS_PX = 0.5;
/** Ambient occlusion disc, as a fraction of the frame's short side, and
 *  its darkening at full occlusion. */
const AO_RADIUS = 0.04;
const AO_STRENGTH = 2.2;

/** Draw the spheres. Loud on a bad frame, scale or array size. */
export function renderSpheres(s: SphereSet, v: SphereView, scratch?: SphereScratch): SphereFrame {
  const W = v.width, H = v.height;
  if (!(W >= 1 && H >= 1 && Number.isInteger(W) && Number.isInteger(H))) throw new RangeError(`spheres-frame: ${W}×${H}`);
  if (!(v.scale > 0)) throw new RangeError(`spheres-scale: ${v.scale}`);
  if (s.rgb.length < s.count * 3) throw new RangeError(`spheres-rgb: ${s.rgb.length} values for ${s.count} spheres`);
  const sc = scratch && scratch.sx.length >= s.count ? scratch : sphereScratch(s.count);
  const depth = new Float32Array(W * H).fill(-Infinity);
  const id = new Int32Array(W * H).fill(-1);
  const co = Math.cos(v.orbit), so = Math.sin(v.orbit);
  const ct = Math.cos(v.tilt), st = Math.sin(v.tilt);
  const [cx, cy, cz] = v.centre;
  const scale = v.scale, inv = 1 / scale;
  const hx = W / 2, hy = H / 2;
  let drawn = 0;
  for (let i = 0; i < s.count; i++) {
    const x = s.x[i]! - cx, y = s.y[i]! - cy, z = s.z[i]! - cz;
    const x1 = x * co + z * so;
    const z1 = -x * so + z * co;
    const y1 = y * ct - z1 * st;
    const zc = y * st + z1 * ct;
    const px = hx + x1 * scale, py = hy - y1 * scale;
    const r = s.r[i]!, rp = r * scale;
    sc.sx[i] = px;
    sc.sy[i] = py;
    sc.rp[i] = rp;
    if (px + rp < 0 || py + rp < 0 || px - rp >= W || py - rp >= H) continue;
    drawn++;
    if (rp < POINT_RADIUS_PX) {
      const qx = Math.floor(px), qy = Math.floor(py);
      if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const k = qy * W + qx, zz = zc + r;
      if (zz > depth[k]!) { depth[k] = zz; id[k] = i; }
      continue;
    }
    const rp2 = rp * rp, front = zc + r;
    const x0 = Math.max(0, Math.floor(px - rp)), x1b = Math.min(W - 1, Math.floor(px + rp));
    const y0 = Math.max(0, Math.floor(py - rp)), y1b = Math.min(H - 1, Math.floor(py + rp));
    for (let qy = y0; qy <= y1b; qy++) {
      const dy = qy + 0.5 - py, dy2 = dy * dy;
      if (dy2 > rp2) continue;
      const row = qy * W;
      for (let qx = x0; qx <= x1b; qx++) {
        const k = row + qx;
        if (front <= depth[k]!) continue;
        const dx = qx + 0.5 - px, d2 = dx * dx + dy2;
        if (d2 > rp2) continue;
        const zz = zc + Math.sqrt(rp2 - d2) * inv;
        if (zz > depth[k]!) { depth[k] = zz; id[k] = i; }
      }
    }
  }

  // Normals from each winning sphere's disc; then light, fog, occlusion.
  const nx = new Float32Array(W * H), ny = new Float32Array(W * H), nz = new Float32Array(W * H);
  for (let qy = 0; qy < H; qy++) {
    for (let qx = 0; qx < W; qx++) {
      const k = qy * W + qx, i = id[k]!;
      if (i < 0) continue;
      const rp = sc.rp[i]!;
      if (rp < POINT_RADIUS_PX) { nz[k] = 1; continue; }
      let ax = (qx + 0.5 - sc.sx[i]!) / rp, ay = -(qy + 0.5 - sc.sy[i]!) / rp;
      let a2 = ax * ax + ay * ay;
      // a pixel the sphere only grazes can sit a hair outside its disc
      if (a2 > 1) { const f = 1 / Math.sqrt(a2); ax *= f; ay *= f; a2 = 1; }
      nx[k] = ax;
      ny[k] = ay;
      nz[k] = Math.sqrt(1 - a2);
    }
  }
  const occ = v.ao
    ? ambientOcclusion({ width: W, height: H, depth, nx, ny, nz }, {
      radiusPx: Math.max(1, AO_RADIUS * Math.min(W, H)), unitPerPx: inv, strength: AO_STRENGTH,
    })
    : null;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const [br, bg, bb] = v.bg;
  const span = v.depthSpan > 0 ? v.depthSpan : 1;
  for (let k = 0; k < W * H; k++) {
    const o = k * 4, i = id[k]!;
    rgba[o + 3] = 255;
    if (i < 0) { rgba[o] = br; rgba[o + 1] = bg; rgba[o + 2] = bb; continue; }
    const a = nx[k]!, b = ny[k]!, c = nz[k]!;
    const lam = Math.max(0, a * LIGHT[0] + b * LIGHT[1] + c * LIGHT[2]);
    const nh = Math.max(0, a * HALF[0] + b * HALF[1] + c * HALF[2]);
    const f = occ ? occ[k]! : 1;
    const lit = (AMBIENT + DIFFUSE * lam) * f;
    const spec = SPECULAR * nh ** SHININESS * f * 255;
    const far = Math.min(1, Math.max(0, (span - depth[k]!) / (2 * span))) * v.fog;
    const keep = 1 - far;
    rgba[o] = (s.rgb[i * 3]! * lit + spec) * keep + br * far;
    rgba[o + 1] = (s.rgb[i * 3 + 1]! * lit + spec) * keep + bg * far;
    rgba[o + 2] = (s.rgb[i * 3 + 2]! * lit + spec) * keep + bb * far;
  }
  return { width: W, height: H, rgba, depth, id, drawn };
}
