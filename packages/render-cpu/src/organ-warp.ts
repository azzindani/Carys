// The non-rigid part of placing one body's organs in another's (H3,
// docs/PHASES.md): after an anchor's similarity (organ-fit.ts), a smooth
// bend takes it the rest of the way — bowel loops, a bronchus branching at
// another angle, a knee flexed a little differently.
//
// The bend is a composition of small steps, p ← p + d_k(p). Each step's
// displacement is a sum of Wendland's compactly supported radial functions
// ψ(r) = (1 − r/R)⁴(4r/R + 1) (C², positive definite in 3-D; Wendland
// 1995) on nodes spread over the organ where it is now: exactly zero past a
// node's radius R, so a bend moves nothing far from its organ. Each step is
// one round of non-rigid ICP — pair samples (both ways where both surfaces
// are whole, the worst pairs dropped), then weights by regularised least
// squares, ‖Φw − r‖² + λ·wᵀGw (G the nodes' Gram matrix: the displacement's
// norm in the kernel's space, the motion coherence of Myronenko & Song's
// coherent point drift), by conjugate gradients on the sparse system.
// A step's gradient is capped (‖∇d‖_F ≤ GRAD_MAX at every sample), so
// det(I + ∇d) ≥ (1 − GRAD_MAX)³ > 0: every step, and so the whole bend,
// is one-to-one on the organ — surfaces are pulled onto their match, never
// folded through each other. Radii go coarse to fine. Pure, no DOM.

import { PointTree, type Bend } from './organ-fit.js';

type V3 = [number, number, number];

/** Wendland ψ₃,₁ at distance r, support radius R. */
export function wendland(r: number, R: number): number {
  if (r >= R) return 0;
  const q = r / R, u = 1 - q;
  return u * u * u * u * (4 * q + 1);
}

/** Largest gradient (Frobenius norm) a step may have at any sample. */
export const GRAD_MAX = 0.5;

/** One step: its radius, nodes and weights (3 per node). */
export interface WarpStep {
  radius: number;
  nodes: Float64Array;
  w: Float64Array;
}

/** A step's nodes hashed into cells one radius wide (the nodes within R of
 *  a point lie in its cell and the 26 around it), and their box grown by R:
 *  outside it the step does nothing. */
class StepField {
  private readonly cells = new Map<number, number[]>();
  private readonly lo: V3 = [Infinity, Infinity, Infinity];
  private readonly hi: V3 = [-Infinity, -Infinity, -Infinity];
  readonly R: number;
  private readonly n: Float64Array;
  private readonly w: Float64Array;

  constructor(s: WarpStep) {
    this.R = s.radius; this.n = s.nodes; this.w = s.w;
    for (let j = 0; j < s.nodes.length / 3; j++) {
      const x = s.nodes[j * 3]!, y = s.nodes[j * 3 + 1]!, z = s.nodes[j * 3 + 2]!;
      const k = this.key(x, y, z, 0, 0, 0);
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(j);
      const p = [x, y, z];
      for (let a = 0; a < 3; a++) { this.lo[a] = Math.min(this.lo[a]!, p[a]! - this.R); this.hi[a] = Math.max(this.hi[a]!, p[a]! + this.R); }
    }
  }

  private key(x: number, y: number, z: number, dx: number, dy: number, dz: number): number {
    const B = 4096, H = 2048, R = this.R;
    return ((Math.floor(x / R) + dx + H) * B + (Math.floor(y / R) + dy + H)) * B + (Math.floor(z / R) + dz + H);
  }

