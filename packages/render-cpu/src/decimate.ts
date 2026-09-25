// Quadric-error mesh decimation and the level-of-detail chain.
//
// Garland & Heckbert 1997: every vertex carries the sum of the squared
// distance quadrics of its faces' planes; an edge collapses to the point
// minimising the merged quadric, cheapest first. The cost is then the sum
// of squared distances from the new vertex to every original plane it
// stands for, so stopping at `maxError`² keeps each of them within
// `maxError` — a bound in the mesh's own units (the app decimates in mm).
//
// A collapse is refused when it would pinch the surface (the link
// condition: the edge's ends share exactly the neighbours its faces
// give them), turn a face over, or touch a non-manifold edge (four faces
// where two parts of a mask meet; those vertices stay put). Open borders
// carry a heavy quadric of the plane through the border edge across its
// face, so a border keeps its line.
//
// `lodChain` runs one decimation and snapshots the mesh each time it
// passes a quarter of the previous level: every level is measured against
// the full mesh, not the level before.
import type { TriMesh } from './surface.js';
import { vertexNormals } from './mesh-smooth.js';

export interface DecimateOpts {
  /** stop at this many triangles */
  targetTris: number;
  /** stop before any vertex strays further than this from its planes */
  maxError: number;
}

export interface LodOpts {
  /** the chain ends at a level at or under this many triangles */
  budget: number;
  maxError: number;
}

/** Pieces smaller than this many triangles are kept as they are: they save
 *  nothing, and specks from extraction noise (needles a hundredth of a mm
 *  wide) have no planes a quadric could hold them to. */
const MIN_PIECE_TRIS = 100;
/** A face this thin (twice its area over its longest edge squared) is a
 *  needle: its plane means nothing, so its corners stay put. */
const NEEDLE = 0.02;
/** Border quadrics weigh this much more than a face's plane. */
const BORDER_WEIGHT = 1000;
/** A face whose normal turns further than this (cosine) is refused. */
const MIN_FLIP_COS = 0.2;

/** A min-heap of edge collapses, lazily invalidated by vertex stamps. */
class EdgeHeap {
  cost = new Float64Array(1024);
  u = new Int32Array(1024);
  v = new Int32Array(1024);
  su = new Uint32Array(1024);
  sv = new Uint32Array(1024);
  n = 0;

  push(c: number, u: number, v: number, su: number, sv: number): void {
    if (this.n === this.cost.length) this.grow();
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p]! <= c) break;
      this.set(i, p);
      i = p;
    }
    this.cost[i] = c; this.u[i] = u; this.v[i] = v; this.su[i] = su; this.sv[i] = sv;
  }

  /** Remove the top into slot `out` (index 0 is then refilled). */
  pop(out: { c: number; u: number; v: number; su: number; sv: number }): void {
    out.c = this.cost[0]!; out.u = this.u[0]!; out.v = this.v[0]!; out.su = this.su[0]!; out.sv = this.sv[0]!;
    const last = --this.n;
    if (last === 0) return;
    const c = this.cost[last]!, u = this.u[last]!, v = this.v[last]!, su = this.su[last]!, sv = this.sv[last]!;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      if (l >= last) break;
      const m = r < last && this.cost[r]! < this.cost[l]! ? r : l;
      if (this.cost[m]! >= c) break;
      this.set(i, m);
      i = m;
    }
    this.cost[i] = c; this.u[i] = u; this.v[i] = v; this.su[i] = su; this.sv[i] = sv;
  }

  private set(i: number, j: number): void {
    this.cost[i] = this.cost[j]!; this.u[i] = this.u[j]!; this.v[i] = this.v[j]!; this.su[i] = this.su[j]!; this.sv[i] = this.sv[j]!;
  }

  private grow(): void {
    const k = this.cost.length * 2;
    const g = <T extends Float64Array | Int32Array | Uint32Array>(a: T, ctor: new (n: number) => T): T => { const b = new ctor(k); b.set(a); return b; };
    this.cost = g(this.cost, Float64Array); this.u = g(this.u, Int32Array); this.v = g(this.v, Int32Array);
    this.su = g(this.su, Uint32Array); this.sv = g(this.sv, Uint32Array);
  }
}

