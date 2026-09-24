// Placing one body's organs in another's frame (H3, docs/PHASES.md): the
// HuBMAP reference organs come from the Visible Human male, the atlas is
// BodyParts3D's body, and two people's organs sit differently (their
// spacing differs by up to 40%). Organs both have are "anchors": each gets
// its own similarity (scale, rotation, translation) by ICP; a point of an
// added organ moves by those transforms blended by how near it is to each
// anchor (Shepard weights), so a lung follows the heart, trachea and liver
// around it. Pure, no DOM.

type V3 = [number, number, number];

/** x' = m · x + t, m row-major 3×3 (scale times rotation). */
export interface Similarity {
  m: number[];
  t: V3;
}

export const IDENTITY_FIT: Similarity = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

export function applyFit(f: Similarity, p: ArrayLike<number>): Float64Array {
  const out = new Float64Array(p.length), m = f.m;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!;
    out[i] = m[0]! * x + m[1]! * y + m[2]! * z + f.t[0];
    out[i + 1] = m[3]! * x + m[4]! * y + m[5]! * z + f.t[1];
    out[i + 2] = m[6]! * x + m[7]! * y + m[8]! * z + f.t[2];
  }
  return out;
}

/** The fit's uniform scale (cube root of its determinant). */
export function fitScale(f: Similarity): number {
  const m = f.m;
  return Math.cbrt(m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!));
}

/**
 * Points spread evenly over a triangle mesh, about `step` apart: each
 * triangle is cut into n² equal pieces, each no bigger than an equilateral
 * triangle of side `step`, and each piece gives its centroid.
 * Deterministic, area-uniform. (n from the longest edge instead gave a
 * decimated mesh's slivers hundreds of points each on no area.)
 */
export function surfaceSamples(mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> }, step: number): Float64Array {
  if (!(step > 0)) throw new RangeError(`organ-fit-step: ${step}`);
  const P = mesh.positions, I = mesh.indices, out: number[] = [];
  const piece = (Math.sqrt(3) / 4) * step * step;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    const n = Math.max(1, Math.ceil(Math.sqrt(area / piece)));
    // barycentric (u, v) of each piece's centroid: n(n+1)/2 upright, n(n−1)/2 inverted
    const put = (u: number, v: number): void => {
      const w = 1 - u - v;
      for (let k = 0; k < 3; k++) out.push(w * P[a + k]! + u * P[b + k]! + v * P[c + k]!);
    };
    for (let i = 0; i < n; i++) {
      for (let j = 0; i + j < n; j++) {
        put((i + 1 / 3) / n, (j + 1 / 3) / n);
        if (i + j < n - 1) put((i + 2 / 3) / n, (j + 2 / 3) / n);
      }
    }
  }
  return Float64Array.from(out);
}

/**
 * Nearest-point queries over a fixed point set: a k-d tree whose every
 * subtree keeps its bounding box, so a query far from the set (a spinal
 * cord point asking the knee) skips whole subtrees instead of walking them.
 */
export class PointTree {
  /** the points' coordinates in tree order, and each one's input index */
  private readonly p: Float64Array;
  private readonly order: Uint32Array;
  /** per subtree (keyed by its median's slot): min x y z, max x y z */
  private readonly box: Float64Array;
  // the query in flight (one at a time: no closure per call)
  private qx = 0;
  private qy = 0;
  private qz = 0;
  private best = -1;
  private bd = Infinity;

  constructor(points: Float64Array) {
    if (points.length % 3 || !points.length) throw new RangeError(`organ-fit-points: ${points.length} coordinates`);
    const o = Uint32Array.from({ length: points.length / 3 }, (_, i) => i);
    PointTree.build(points, o, 0, o.length, 0);
    this.order = o;
    this.p = new Float64Array(points.length);
    for (let k = 0; k < o.length; k++) {
      this.p[k * 3] = points[o[k]! * 3]!; this.p[k * 3 + 1] = points[o[k]! * 3 + 1]!; this.p[k * 3 + 2] = points[o[k]! * 3 + 2]!;
    }
    this.box = new Float64Array(o.length * 6);
    this.bound(0, o.length);
  }

