// Analytic phantoms and surface-accuracy metrics (F1, docs/PHASES.md).
//
// A phantom is a shape with a known signed distance, normal and volume, so a
// mesh extracted from its sampled field can be scored in millimetres instead
// of eyeballed. Sampling follows the viewer's voxel convention — voxel i
// covers [i, i+1] with its centre at (i + 0.5) × spacing, as the 2D panes
// draw it — and meshes are read in mm the way the 3D view reads them
// (vertex × spacing, app/lib/physical3d.ts). An extractor that uses another
// convention shows up here as error, which is the point.

export type V3 = [number, number, number];

export interface Phantom {
  name: string;
  /** signed distance in mm: negative inside */
  sdf: (p: V3) => number;
  /** outward unit normal near the surface */
  normal: (p: V3) => V3;
  /** analytic volume in mm³ */
  volume: number;
}

const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export function sphere(c: V3, r: number): Phantom {
  return {
    name: `sphere r${r}`,
    sdf: (p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r,
    normal: (p) => unit([p[0] - c[0], p[1] - c[1], p[2] - c[2]]),
    volume: (4 / 3) * Math.PI * r ** 3,
  };
}

/**
 * Axis-aligned ellipsoid. The distance is one Newton step on
 * q = Σ(xᵢ/aᵢ)² − 1, accurate to O(d²/ρ): about 0.01 mm at the half-voxel
 * distances scored here, well under what the metrics resolve.
 */
export function ellipsoid(c: V3, a: V3): Phantom {
  const grad = (p: V3): V3 => [
    (2 * (p[0] - c[0])) / a[0] ** 2, (2 * (p[1] - c[1])) / a[1] ** 2, (2 * (p[2] - c[2])) / a[2] ** 2,
  ];
  return {
    name: `ellipsoid ${a.join('×')}`,
    sdf: (p) => {
      const q = ((p[0] - c[0]) / a[0]) ** 2 + ((p[1] - c[1]) / a[1]) ** 2 + ((p[2] - c[2]) / a[2]) ** 2;
      const g = grad(p);
      return (q - 1) / (Math.hypot(g[0], g[1], g[2]) || 1);
    },
    normal: (p) => unit(grad(p)),
    volume: (4 / 3) * Math.PI * a[0] * a[1] * a[2],
  };
}

/** Torus around the z axis: exact distance, a surface with saddle regions. */
export function torus(c: V3, major: number, minor: number): Phantom {
  const ring = (p: V3): V3 => {
    const x = p[0] - c[0], y = p[1] - c[1];
    const rho = Math.hypot(x, y) || 1;
    return [c[0] + (x / rho) * major, c[1] + (y / rho) * major, c[2]];
  };
  return {
    name: `torus ${major}/${minor}`,
    sdf: (p) => Math.hypot(Math.hypot(p[0] - c[0], p[1] - c[1]) - major, p[2] - c[2]) - minor,
    normal: (p) => {
      const q = ring(p);
      return unit([p[0] - q[0], p[1] - q[1], p[2] - q[2]]);
    },
    volume: 2 * Math.PI ** 2 * major * minor ** 2,
  };
}

/** Axis-aligned box with half-sizes h: exact distance. Thin in one axis, a
 *  plate — the shape a blur-based smoother melts away. */
export function box(c: V3, h: V3): Phantom {
  const q = (p: V3): V3 => [Math.abs(p[0] - c[0]) - h[0], Math.abs(p[1] - c[1]) - h[1], Math.abs(p[2] - c[2]) - h[2]];
  return {
    name: `box ${h.map((v) => v * 2).join('×')}`,
    sdf: (p) => {
      const d = q(p);
      return Math.hypot(Math.max(d[0], 0), Math.max(d[1], 0), Math.max(d[2], 0)) + Math.min(Math.max(d[0], d[1], d[2]), 0);
    },
    normal: (p) => {
      const d = q(p);
      const k = d[0] >= d[1] && d[0] >= d[2] ? 0 : d[1] >= d[2] ? 1 : 2;
      const n: V3 = [0, 0, 0];
      n[k] = p[k] >= c[k] ? 1 : -1;
      return n;
    },
    volume: 8 * h[0] * h[1] * h[2],
  };
}

/** Capsule (a tube with round ends) from a to b: exact distance — a vessel. */
export function capsule(a: V3, b: V3, r: number): Phantom {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const axis = (p: V3): V3 => {
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2));
    return [p[0] - (a[0] + t * ab[0]), p[1] - (a[1] + t * ab[1]), p[2] - (a[2] + t * ab[2])];
  };
  return {
    name: `capsule r${r}`,
    sdf: (p) => { const d = axis(p); return Math.hypot(d[0], d[1], d[2]) - r; },
    normal: (p) => unit(axis(p)),
    volume: Math.PI * r * r * Math.sqrt(len2) + (4 / 3) * Math.PI * r ** 3,
  };
}