  /** Each node within R of p: its index, p − c and |p − c|. */
  around(x: number, y: number, z: number, each: (j: number, dx: number, dy: number, dz: number, r: number) => void): void {
    if (x < this.lo[0] || y < this.lo[1] || z < this.lo[2] || x > this.hi[0] || y > this.hi[1] || z > this.hi[2]) return;
    const n = this.n, R2 = this.R * this.R;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (let c = -1; c <= 1; c++) {
          const list = this.cells.get(this.key(x, y, z, a, b, c));
          if (!list) continue;
          for (const j of list) {
            const dx = x - n[j * 3]!, dy = y - n[j * 3 + 1]!, dz = z - n[j * 3 + 2]!, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < R2) each(j, dx, dy, dz, Math.sqrt(d2));
          }
        }
      }
    }
  }

  /** The displacement at p, added into `out`. */
  add(x: number, y: number, z: number, out: V3): void {
    const R = this.R, w = this.w;
    this.around(x, y, z, (j, _dx, _dy, _dz, r) => {
      const s = wendland(r, R);
      out[0] += s * w[j * 3]!; out[1] += s * w[j * 3 + 1]!; out[2] += s * w[j * 3 + 2]!;
    });
  }

  /** ∇d at p (row: component, column: derivative), added into `g`. */
  grad(x: number, y: number, z: number, g: number[]): void {
    const R = this.R, w = this.w;
    this.around(x, y, z, (j, dx, dy, dz, r) => {
      // ∇ψ = −20 (1 − r/R)³ (p − c) / R²
      const u = 1 - r / R, k = (-20 * u * u * u) / (R * R), d = [k * dx, k * dy, k * dz];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) g[a * 3 + b]! += w[j * 3 + a]! * d[b]!;
    });
  }
}

const det3 = (J: number[]): number =>
  J[0]! * (J[4]! * J[8]! - J[5]! * J[7]!) - J[1]! * (J[3]! * J[8]! - J[5]! * J[6]!) + J[2]! * (J[3]! * J[7]! - J[4]! * J[6]!);

/** A bend: its steps applied in turn. */
export class Warp implements Bend {
  private readonly fields: StepField[];

  constructor(readonly steps: readonly WarpStep[]) {
    this.fields = steps.map((s) => new StepField(s));
  }

  /** Move p (in place) through every step. */
  map(p: V3): V3 {
    const d: V3 = [0, 0, 0];
    for (const f of this.fields) {
      d[0] = d[1] = d[2] = 0;
      f.add(p[0], p[1], p[2], d);
      p[0] += d[0]; p[1] += d[1]; p[2] += d[2];
    }
    return p;
  }

  apply(points: ArrayLike<number>): Float64Array {
    const out = new Float64Array(points.length), p: V3 = [0, 0, 0];
    for (let i = 0; i < points.length; i += 3) {
      p[0] = points[i]!; p[1] = points[i + 1]!; p[2] = points[i + 2]!;
      this.map(p);
      out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
    }
    return out;
  }

  /** det of the bend's Jacobian at p (the product over its steps): 1
   *  unbent, below 1 squeezed, ≤ 0 folded. */
  jacobianDet(x: number, y: number, z: number): number {
    const p: V3 = [x, y, z], d: V3 = [0, 0, 0];
    let det = 1;
    for (const f of this.fields) {
      const g = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      f.grad(p[0], p[1], p[2], g);
      det *= det3(g);
      d[0] = d[1] = d[2] = 0;
      f.add(p[0], p[1], p[2], d);
      p[0] += d[0]; p[1] += d[1]; p[2] += d[2];
    }
    return det;
  }
}