  private static build(p: Float64Array, o: Uint32Array, lo: number, hi: number, axis: number): void {
    if (hi - lo <= 1) return;
    const mid = (lo + hi) >> 1;
    // quickselect the median on this axis into o[mid]
    let l = lo, r = hi - 1;
    while (l < r) {
      const pivot = p[o[(l + r) >> 1]! * 3 + axis]!;
      let i = l, j = r;
      while (i <= j) {
        while (p[o[i]! * 3 + axis]! < pivot) i++;
        while (p[o[j]! * 3 + axis]! > pivot) j--;
        if (i <= j) { const s = o[i]!; o[i] = o[j]!; o[j] = s; i++; j--; }
      }
      if (mid <= j) r = j; else if (mid >= i) l = i; else break;
    }
    PointTree.build(p, o, lo, mid, (axis + 1) % 3);
    PointTree.build(p, o, mid + 1, hi, (axis + 1) % 3);
  }

  /** Fill the box of the subtree over [lo, hi), kept at its median's slot. */
  private bound(lo: number, hi: number): void {
    const mid = (lo + hi) >> 1, b = this.box, p = this.p, at = mid * 6;
    for (let k = 0; k < 3; k++) { b[at + k] = p[mid * 3 + k]!; b[at + 3 + k] = p[mid * 3 + k]!; }
    for (const [l, h] of [[lo, mid], [mid + 1, hi]] as const) {
      if (l >= h) continue;
      this.bound(l, h);
      const c = ((l + h) >> 1) * 6;
      for (let k = 0; k < 3; k++) { b[at + k] = Math.min(b[at + k]!, b[c + k]!); b[at + 3 + k] = Math.max(b[at + 3 + k]!, b[c + 3 + k]!); }
    }
  }

  private walk(lo: number, hi: number, axis: number): void {
    if (lo >= hi) return;
    const mid = (lo + hi) >> 1, p = this.p, i = mid * 3, b = this.box, at = mid * 6;
    // the subtree's box is farther than the best so far: nothing in it helps
    const bx = Math.max(b[at]! - this.qx, 0, this.qx - b[at + 3]!);
    const by = Math.max(b[at + 1]! - this.qy, 0, this.qy - b[at + 4]!);
    const bz = Math.max(b[at + 2]! - this.qz, 0, this.qz - b[at + 5]!);
    if (bx * bx + by * by + bz * bz >= this.bd) return;
    const dx = p[i]! - this.qx, dy = p[i + 1]! - this.qy, dz = p[i + 2]! - this.qz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < this.bd) { this.bd = d2; this.best = mid; }
    const diff = axis === 0 ? -dx : axis === 1 ? -dy : -dz, next = axis === 2 ? 0 : axis + 1;
    if (diff < 0) { this.walk(lo, mid, next); if (diff * diff < this.bd) this.walk(mid + 1, hi, next); }
    else { this.walk(mid + 1, hi, next); if (diff * diff < this.bd) this.walk(lo, mid, next); }
  }

  /** The index of the point nearest (x, y, z), and its squared distance. */
  nearest(x: number, y: number, z: number): { index: number; d2: number } {
    this.qx = x; this.qy = y; this.qz = z; this.best = -1; this.bd = Infinity;
    this.walk(0, this.order.length, 0);
    return { index: this.order[this.best]!, d2: this.bd };
  }
}

/** Largest eigenvector of a symmetric 4×4 (cyclic Jacobi). */
function topEigenvector(a: number[][]): number[] {
  const v = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p]![q]! ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p]![q]!) < 1e-300) continue;
        const th = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k]![p]!, akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq; a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p]![k]!, aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk; a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k]![p]!, vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq; v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let top = 0;
  for (let k = 1; k < 4; k++) if (a[k]![k]! > a[top]![top]!) top = k;
  return [v[0]![top]!, v[1]![top]!, v[2]![top]!, v[3]![top]!];
}

/**
 * The similarity taking points x to points y best in least squares (Horn's
 * closed form: the rotation is the top eigenvector of a 4×4 built from the
 * cross-covariance; then scale, then translation).
 */
