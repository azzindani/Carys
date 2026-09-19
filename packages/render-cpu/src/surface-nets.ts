// Naive surface nets — smooth isosurface without lookup tables.
// Per cell with a sign change: vertex at mean of edge zero-crossings.
// Per sign-changing grid edge: quad joining the 4 adjacent cell vertices,
// flipped so the geometric normal points outward (away from foreground).
// Vertex normals = area-weighted face averages (smooth shading).
import type { TriMesh } from './surface.js';

export function surfaceNets(
  field: ArrayLike<number>,
  nx: number, ny: number, nz: number,
  iso: number,
): TriMesh {
  const F = (x: number, y: number, z: number): number => field[z * nx * ny + y * nx + x]!;
  const inside = (x: number, y: number, z: number): boolean => F(x, y, z) > iso;

  // Pass 1: one vertex per sign-changing cell.
  const cellVert = new Map<number, number>();
  const positions: number[] = [];
  const cx = nx - 1, cy = ny - 1;
  const cellId = (x: number, y: number, z: number): number => x + y * cx + z * cx * cy;
  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          if (inside(x + (c & 1), y + ((c >> 1) & 1), z + ((c >> 2) & 1))) mask |= 1 << c;
        }
        if (mask === 0 || mask === 0xff) continue;
        // mean of linearly-interpolated zero crossings on the 12 edges
        const E: [number, number, number, number, number, number][] = [
          [0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1],
          [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1],
          [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1],
        ];
        let px = 0, py = 0, pz = 0, cnt = 0;
        for (const [ax, ay, az, bx, by, bz] of E) {
          const va = F(x + ax, y + ay, z + az) - iso;
          const vb = F(x + bx, y + by, z + bz) - iso;
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          px += x + ax + t * (bx - ax);
          py += y + ay + t * (by - ay);
          pz += z + az + t * (bz - az);
          cnt++;
        }
        if (cnt === 0) continue;
        cellVert.set(cellId(x, y, z), positions.length / 3);
        positions.push(px / cnt, py / cnt, pz / cnt);
      }
    }
  }

  // Pass 2: quads around sign-changing grid edges.
  const quads: number[][] = [];
  const edgeDirs: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        for (const [dx, dy, dz] of edgeDirs) {
          const x2 = x + dx, y2 = y + dy, z2 = z + dz;
          if (x2 >= nx || y2 >= ny || z2 >= nz) continue;
          const a = inside(x, y, z), b = inside(x2, y2, z2);
          if (a === b) continue;
          // 4 cells sharing this edge (cycle), vertex ids
          let cells: [number, number, number][];
          if (dx === 1) cells = [[x, y - 1, z - 1], [x, y, z - 1], [x, y, z], [x, y - 1, z]];
          else if (dy === 1) cells = [[x - 1, y, z - 1], [x - 1, y, z], [x, y, z], [x, y, z - 1]];
          else cells = [[x - 1, y - 1, z], [x, y - 1, z], [x, y, z], [x - 1, y, z]];
          const vs = cells.map(([qx, qy, qz]) =>
            qx < 0 || qy < 0 || qz < 0 || qx >= nx - 1 || qy >= ny - 1 || qz >= nz - 1
              ? -1 : (cellVert.get(cellId(qx, qy, qz)) ?? -1),
          );
          if (vs.some((v) => v < 0)) continue;
          // outward hint: from inside endpoint toward outside endpoint
          const hint: [number, number, number] = a
            ? [dx, dy, dz] : [-dx, -dy, -dz];
          quads.push([vs[0]!, vs[1]!, vs[2]!, vs[3]!, hint[0], hint[1], hint[2]]);
        }
      }
    }
  }

  const sub = (a: number[], b: number[]): number[] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
  const cross = (a: number[], b: number[]): number[] => [
    a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  const P = (i: number): number[] => [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
  const indices: number[] = [];
  const normals = new Float64Array(positions.length);
  for (const [a, b, c, d, hx, hy, hz] of quads) {
    const n = cross(sub(P(b!), P(a!)), sub(P(c!), P(a!)));
    const dot = n[0]! * hx! + n[1]! * hy! + n[2]! * hz!;
    const [i0, i1, i2, i3] = dot < 0 ? [a, d, c, b] : [a, b, c, d];
    indices.push(i0!, i1!, i2!, i0!, i2!, i3!);
    const area = Math.hypot(n[0]!, n[1]!, n[2]!) / 2;
    const un = [n[0]! / (area * 2 || 1), n[1]! / (area * 2 || 1), n[2]! / (area * 2 || 1)];
    const s = dot < 0 ? -1 : 1;
    for (const v of [i0!, i1!, i2!, i3!]) {
      normals[v * 3]! += s * un[0]! * area;
      normals[v * 3 + 1]! += s * un[1]! * area;
      normals[v * 3 + 2]! += s * un[2]! * area;
    }
  }
  const nn = new Float32Array(normals.length);
  for (let i = 0; i < nn.length; i += 3) {
    const l = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
    nn[i] = normals[i]! / l; nn[i + 1] = normals[i + 1]! / l; nn[i + 2] = normals[i + 2]! / l;
  }
  return {
    positions: Float32Array.from(positions),
    normals: nn,
    indices: Uint32Array.from(indices),
  };
}
