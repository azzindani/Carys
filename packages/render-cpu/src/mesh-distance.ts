// Distance between two triangle meshes (both in the same units): from every
// vertex of one to the surface of the other. The decimation tests and the
// body atlas build (H1, scripts/build-body-atlas.mjs) both measure with it.
type V3 = [number, number, number];

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