export function similarityFit(x: ArrayLike<number>, y: ArrayLike<number>): Similarity {
  const n = x.length / 3;
  if (n < 3 || x.length !== y.length) throw new RangeError(`organ-fit-pairs: ${n} pairs`);
  const mx = [0, 0, 0], my = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mx[k]! += x[i * 3 + k]! / n; my[k]! += y[i * 3 + k]! / n; }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let sx = 0;
  for (let i = 0; i < n; i++) {
    const a = [0, 1, 2].map((k) => x[i * 3 + k]! - mx[k]!), b = [0, 1, 2].map((k) => y[i * 3 + k]! - my[k]!);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r]![c]! += a[r]! * b[c]!;
    sx += a[0]! ** 2 + a[1]! ** 2 + a[2]! ** 2;
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S as [V3, V3, V3];
  const q = topEigenvector([
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ]);
  const [w, qx, qy, qz] = q as [number, number, number, number];
  const R = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - w * qz), 2 * (qx * qz + w * qy),
    2 * (qx * qy + w * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - w * qx),
    2 * (qx * qz - w * qy), 2 * (qy * qz + w * qx), 1 - 2 * (qx * qx + qy * qy),
  ];
  // scale: Σ b · R a / Σ |a|² (= trace(Rᵀ S) / Σ |a|²)
  let num = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) num += R[r * 3 + c]! * S[c]![r]!;
  if (!(sx > 0)) throw new RangeError('organ-fit-pairs: the points do not spread');
  const s = num / sx, m = R.map((v) => v * s);
  const t: V3 = [0, 1, 2].map((r) => my[r]! - (m[r * 3]! * mx[0]! + m[r * 3 + 1]! * mx[1]! + m[r * 3 + 2]! * mx[2]!)) as V3;
  return { m, t };
}

/** One organ in both bodies: points on each surface. */
export interface AnchorPair {
  /** samples on the organ as it comes (the body being placed) */
  src: Float64Array;
  /** samples on the organ in the target body */
  dst: Float64Array;
  /** pair both ways (whole surfaces), or only src → dst (src covers part
   *  of dst, as a knee model covers the ends of the femur) */
  both: boolean;
}

/**
 * Iterative closest points for one similarity over several anchors: pair
 * each src sample with its nearest dst sample (and each dst sample with its
 * nearest moved src sample, when `both`), drop the pairs past the `keep`
 * quantile of distance, refit, repeat.
 */
export function icpSimilarity(anchors: readonly AnchorPair[], start: Similarity, iterations = 40, keep = 0.9): Similarity {
  const trees = anchors.map((a) => new PointTree(a.dst));
  let fit = start;
  for (let it = 0; it < iterations; it++) {
    const xs: number[] = [], ys: number[] = [];
    anchors.forEach((a, k) => {
      const moved = applyFit(fit, a.src);
      const pairs: [number, number, number][] = [];
      for (let i = 0; i < moved.length / 3; i++) {
        const h = trees[k]!.nearest(moved[i * 3]!, moved[i * 3 + 1]!, moved[i * 3 + 2]!);
        pairs.push([h.d2, i, h.index]);
      }
      if (a.both) {
        const back = new PointTree(moved);
        for (let j = 0; j < a.dst.length / 3; j++) {
          const h = back.nearest(a.dst[j * 3]!, a.dst[j * 3 + 1]!, a.dst[j * 3 + 2]!);
          pairs.push([h.d2, h.index, j]);
        }
      }
      const cut = [...pairs.map((p) => p[0])].sort((u, v) => u - v)[Math.floor((pairs.length - 1) * keep)]!;
      for (const [d2, i, j] of pairs) {
        if (d2 > cut) continue;
        for (let c = 0; c < 3; c++) { xs.push(a.src[i * 3 + c]!); ys.push(a.dst[j * 3 + c]!); }
      }
    });
    fit = similarityFit(xs, ys);
  }
  return fit;
}

/** An anchor's own fit and where its surface is, for the blend. */
export interface FieldAnchor {
  fit: Similarity;
  /** samples on the anchor as it comes (before any fit) */
  near: PointTree;
}

/** How far (mm) the blend weights 1/(d² + SOFT²)² stay finite at d = 0. */
export const FIELD_SOFT_MM = 5;

/**
 * Move points (in the source body's frame) by the anchors' fits blended by
 * nearness, weights 1/(d² + SOFT²)²: a point on or in an anchor moves
 * (almost) as that anchor does, one between anchors mostly as the nearest
 * do. Squared, so a far anchor with an odd fit (a gland ICP shrank by 40%)
 * does not drag a spinal cord 3 cm away. Smooth: the weights are.
 */