/** Add w·(plane)(plane)ᵀ to the 10-entry symmetric quadric at q[o]. */
function addPlane(q: Float64Array, o: number, a: number, b: number, c: number, d: number, w: number): void {
  q[o]! += w * a * a; q[o + 1]! += w * a * b; q[o + 2]! += w * a * c; q[o + 3]! += w * a * d;
  q[o + 4]! += w * b * b; q[o + 5]! += w * b * c; q[o + 6]! += w * b * d;
  q[o + 7]! += w * c * c; q[o + 8]! += w * c * d; q[o + 9]! += w * d * d;
}

/** vᵀQv for v = (x, y, z, 1). */
function quadricAt(q: ArrayLike<number>, x: number, y: number, z: number): number {
  return q[0]! * x * x + 2 * q[1]! * x * y + 2 * q[2]! * x * z + 2 * q[3]! * x
    + q[4]! * y * y + 2 * q[5]! * y * z + 2 * q[6]! * y
    + q[7]! * z * z + 2 * q[8]! * z + q[9]!;
}

/**
 * Run the decimation, calling `snap` with the current mesh whenever the
 * live triangle count first falls to each of `stops` (descending).
 */
function run(mesh: TriMesh, stops: number[], maxError: number, snap: (m: TriMesh) => void): void {
  const nv = mesh.positions.length / 3, nf = mesh.indices.length / 3;
  const P = Float64Array.from(mesh.positions);
  const F = Int32Array.from(mesh.indices);
  const faceAlive = new Uint8Array(nf).fill(1);
  const alive = new Uint8Array(nv).fill(1), stamp = new Uint32Array(nv), locked = new Uint8Array(nv), border = new Uint8Array(nv);
  const Q = new Float64Array(nv * 10);
  const vf: number[][] = Array.from({ length: nv }, () => []);
  for (let f = 0; f < nf; f++) {
    const a = F[f * 3]!, b = F[f * 3 + 1]!, c = F[f * 3 + 2]!;
    vf[a]!.push(f); vf[b]!.push(f); vf[c]!.push(f);
    const ux = P[b * 3]! - P[a * 3]!, uy = P[b * 3 + 1]! - P[a * 3 + 1]!, uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const wx = P[c * 3]! - P[a * 3]!, wy = P[c * 3 + 1]! - P[a * 3 + 1]!, wz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz);
    const vx = wx - ux, vy = wy - uy, vz = wz - uz;
    const longest = Math.max(ux * ux + uy * uy + uz * uz, wx * wx + wy * wy + wz * wz, vx * vx + vy * vy + vz * vz);
    if (l <= NEEDLE * longest) { locked[a] = 1; locked[b] = 1; locked[c] = 1; }
    if (l === 0) continue;
    nx /= l; ny /= l; nz /= l;
    const d = -(nx * P[a * 3]! + ny * P[a * 3 + 1]! + nz * P[a * 3 + 2]!);
    addPlane(Q, a * 10, nx, ny, nz, d, 1); addPlane(Q, b * 10, nx, ny, nz, d, 1); addPlane(Q, c * 10, nx, ny, nz, d, 1);
  }
  // small pieces: union-find over the faces' vertices, then lock them
  const root = Int32Array.from({ length: nv }, (_, i) => i);
  const find = (x: number): number => { while (root[x] !== x) { root[x] = root[root[x]!]!; x = root[x]!; } return x; };
  for (let f = 0; f < nf; f++) {
    const a = find(F[f * 3]!);
    root[find(F[f * 3 + 1]!)] = a;
    root[find(F[f * 3 + 2]!)] = a;
  }
  const pieceTris = new Uint32Array(nv);
  for (let f = 0; f < nf; f++) pieceTris[find(F[f * 3]!)]!++;
  for (let v = 0; v < nv; v++) if (pieceTris[find(v)]! < MIN_PIECE_TRIS) locked[v] = 1;
  // undirected edges and how many faces use each: 1 border, 2 interior,
  // more non-manifold
  const keys = new Float64Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const a = F[f * 3 + k]!, b = F[f * 3 + ((k + 1) % 3)]!;
      keys[f * 3 + k] = Math.min(a, b) * nv + Math.max(a, b);
    }
  }
  const sorted = Float64Array.from(keys).sort();
  const uses = new Map<number, number>();
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j] === sorted[i]) j++;
    if (j - i !== 2) uses.set(sorted[i]!, j - i);
    i = j;
  }
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const count = uses.get(keys[f * 3 + k]!);
      if (count === undefined) continue;
      const a = F[f * 3 + k]!, b = F[f * 3 + ((k + 1) % 3)]!;
      if (count > 2) { locked[a] = 1; locked[b] = 1; continue; }
      border[a] = 1; border[b] = 1;
      // a border: the plane through the edge, across its face
      const c = F[f * 3 + ((k + 2) % 3)]!;
      const ex = P[b * 3]! - P[a * 3]!, ey = P[b * 3 + 1]! - P[a * 3 + 1]!, ez = P[b * 3 + 2]! - P[a * 3 + 2]!;
      const cx = P[c * 3]! - P[a * 3]!, cy = P[c * 3 + 1]! - P[a * 3 + 1]!, cz = P[c * 3 + 2]! - P[a * 3 + 2]!;
      const fx = ey * cz - ez * cy, fy = ez * cx - ex * cz, fz = ex * cy - ey * cx;
      let px = ey * fz - ez * fy, py = ez * fx - ex * fz, pz = ex * fy - ey * fx;
      const l = Math.hypot(px, py, pz);
      if (l === 0) continue;
      px /= l; py /= l; pz /= l;
      const d = -(px * P[a * 3]! + py * P[a * 3 + 1]! + pz * P[a * 3 + 2]!);
      addPlane(Q, a * 10, px, py, pz, d, BORDER_WEIGHT);
      addPlane(Q, b * 10, px, py, pz, d, BORDER_WEIGHT);
    }
  }

  const qs = new Float64Array(10);
  const best = new Float64Array(3);
  /** Cheapest point for collapsing u and v into `best`; returns its cost. */
  const plan = (u: number, v: number): number => {
    for (let i = 0; i < 10; i++) qs[i] = Q[u * 10 + i]! + Q[v * 10 + i]!;
    const a = qs[0]!, b = qs[1]!, c = qs[2]!, e = qs[4]!, f = qs[5]!, h = qs[7]!;
    const det = a * (e * h - f * f) - b * (b * h - f * c) + c * (b * f - e * c);
    const scale = Math.abs(a) + Math.abs(e) + Math.abs(h);
    if (Math.abs(det) > 1e-9 * scale * scale * scale) {
      // solve the 3×3 system A p = −(q3, q6, q8) by Cramer's rule
      const r0 = -qs[3]!, r1 = -qs[6]!, r2 = -qs[8]!;
      best[0] = (r0 * (e * h - f * f) - b * (r1 * h - f * r2) + c * (r1 * f - e * r2)) / det;
      best[1] = (a * (r1 * h - f * r2) - r0 * (b * h - f * c) + c * (b * r2 - r1 * c)) / det;
      best[2] = (a * (e * r2 - r1 * f) - b * (b * r2 - r1 * c) + r0 * (b * f - e * c)) / det;
      // a solve far outside the edge is ill-conditioned: fall back
      const mx = (P[u * 3]! + P[v * 3]!) / 2, my = (P[u * 3 + 1]! + P[v * 3 + 1]!) / 2, mz = (P[u * 3 + 2]! + P[v * 3 + 2]!) / 2;
      const len = Math.hypot(P[u * 3]! - P[v * 3]!, P[u * 3 + 1]! - P[v * 3 + 1]!, P[u * 3 + 2]! - P[v * 3 + 2]!);
      if (Math.hypot(best[0]! - mx, best[1]! - my, best[2]! - mz) <= 2 * len) return Math.max(0, quadricAt(qs, best[0]!, best[1]!, best[2]!));
    }
    let cost = Infinity;
    for (const t of [0, 0.5, 1]) {
      const x = P[u * 3]! + (P[v * 3]! - P[u * 3]!) * t, y = P[u * 3 + 1]! + (P[v * 3 + 1]! - P[u * 3 + 1]!) * t, z = P[u * 3 + 2]! + (P[v * 3 + 2]! - P[u * 3 + 2]!) * t;
      const q = quadricAt(qs, x, y, z);
      if (q < cost) { cost = q; best[0] = x; best[1] = y; best[2] = z; }
    }
    return Math.max(0, cost);
  };

  const heap = new EdgeHeap();
  const limit = maxError * maxError;
  const pushEdge = (u: number, v: number): void => {
    if (locked[u] || locked[v]) return;
    // an edge over the bound can never collapse: the run stops at the first
    const c = plan(u, v);
    if (c <= limit) heap.push(c, u, v, stamp[u]!, stamp[v]!);
  };
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const a = F[f * 3 + k]!, b = F[f * 3 + ((k + 1) % 3)]!;
      // each edge once: from the face where it runs low → high, or its only face
      if (a < b || uses.get(keys[f * 3 + k]!) === 1) pushEdge(a, b);
    }
  }

  const neighbours = (w: number, into: Set<number>): void => {
    into.clear();
    for (const f of vf[w]!) {
      if (!faceAlive[f]) continue;
      for (let k = 0; k < 3; k++) { const x = F[f * 3 + k]!; if (x !== w) into.add(x); }
    }
  };
  /** Would moving w to `best` (with `other` merged in) turn a face over? */
  const flips = (w: number, other: number): boolean => {
    const bx = best[0]!, by = best[1]!, bz = best[2]!;
    for (const f of vf[w]!) {
      if (!faceAlive[f]) continue;
      const a = F[f * 3]!, b = F[f * 3 + 1]!, c = F[f * 3 + 2]!;
      if (a === other || b === other || c === other) continue;
      // the face's other two corners, in winding order after w
      const i = a === w ? 0 : b === w ? 1 : 2;
      const p = F[f * 3 + ((i + 1) % 3)]! * 3, q = F[f * 3 + ((i + 2) % 3)]! * 3;
      const px = P[p]!, py = P[p + 1]!, pz = P[p + 2]!, qx = P[q]!, qy = P[q + 1]!, qz = P[q + 2]!;
      const wx = P[w * 3]!, wy = P[w * 3 + 1]!, wz = P[w * 3 + 2]!;
      // normal before: (p − w) × (q − w); after: (p − best) × (q − best)
      const o = cross(px - wx, py - wy, pz - wz, qx - wx, qy - wy, qz - wz);
      const m = cross(px - bx, py - by, pz - bz, qx - bx, qy - by, qz - bz);
      const lo = Math.hypot(o[0], o[1], o[2]), lm = Math.hypot(m[0], m[1], m[2]);
      if (lm <= 1e-12 * (lo + 1e-30) || o[0] * m[0] + o[1] * m[1] + o[2] * m[2] < MIN_FLIP_COS * lo * lm) return true;
    }
    return false;
  };

  let live = nf, next = 0;
  const top = { c: 0, u: 0, v: 0, su: 0, sv: 0 };
  const nu = new Set<number>(), nvs = new Set<number>();
  const emit = (): void => { snap(compact(P, F, faceAlive)); next++; };
  while (next < stops.length && live <= stops[next]!) emit();
  while (next < stops.length && heap.n > 0) {
    heap.pop(top);
    const { u, v } = top;
    if (!alive[u] || !alive[v] || stamp[u] !== top.su || stamp[v] !== top.sv) continue;
    if (top.c > limit) break;
    // link condition: shared neighbours are exactly the shared faces' apexes
    neighbours(u, nu);
    neighbours(v, nvs);
    let shared = 0;
    for (const x of nu) if (nvs.has(x)) shared++;
    let edgeFaces = 0;
    for (const f of vf[u]!) if (faceAlive[f] && (F[f * 3] === v || F[f * 3 + 1] === v || F[f * 3 + 2] === v)) edgeFaces++;
    if (edgeFaces === 0 || shared !== edgeFaces) continue;
    // two border vertices joined across the inside would pinch the border
    if (edgeFaces === 2 && border[u] && border[v]) continue;
    plan(u, v);
    if (flips(u, v) || flips(v, u)) continue;
    // collapse v into u at the planned point
    P[u * 3] = best[0]!; P[u * 3 + 1] = best[1]!; P[u * 3 + 2] = best[2]!;
    for (let i = 0; i < 10; i++) Q[u * 10 + i]! += Q[v * 10 + i]!;
    const merged: number[] = [];
    for (const f of vf[u]!) {
      if (!faceAlive[f]) continue;
      if (F[f * 3] === v || F[f * 3 + 1] === v || F[f * 3 + 2] === v) { faceAlive[f] = 0; live--; } else merged.push(f);
    }
    for (const f of vf[v]!) {
      if (!faceAlive[f]) continue;
      for (let k = 0; k < 3; k++) if (F[f * 3 + k] === v) F[f * 3 + k] = u;
      merged.push(f);
    }
    vf[u] = merged; vf[v] = [];
    alive[v] = 0;
    stamp[u]!++;
    neighbours(u, nu);
    for (const w of nu) pushEdge(u, w);
    while (next < stops.length && live <= stops[next]!) emit();
  }
  // the bound or the surface stopped it early: the rest of the stops get
  // the mesh as it stands
  if (next < stops.length) snap(compact(P, F, faceAlive));
}