/** Nodes over a sample set: the first sample in each cube `step` wide. */
export function spreadNodes(samples: Float64Array, step: number): Float64Array {
  const seen = new Set<string>(), out: number[] = [];
  for (let i = 0; i < samples.length; i += 3) {
    const k = `${Math.floor(samples[i]! / step)},${Math.floor(samples[i + 1]! / step)},${Math.floor(samples[i + 2]! / step)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(samples[i]!, samples[i + 1]!, samples[i + 2]!);
  }
  return Float64Array.from(out);
}

export interface WarpOpts {
  /** support radius of each level, coarse to fine (mm) */
  radii: readonly number[];
  /** node spacing as a share of the level's radius */
  spacing: number;
  /** ICP rounds (steps) per level */
  iterations: number;
  /** share of the pairs kept each round, nearest first */
  keep: number;
  /** smoothness: λ, relative to how many pairs each node carries */
  lambda: number;
}

/** The coarsest bend that brings every H3 anchor within the 5 mm bound
 *  (worst 3.7 mm): finer levels (24 mm) or a looser λ fit closer still,
 *  but by squeezing the bowel's surface to a few percent of its volume. */
export const WARP_DEFAULTS: WarpOpts = { radii: [96, 48], spacing: 1 / 3, iterations: 8, keep: 0.9, lambda: 1 };

/** Conjugate gradients stop at a residual this share of the right side, or
 *  after this many steps. */
const CG_TOL = 1e-6, CG_MAX = 400;

/** Sparse rows: for each row, its column indices and values. */
interface Rows { col: Int32Array[]; val: Float64Array[] }

function rowsOf(points: Float64Array, f: StepField): Rows {
  const col: Int32Array[] = [], val: Float64Array[] = [];
  const cj: number[] = [], cv: number[] = [];
  for (let i = 0; i < points.length; i += 3) {
    cj.length = 0; cv.length = 0;
    f.around(points[i]!, points[i + 1]!, points[i + 2]!, (j, _dx, _dy, _dz, r) => { cj.push(j); cv.push(wendland(r, f.R)); });
    col.push(Int32Array.from(cj));
    val.push(Float64Array.from(cv));
  }
  return { col, val };
}

/** Solve (ΦᵀΦ + λG + εI) w = Φᵀ t for each coordinate: Jacobi-
 *  preconditioned conjugate gradients. */
function solveStep(phi: Rows, G: Rows, t: Float64Array, lambda: number, m: number): Float64Array {
  const n = phi.col.length, w = new Float64Array(m * 3);
  const diag = new Float64Array(m).fill(1e-9 + lambda); // ψ(0) = 1 on G's diagonal
  for (let i = 0; i < n; i++) { const c = phi.col[i]!, v = phi.val[i]!; for (let k = 0; k < c.length; k++) diag[c[k]!]! += v[k]! * v[k]!; }
  const tmp = new Float64Array(n);
  const mul = (x: Float64Array, out: Float64Array): void => {
    for (let i = 0; i < n; i++) { const c = phi.col[i]!, v = phi.val[i]!; let s = 0; for (let k = 0; k < c.length; k++) s += v[k]! * x[c[k]!]!; tmp[i] = s; }
    out.fill(0);
    for (let i = 0; i < n; i++) { const c = phi.col[i]!, v = phi.val[i]!, s = tmp[i]!; for (let k = 0; k < c.length; k++) out[c[k]!]! += v[k]! * s; }
    for (let j = 0; j < m; j++) {
      const c = G.col[j]!, v = G.val[j]!;
      let s = 1e-9 * x[j]!;
      for (let k = 0; k < c.length; k++) s += lambda * v[k]! * x[c[k]!]!;
      out[j]! += s;
    }
  };
  const x = new Float64Array(m), b = new Float64Array(m), r = new Float64Array(m), z = new Float64Array(m), p = new Float64Array(m), Ap = new Float64Array(m);
  for (let a = 0; a < 3; a++) {
    b.fill(0);
    for (let i = 0; i < n; i++) { const c = phi.col[i]!, v = phi.val[i]!, s = t[i * 3 + a]!; for (let k = 0; k < c.length; k++) b[c[k]!]! += v[k]! * s; }
    x.fill(0);
    let bb = 0, rz = 0;
    for (let j = 0; j < m; j++) { r[j] = b[j]!; z[j] = r[j]! / diag[j]!; p[j] = z[j]!; bb += b[j]! * b[j]!; rz += r[j]! * z[j]!; }
    for (let it = 0; it < CG_MAX; it++) {
      let rr = 0;
      for (let j = 0; j < m; j++) rr += r[j]! * r[j]!;
      if (rr <= CG_TOL * CG_TOL * bb) break;
      mul(p, Ap);
      let pAp = 0;
      for (let j = 0; j < m; j++) pAp += p[j]! * Ap[j]!;
      const alpha = rz / pAp;
      let rz2 = 0;
      for (let j = 0; j < m; j++) { x[j]! += alpha * p[j]!; r[j]! -= alpha * Ap[j]!; z[j] = r[j]! / diag[j]!; rz2 += r[j]! * z[j]!; }
      const beta = rz2 / rz;
      rz = rz2;
      for (let j = 0; j < m; j++) p[j] = z[j]! + beta * p[j]!;
    }
    for (let j = 0; j < m; j++) w[j * 3 + a] = x[j]!;
  }
  return w;
}

/**
 * Bend placed samples `src` onto `dst` (both in the target body's frame) by
 * non-rigid ICP, one capped step per round, level after level. `both`:
 * pair both ways (whole surfaces), else src → dst only (src covers part of
 * dst).
 */
export function icpWarp(src: Float64Array, dst: Float64Array, both: boolean, opts: WarpOpts = WARP_DEFAULTS): Warp {
  if (!src.length || !dst.length || src.length % 3 || dst.length % 3) throw new RangeError(`organ-warp-points: ${src.length}, ${dst.length}`);
  const toDst = new PointTree(dst);
  const moved = Float64Array.from(src);
  const steps: WarpStep[] = [];
  for (const R of opts.radii) {
    if (!(R > 0)) throw new RangeError(`organ-warp-radius: ${R}`);
    for (let it = 0; it < opts.iterations; it++) {
      // pairs: [squared distance, source sample, target point]
      const pairs: [number, number, number][] = [];
      for (let i = 0; i < moved.length / 3; i++) {
        const h = toDst.nearest(moved[i * 3]!, moved[i * 3 + 1]!, moved[i * 3 + 2]!);
        pairs.push([h.d2, i, h.index]);
      }
      if (both) {
        const back = new PointTree(moved);
        for (let j = 0; j < dst.length / 3; j++) {
          const h = back.nearest(dst[j * 3]!, dst[j * 3 + 1]!, dst[j * 3 + 2]!);
          pairs.push([h.d2, h.index, j]);
        }
      }
      const cut = pairs.map((q) => q[0]).sort((u, v) => u - v)[Math.floor((pairs.length - 1) * opts.keep)]!;
      const kept = pairs.filter((q) => q[0] <= cut);
      const nodes = spreadNodes(moved, R * opts.spacing), m = nodes.length / 3;
      const probe = new StepField({ radius: R, nodes, w: new Float64Array(nodes.length) });
      const rows = rowsOf(moved, probe);
      const phi: Rows = { col: [], val: [] };
      const t = new Float64Array(kept.length * 3);
      kept.forEach(([, i, j], k) => {
        phi.col.push(rows.col[i]!);
        phi.val.push(rows.val[i]!);
        for (let c = 0; c < 3; c++) t[k * 3 + c] = dst[j * 3 + c]! - moved[i * 3 + c]!;
      });
      const w = solveStep(phi, rowsOf(nodes, probe), t, opts.lambda * Math.max(1, kept.length / m), m);
      const step: WarpStep = { radius: R, nodes, w };
      // cap the step's gradient over the samples it moves
      const field = new StepField(step);
      let most = 0;
      for (let i = 0; i < moved.length; i += 3) {
        const g = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        field.grad(moved[i]!, moved[i + 1]!, moved[i + 2]!, g);
        most = Math.max(most, Math.hypot(...g));
      }
      if (most > GRAD_MAX) for (let k = 0; k < w.length; k++) w[k]! *= GRAD_MAX / most;
      const d: V3 = [0, 0, 0];
      for (let i = 0; i < moved.length; i += 3) {
        d[0] = d[1] = d[2] = 0;
        field.add(moved[i]!, moved[i + 1]!, moved[i + 2]!, d);
        moved[i]! += d[0]; moved[i + 1]! += d[1]; moved[i + 2]! += d[2];
      }
      steps.push(step);
    }
  }
  return new Warp(steps);
}
