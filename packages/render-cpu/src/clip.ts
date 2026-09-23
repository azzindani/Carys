// Clipping for both 3D modes (F13, docs/PHASES.md): a crop box and a clip
// plane. What is kept is the box intersected with the plane's inner side,
// a convex region, so a ray keeps exactly one interval of it and a
// fragment is kept or not by one test. Each renderer takes the clip in its
// own units: the rasterizer in the mesh's (the app: mm), the raycaster in
// voxels like its `bounds`.
import type { Vec3 } from './oblique.js';

export interface Clip {
  /** keep min ≤ p ≤ max */
  box?: { min: Vec3; max: Vec3 };
  /** keep normal · p ≤ offset */
  plane?: { normal: Vec3; offset: number };
}

/** Is point (x, y, z) kept? */
export function inClip(c: Clip, x: number, y: number, z: number): boolean {
  const b = c.box;
  if (b && (x < b.min[0] || y < b.min[1] || z < b.min[2] || x > b.max[0] || y > b.max[1] || z > b.max[2])) return false;
  const p = c.plane;
  return !p || p.normal[0] * x + p.normal[1] * y + p.normal[2] * z <= p.offset;
}

/**
 * Which of the region's half-spaces point (x, y, z) lies outside, a bit
 * each (the box's six faces, then the plane); 0 is kept. The region is
 * convex, so a triangle whose three vertices share a bit lies wholly
 * outside, and one whose vertices are all 0 wholly inside.
 */
export function outcode(c: Clip, x: number, y: number, z: number): number {
  let k = 0;
  const b = c.box;
  if (b) {
    if (x < b.min[0]) k |= 1; else if (x > b.max[0]) k |= 2;
    if (y < b.min[1]) k |= 4; else if (y > b.max[1]) k |= 8;
    if (z < b.min[2]) k |= 16; else if (z > b.max[2]) k |= 32;
  }
  const p = c.plane;
  if (p && p.normal[0] * x + p.normal[1] * y + p.normal[2] * z > p.offset) k |= 64;
  return k;
}

/**
 * The part of the ray o + t·d, t in [t0, t1], the clip keeps, or null.
 * Box by slabs, plane by its crossing.
 */
export function clipRay(c: Clip, o: Vec3, d: Vec3, t0: number, t1: number): [number, number] | null {
  let a = t0, b = t1;
  if (c.box) {
    for (let i = 0; i < 3; i++) {
      const lo = c.box.min[i]!, hi = c.box.max[i]!;
      if (Math.abs(d[i]!) < 1e-12) {
        if (o[i]! < lo || o[i]! > hi) return null;
        continue;
      }
      let u = (lo - o[i]!) / d[i]!, v = (hi - o[i]!) / d[i]!;
      if (u > v) { const w = u; u = v; v = w; }
      if (u > a) a = u;
      if (v < b) b = v;
    }
  }
  if (c.plane) {
    const n = c.plane.normal;
    const nd = n[0] * d[0] + n[1] * d[1] + n[2] * d[2], no = n[0] * o[0] + n[1] * o[1] + n[2] * o[2];
    if (Math.abs(nd) < 1e-12) {
      if (no > c.plane.offset) return null;
    } else {
      const t = (c.plane.offset - no) / nd;
      if (nd > 0) { if (t < b) b = t; } else if (t > a) a = t;
    }
  }
  return a <= b ? [a, b] : null;
}

/** The same clip in other units: every coordinate multiplied by `s`
 *  (voxels → mm with the spacing; the plane's normal divides by it). */
export function scaleClip(c: Clip, s: Vec3): Clip {
  const out: Clip = {};
  if (c.box) out.box = { min: [c.box.min[0] * s[0], c.box.min[1] * s[1], c.box.min[2] * s[2]], max: [c.box.max[0] * s[0], c.box.max[1] * s[1], c.box.max[2] * s[2]] };
  if (c.plane) out.plane = { normal: [c.plane.normal[0] / s[0], c.plane.normal[1] / s[1], c.plane.normal[2] / s[2]], offset: c.plane.offset };
  return out;
}