function cross(ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number, number] {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

/** The live faces, their vertices renumbered, normals from the winding. */
function compact(P: Float64Array, F: Int32Array, faceAlive: Uint8Array): TriMesh {
  const remap = new Int32Array(P.length / 3).fill(-1);
  const idx: number[] = [], pos: number[] = [];
  for (let f = 0; f < faceAlive.length; f++) {
    if (!faceAlive[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = F[f * 3 + k]!;
      if (remap[v] === -1) { remap[v] = pos.length / 3; pos.push(P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!); }
      idx.push(remap[v]!);
    }
  }
  const positions = Float32Array.from(pos), indices = Uint32Array.from(idx);
  return { positions, normals: Float32Array.from(vertexNormals(positions, indices)), indices };
}

/**
 * Decimate to `targetTris` or until the next collapse would move a vertex
 * more than `maxError` from its original planes, whichever comes first.
 * Throws `decimate-opts` on a non-positive target or bound.
 */
export function decimate(mesh: TriMesh, opts: DecimateOpts): TriMesh {
  if (!(opts.targetTris >= 1) || !(opts.maxError > 0)) throw new RangeError(`decimate-opts: ${opts.targetTris} tris, ${opts.maxError}`);
  let out: TriMesh | null = null;
  run(mesh, [opts.targetTris], opts.maxError, (m) => { out = m; });
  return out!;
}

/**
 * Coarser levels of `mesh`, each about a quarter of the one before, from a
 * single decimation of the full mesh, ending at the first level within
 * `budget` triangles. Empty when the mesh is within budget already; ends
 * early when `maxError` stops the decimation (its last level is then the
 * coarsest the bound allows). A level that saves under a third of the one
 * before is not worth keeping and is dropped.
 */
export function lodChain(mesh: TriMesh, opts: LodOpts): TriMesh[] {
  if (!(opts.budget >= 1) || !(opts.maxError > 0)) throw new RangeError(`decimate-opts: ${opts.budget} tris, ${opts.maxError}`);
  const tris = mesh.indices.length / 3;
  if (tris <= opts.budget) return [];
  const stops: number[] = [];
  // quarters of the full count, down to the first within budget
  for (let t = tris; t > opts.budget;) { t = Math.max(1, Math.floor(t / 4)); stops.push(t); }
  const levels: TriMesh[] = [];
  run(mesh, stops, opts.maxError, (m) => {
    const prev = levels.length ? levels[levels.length - 1]!.indices.length : mesh.indices.length;
    if (m.indices.length * 3 <= prev * 2) levels.push(m);
  });
  return levels;
}
