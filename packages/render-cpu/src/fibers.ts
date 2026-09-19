// CPU streamline projection: same orbit/tilt, framing and screen mapping as
// the mesh rasterizer (raster.ts), drawn as 2D polylines by the caller
// (direction-colored per segment, tractography convention). Points are
// expected in viewBox voxel coords — see fitPointsToBox, the positions-only
// sibling of fitMeshToBox. Pure, worker-safe, no DOM.
export interface FiberPathsOpts {
  width: number;
  height: number;
  angleY: number;
  tiltX: number;
  zoom?: number;
  /** rotation center in voxel coords; default = volume center. Must match
   *  the raster.ts center used for the mesh so fibers overlay it. */
  center?: [number, number, number];
}

export interface FiberPoint {
  x: number;
  y: number;
  /** view depth: larger = nearer (camera looks along -z, like raster.ts) */
  z: number;
}

/**
 * Uniform-scale + recenter points into a voxel viewBox (fitMeshToBox for
 * bare point clouds such as TCK streamlines in scanner space).
 */
export function fitPointsToBox(pts: Float32Array, dims: [number, number, number]): Float32Array {
  if (pts.length === 0) throw new Error('empty point cloud has no bounding box');
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i]!, y = pts[i + 1]!, z = pts[i + 2]!;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const span = Math.max(x1 - x0, y1 - y0, z1 - z0, 1e-9);
  const target = Math.max(...dims) * 0.7;
  const s = target / span;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 3) {
    out[i] = (pts[i]! - cx) * s + dims[0] / 2;
    out[i + 1] = (pts[i + 1]! - cy) * s + dims[1] / 2;
    out[i + 2] = (pts[i + 2]! - cz) * s + dims[2] / 2;
  }
  return out;
}

/**
 * Project fence-posted streamlines to screen polylines (one array per
 * streamline; empty streamlines give []). Rotation, scale and pixel mapping
 * mirror raster.ts exactly so fibers overlay the mesh view.
 */
export function projectFibers(
  pts: Float32Array,
  offsetPt0: Uint32Array,
  dims: [number, number, number],
  opts: FiberPathsOpts,
): FiberPoint[][] {
  const [nx, ny, nz] = dims;
  const { width: W, height: H, angleY, tiltX } = opts;
  const cy = Math.cos(angleY), sy = Math.sin(angleY);
  const cx = Math.cos(tiltX), sx = Math.sin(tiltX);
  const maxDim = Math.max(nx, ny, nz);
  const scale = (Math.min(W, H) / maxDim) * 0.92 * (opts.zoom ?? 1);
  const [ccx, ccy, ccz] = opts.center ?? [nx / 2, ny / 2, nz / 2];
  const proj = (x: number, y: number, z: number): FiberPoint => {
    x -= ccx; y -= ccy; z -= ccz;
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const y1 = y * cx - z1 * sx;
    const z2 = y * sx + z1 * cx;
    return { x: W / 2 + x1 * scale, y: H / 2 - y1 * scale, z: z2 };
  };
  const out: FiberPoint[][] = [];
  for (let s = 0; s + 1 < offsetPt0.length; s++) {
    const line: FiberPoint[] = [];
    for (let v = offsetPt0[s]!; v < offsetPt0[s + 1]!; v++) {
      line.push(proj(pts[v * 3]!, pts[v * 3 + 1]!, pts[v * 3 + 2]!));
    }
    out.push(line);
  }
  return out;
}