/** erf, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
export function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592)
    * t * Math.exp(-x * x);
  return s * y;
}

const centre = (i: number, j: number, k: number, sp: V3): V3 => [(i + 0.5) * sp[0], (j + 0.5) * sp[1], (k + 0.5) * sp[2]];

/**
 * The phantom as a scanner would show it: a step from 0 to `hi` blurred by
 * a Gaussian of `sigmaMm`, sampled at voxel centres. The half-way value
 * (hi / 2) lies exactly on the surface for a plane, and within σ²/(2ρ) of it
 * on a curve of radius ρ. No slice-profile averaging: thick slices keep
 * their hard sampling, the case F5 has to handle.
 */
export function sampleIntensity(ph: Phantom, dims: V3, sp: V3, sigmaMm = 0.5, hi = 1000): Float64Array {
  const [nx, ny, nz] = dims;
  const out = new Float64Array(nx * ny * nz);
  const k = 1 / (sigmaMm * Math.SQRT2);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        out[z * nx * ny + y * nx + x] = hi * 0.5 * (1 - erf(ph.sdf(centre(x, y, z, sp)) * k));
      }
    }
  }
  return out;
}

/** The phantom as a segmentation: 1 where the voxel centre is inside. */
export function sampleMask(ph: Phantom, dims: V3, sp: V3): Uint8Array {
  const [nx, ny, nz] = dims;
  const out = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) out[z * nx * ny + y * nx + x] = ph.sdf(centre(x, y, z, sp)) < 0 ? 1 : 0;
    }
  }
  return out;
}

export interface SurfaceScore {
  /** mean |distance| of vertices to the true surface, mm */
  meanErr: number;
  /** worst vertex, mm */
  maxErr: number;
  /** mesh volume (divergence theorem) vs analytic, percent, signed */
  volErrPct: number;
  /** area-weighted mean angle between face and true normals, degrees —
   *  the staircase score: terraces and cube faces point the wrong way */
  normalDevDeg: number;
  tris: number;
}

