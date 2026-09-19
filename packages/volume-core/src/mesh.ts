// Ported from NiiVue nvmesh.ts (CPU fields) + nvmesh-types.ts (BSD-2).
// NVMesh without GL: pts/tris/offsetPt0 fence-post decides surface vs fiber.
// Skips: indexBuffer/vertexBuffer/vao (WebGL), mesh-build, decimation.

export type MeshType = 'MESH' | 'CONNECTOME' | 'FIBER';

export interface MeshLayer {
  name: string;
  opacity: number;
  colormap: string;
  values: Float32Array;
  global_min: number;
  global_max: number;
  cal_min: number;
  cal_max: number;
  frame4D: number;
}

export interface Mesh {
  id: string;
  name: string;
  /** xyz triplets */
  pts: Float32Array;
  /** triangle indices; absent for fibers */
  tris?: Uint32Array;
  /** fence-posted streamline offsets; null = surface, set = fiber */
  offsetPt0: Uint32Array | null;
  layers: MeshLayer[];
  rgba255: Uint8Array;
  opacity: number;
  visible: boolean;
  type: MeshType;
}

export function isFiber(m: Mesh): boolean {
  return m.offsetPt0 !== null;
}
