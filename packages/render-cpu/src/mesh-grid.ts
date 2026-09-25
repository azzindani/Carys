// Does a straight segment cross a surface? A uniform
// grid over a mesh's triangles, so a segment tests only the triangles in the
// cells it passes. The rig's weights use it with the skin: a vertex follows
// no bone it could reach only through the air outside the body. Pure.

export class TriangleGrid {
  private readonly P: ArrayLike<number>;
  private readonly I: ArrayLike<number>;
  private readonly lo: [number, number, number];
  private readonly n: [number, number, number];
  private readonly cell: number;
  /** per cell, its triangles (first index / 3) */
  private readonly cells = new Map<number, number[]>();
  /** the last segment that tested each triangle, so none is tested twice */
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> }, cell: number) {
    if (!(cell > 0)) throw new RangeError(`mesh-grid-cell: ${cell}`);
    this.P = mesh.positions; this.I = mesh.indices; this.cell = cell;
    const P = this.P, I = this.I, lo: [number, number, number] = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, P[i + k]!); hi[k] = Math.max(hi[k]!, P[i + k]!); }
    this.lo = lo;
    this.n = [0, 1, 2].map((k) => Math.max(1, Math.ceil((hi[k]! - lo[k]!) / cell) + 1)) as [number, number, number];
    this.seen = new Uint32Array(I.length / 3);
    for (let t = 0; t < I.length; t += 3) {
      const a = [0, 1, 2].map((k) => Math.min(P[I[t]! * 3 + k]!, P[I[t + 1]! * 3 + k]!, P[I[t + 2]! * 3 + k]!));
      const b = [0, 1, 2].map((k) => Math.max(P[I[t]! * 3 + k]!, P[I[t + 1]! * 3 + k]!, P[I[t + 2]! * 3 + k]!));
      const c0 = a.map((v, k) => this.at(v, k)), c1 = b.map((v, k) => this.at(v, k));
      for (let x = c0[0]!; x <= c1[0]!; x++) for (let y = c0[1]!; y <= c1[1]!; y++) for (let z = c0[2]!; z <= c1[2]!; z++) {
        const key = (z * this.n[1] + y) * this.n[0] + x, list = this.cells.get(key);
        if (list) list.push(t / 3); else this.cells.set(key, [t / 3]);
      }
    }
  }

  /** The cell index along axis k of coordinate v, clamped to the grid. */
  private at(v: number, k: number): number {
    return Math.min(this.n[k]! - 1, Math.max(0, Math.floor((v - this.lo[k]!) / this.cell)));
  }

  /**
   * Whether the segment from a to b crosses a triangle more than `skip` from
   * a (so a segment starting on the surface does not count its own start).
   */
  crosses(ax: number, ay: number, az: number, bx: number, by: number, bz: number, skip = 0): boolean {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    if (!(len > skip)) return false;
    const dx = (bx - ax) / len, dy = (by - ay) / len, dz = (bz - az) / len;
    if (++this.stamp === 0xffffffff) { this.seen.fill(0); this.stamp = 1; }
    const P = this.P, I = this.I, steps = Math.ceil(len / (this.cell / 2));
    let last = -1;
    for (let i = 0; i <= steps; i++) {
      const s = (len * i) / steps, x = ax + dx * s, y = ay + dy * s, z = az + dz * s;
      // the cells around the point: a segment through a cell's corner may clip its neighbours
      const cx = this.at(x, 0), cy = this.at(y, 1), cz = this.at(z, 2), key = (cz * this.n[1] + cy) * this.n[0] + cx;
      if (key === last) continue;
      last = key;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        const X = cx + ox, Y = cy + oy, Z = cz + oz;
        if (X < 0 || Y < 0 || Z < 0 || X >= this.n[0] || Y >= this.n[1] || Z >= this.n[2]) continue;
        const list = this.cells.get((Z * this.n[1] + Y) * this.n[0] + X);
        if (!list) continue;
        for (const t of list) {
          if (this.seen[t] === this.stamp) continue;
          this.seen[t] = this.stamp;
          const a = I[t * 3]! * 3, b = I[t * 3 + 1]! * 3, c = I[t * 3 + 2]! * 3;
          const e1x = P[b]! - P[a]!, e1y = P[b + 1]! - P[a + 1]!, e1z = P[b + 2]! - P[a + 2]!;
          const e2x = P[c]! - P[a]!, e2y = P[c + 1]! - P[a + 1]!, e2z = P[c + 2]! - P[a + 2]!;
          const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
          const det = e1x * hx + e1y * hy + e1z * hz;
          if (Math.abs(det) < 1e-12) continue;
          const f = 1 / det, sx = ax - P[a]!, sy = ay - P[a + 1]!, sz = az - P[a + 2]!;
          const u = f * (sx * hx + sy * hy + sz * hz);
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const v = f * (dx * qx + dy * qy + dz * qz);
          if (v < 0 || u + v > 1) continue;
          const d = f * (e2x * qx + e2y * qy + e2z * qz);
          if (d > skip && d < len) return true;
        }
      }
    }
    return false;
  }
}
