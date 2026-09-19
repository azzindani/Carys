// Boundary-face surface extraction (cuberille) — no lookup tables.
// For each foreground voxel, emit a quad (2 triangles) per exposed -x/+x/
// -y/+y/-z/+z face, CCW from outside. Chunky but watertight and obviously
// correct; winding is verified by test (geometric normal == face normal).
// Marching cubes can replace this later for smooth isosurfaces.

export interface TriMesh {
  positions: Float32Array; // 3 per vertex
  normals: Float32Array; // 3 per vertex (flat face normals)
  indices: Uint32Array; // 3 per triangle
}

type V3 = [number, number, number];

// Each face: outward normal + 4 corners CCW seen from outside.
const FACES: { n: V3; corners: [V3, V3, V3, V3] }[] = [
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 1, 0], corners: [[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]] },
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
];

const NEIGHBOR: V3[] = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];

export function extractBoundary(
  data: ArrayLike<number>,
  nx: number, ny: number, nz: number,
  threshold = 0,
): TriMesh {
  const at = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return false;
    return data[z * nx * ny + y * nx + x]! > threshold;
  };
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (!at(x, y, z)) continue;
        for (let f = 0; f < 6; f++) {
          const d = NEIGHBOR[f]!;
          if (at(x + d[0], y + d[1], z + d[2])) continue;
          const face = FACES[f]!;
          const base = positions.length / 3;
          for (const c of face.corners) {
            positions.push(x + c[0], y + c[1], z + c[2]);
            normals.push(...face.n);
          }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
  };
}

export function meshTriangleCount(m: TriMesh): number {
  return m.indices.length / 3;
}