export function blendField(anchors: readonly FieldAnchor[], points: ArrayLike<number>): Float64Array {
  if (!anchors.length) throw new RangeError('organ-fit-field: no anchors');
  const out = new Float64Array(points.length);
  const soft = FIELD_SOFT_MM ** 2;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i]!, y = points[i + 1]!, z = points[i + 2]!;
    let sw = 0, ax = 0, ay = 0, az = 0;
    for (const a of anchors) {
      const q = a.near.nearest(x, y, z).d2 + soft, w = 1 / (q * q), m = a.fit.m, t = a.fit.t;
      sw += w;
      ax += w * (m[0]! * x + m[1]! * y + m[2]! * z + t[0]);
      ay += w * (m[3]! * x + m[4]! * y + m[5]! * z + t[1]);
      az += w * (m[6]! * x + m[7]! * y + m[8]! * z + t[2]);
    }
    out[i] = ax / sw; out[i + 1] = ay / sw; out[i + 2] = az / sw;
  }
  return out;
}

/** Rays for the inside test: off-axis, so they rarely graze an edge exactly. */
const INSIDE_RAYS: readonly V3[] = [[1, 0.013, 0.007], [0.011, 1, 0.017], [0.019, 0.005, 1]];

type Mesh = { positions: ArrayLike<number>; indices: ArrayLike<number> };

/** How many times the line through (x, y, z) along d crosses a mesh's
 *  surface: [ahead of the point, behind it] (Möller–Trumbore). */
function crossings(mesh: Mesh, x: number, y: number, z: number, [dx, dy, dz]: V3): [number, number] {
  const P = mesh.positions, I = mesh.indices;
  let ahead = 0, behind = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
    const e1x = P[b]! - P[a]!, e1y = P[b + 1]! - P[a + 1]!, e1z = P[b + 2]! - P[a + 2]!;
    const e2x = P[c]! - P[a]!, e2y = P[c + 1]! - P[a + 1]!, e2z = P[c + 2]! - P[a + 2]!;
    const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-12) continue;
    const f = 1 / det, sx = x - P[a]!, sy = y - P[a + 1]!, sz = z - P[a + 2]!;
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = f * (dx * qx + dy * qy + dz * qz);
    if (v < 0 || u + v > 1) continue;
    const s = f * (e2x * qx + e2y * qy + e2z * qz);
    if (s > 0) ahead++;
    else if (s < 0) behind++;
  }
  return [ahead, behind];
}

/**
 * Whether a point lies inside a closed triangle mesh: a ray from it crosses
 * the surface an odd number of times. Three rays vote, so a ray that grazes
 * an edge (counted twice or not at all) is outvoted.
 */
export function insideMesh(mesh: Mesh, x: number, y: number, z: number): boolean {
  let votes = 0;
  for (const d of INSIDE_RAYS) if (crossings(mesh, x, y, z, d)[0] % 2) votes++;
  return votes >= 2;
}

/**
 * The middle of a hole through a mesh, on the lines given (each from a to b):
 * of the points along them every `step` mm that lie outside the mesh with
 * its surface both ahead and behind along their line, the one farthest from
 * the surface (sampled `step` apart). A vertebra is a ring of bone: across
 * its midline from front to back, at heights through the ring, this is the
 * centre of the spinal canal. Null when no line passes through a hole.
 */
export function holeCentre(mesh: Mesh, lines: readonly (readonly [V3, V3])[], step: number): { at: V3; clearance: number } | null {
  if (!(step > 0)) throw new RangeError(`organ-fit-hole: step ${step}`);
  const near = new PointTree(surfaceSamples(mesh, step));
  let best: { at: V3; clearance: number } | null = null;
  for (const [a, b] of lines) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (!(len > 0)) throw new RangeError('organ-fit-hole: a line has no length');
    const d: V3 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
    for (let s = 0; s <= len; s += step) {
      const at: V3 = [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];
      const [ahead, behind] = crossings(mesh, at[0], at[1], at[2], d);
      if (!ahead || !behind || insideMesh(mesh, at[0], at[1], at[2])) continue;
      const clearance = Math.sqrt(near.nearest(at[0], at[1], at[2]).d2);
      if (!best || clearance > best.clearance) best = { at, clearance };
    }
  }
  return best;
}