/** Score a mesh (vertices in voxel units, as extracted) against the phantom. */
export function scoreMesh(
  mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> }, sp: V3, ph: Phantom,
): SurfaceScore {
  const P = mesh.positions, I = mesh.indices;
  const nv = P.length / 3;
  const mm = (i: number): V3 => [P[i * 3]! * sp[0], P[i * 3 + 1]! * sp[1], P[i * 3 + 2]! * sp[2]];
  let sum = 0, max = 0;
  for (let i = 0; i < nv; i++) {
    const d = Math.abs(ph.sdf(mm(i)));
    sum += d;
    if (d > max) max = d;
  }
  let vol = 0, area = 0, dev = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = mm(I[t]!), b = mm(I[t + 1]!), c = mm(I[t + 2]!);
    const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const ar = Math.hypot(n[0], n[1], n[2]) / 2;
    if (ar === 0) continue;
    const g = ph.normal([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
    const cos = (n[0] * g[0] + n[1] * g[1] + n[2] * g[2]) / (2 * ar);
    dev += ar * Math.acos(Math.max(-1, Math.min(1, cos)));
    area += ar;
  }
  return {
    meanErr: nv > 0 ? sum / nv : Number.NaN,
    maxErr: max,
    volErrPct: ((vol - ph.volume) / ph.volume) * 100,
    normalDevDeg: area > 0 ? (dev / area) * (180 / Math.PI) : Number.NaN,
    tris: I.length / 3,
  };
}

/** A latitude/longitude sphere mesh with exact unit normals, wound outward:
 *  a renderer test subject whose shading is known everywhere. */
export function uvSphere(c: V3, r: number, lat: number, lon: number): {
  positions: Float32Array; normals: Float32Array; indices: Uint32Array;
} {
  const pos: number[] = [], nrm: number[] = [];
  for (let i = 0; i <= lat; i++) {
    const th = (Math.PI * i) / lat;
    for (let j = 0; j < lon; j++) {
      const ph = (2 * Math.PI * j) / lon;
      const n = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)] as const;
      nrm.push(...n);
      pos.push(c[0] + r * n[0], c[1] + r * n[1], c[2] + r * n[2]);
    }
  }
  const idx: number[] = [];
  const v = (i: number, j: number): number => i * lon + (j % lon);
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) idx.push(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i, j + 1));
  }
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), indices: Uint32Array.from(idx) };
}

/** Closest distance from p to triangle abc (Ericson, Real-Time Collision
 *  Detection §5.1.5). */
function pointTriangle(p: V3, a: V3, b: V3, c: V3): number {
  const sub = (u: V3, v: V3): V3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: V3, v: V3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const at = (q: V3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return at(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return at([a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return at([a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return at([b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]);
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return at([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

/**
 * Distance from every vertex of `from` to the surface of `to`, both in the
 * same units (scaled by `sp`), searched out to `reach`: farther reads as
 * `reach`. Triangles are bucketed on a grid of `reach`-sized cells.
 * `each`, when given, receives every vertex's distance.
 */
export function surfaceDistance(
  from: { positions: ArrayLike<number> }, to: { positions: ArrayLike<number>; indices: ArrayLike<number> },
  sp: V3, reach: number, each?: Float64Array,
): { mean: number; max: number } {
  const P = to.positions, I = to.indices;
  const v = (i: number): V3 => [P[i * 3]! * sp[0], P[i * 3 + 1]! * sp[1], P[i * 3 + 2]! * sp[2]];
  const cell = (x: number): number => Math.floor(x / reach);
  const buckets = new Map<string, number[]>();
  for (let t = 0; t < I.length; t += 3) {
    const a = v(I[t]!), b = v(I[t + 1]!), c = v(I[t + 2]!);
    const lo = [0, 1, 2].map((k) => cell(Math.min(a[k]!, b[k]!, c[k]!))), hi = [0, 1, 2].map((k) => cell(Math.max(a[k]!, b[k]!, c[k]!)));
    for (let x = lo[0]!; x <= hi[0]!; x++) for (let y = lo[1]!; y <= hi[1]!; y++) for (let z = lo[2]!; z <= hi[2]!; z++) {
      const k = `${x},${y},${z}`;
      (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(t);
    }
  }
  const Q = from.positions;
  let sum = 0, max = 0;
  const n = Q.length / 3;
  for (let i = 0; i < n; i++) {
    const p: V3 = [Q[i * 3]! * sp[0], Q[i * 3 + 1]! * sp[1], Q[i * 3 + 2]! * sp[2]];
    let d = reach;
    const cx = cell(p[0]), cy = cell(p[1]), cz = cell(p[2]);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
      for (const t of buckets.get(`${x},${y},${z}`) ?? []) d = Math.min(d, pointTriangle(p, v(I[t]!), v(I[t + 1]!), v(I[t + 2]!)));
    }
    sum += d;
    if (d > max) max = d;
    if (each) each[i] = d;
  }
  return { mean: sum / n, max };
}
