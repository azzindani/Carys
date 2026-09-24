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
 * triangle is cut into n² equal pieces (n from its longest edge) and each
 * piece gives its centroid. Deterministic, area-uniform.
 */
export function surfaceSamples(mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> }, step: number): Float64Array {
  if (!(step > 0)) throw new RangeError(`organ-fit-step: ${step}`);
  const P = mesh.positions, I = mesh.indices, out: number[] = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
    const e = Math.max(
      Math.hypot(P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!),
      Math.hypot(P[c]! - P[b]!, P[c + 1]! - P[b + 1]!, P[c + 2]! - P[b + 2]!),
      Math.hypot(P[a]! - P[c]!, P[a + 1]! - P[c + 1]!, P[a + 2]! - P[c + 2]!),
    );
    const n = Math.max(1, Math.ceil(e / step));
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

/** Nearest-point queries over a fixed point set (a k-d tree). */
export class PointTree {
  private readonly p: Float64Array;
  private readonly order: Uint32Array;
  constructor(points: Float64Array) {
    if (points.length % 3 || !points.length) throw new RangeError(`organ-fit-points: ${points.length} coordinates`);
    this.p = points;
    this.order = Uint32Array.from({ length: points.length / 3 }, (_, i) => i);
    this.build(0, this.order.length, 0);
  }

  private build(lo: number, hi: number, axis: number): void {
    if (hi - lo <= 1) return;
    const mid = (lo + hi) >> 1, p = this.p, o = this.order;
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
    this.build(lo, mid, (axis + 1) % 3);
    this.build(mid + 1, hi, (axis + 1) % 3);
  }

  /** The index of the point nearest (x, y, z), and its squared distance. */
  nearest(x: number, y: number, z: number): { index: number; d2: number } {
    const p = this.p, o = this.order, q = [x, y, z];
    let best = -1, bd = Infinity;
    const walk = (lo: number, hi: number, axis: number): void => {
      if (lo >= hi) return;
      const mid = (lo + hi) >> 1, i = o[mid]! * 3;
      const d2 = (p[i]! - x) ** 2 + (p[i + 1]! - y) ** 2 + (p[i + 2]! - z) ** 2;
      if (d2 < bd) { bd = d2; best = o[mid]!; }
      const diff = q[axis]! - p[i + axis]!, next = (axis + 1) % 3;
      if (diff < 0) { walk(lo, mid, next); if (diff * diff < bd) walk(mid + 1, hi, next); }
      else { walk(mid + 1, hi, next); if (diff * diff < bd) walk(lo, mid, next); }
    };
    walk(0, o.length, 0);
    return { index: best, d2: bd };
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

/** How far (mm) the blend weights 1/(d² + SOFT²) stay finite at d = 0. */
export const FIELD_SOFT_MM = 5;

/**
 * Move points (in the source body's frame) by the anchors' fits blended by
 * nearness: a point on or in an anchor moves (almost) as that anchor does,
 * one between anchors by their mix. Smooth: the weights are.
 */
export function blendField(anchors: readonly FieldAnchor[], points: ArrayLike<number>): Float64Array {
  if (!anchors.length) throw new RangeError('organ-fit-field: no anchors');
  const out = new Float64Array(points.length);
  const soft = FIELD_SOFT_MM ** 2;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i]!, y = points[i + 1]!, z = points[i + 2]!;
    let sw = 0, ax = 0, ay = 0, az = 0;
    for (const a of anchors) {
      const w = 1 / (a.near.nearest(x, y, z).d2 + soft), m = a.fit.m, t = a.fit.t;
      sw += w;
      ax += w * (m[0]! * x + m[1]! * y + m[2]! * z + t[0]);
      ay += w * (m[3]! * x + m[4]! * y + m[5]! * z + t[1]);
      az += w * (m[6]! * x + m[7]! * y + m[8]! * z + t[2]);
    }
    out[i] = ax / sw; out[i + 1] = ay / sw; out[i + 2] = az / sw;
  }
  return out;
}
