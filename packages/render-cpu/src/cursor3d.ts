// V2 NiiVue-studied 3D cursor (REFERENCE → engine-pure).
// Studied: NiiVue (BSD-2-Clause, Regents/partials — LICENSE verified
// 2026-09-18 from the live repo file): the 3D render view draws the
// crosshair position, so a 2D tap is visible in 3D. What we PORT is only
// the math contract: voxel → screen under the orbit/tilt/framing our
// rasterizer already uses. Rotation, scale, and pixel mapping mirror
// raster.ts renderMesh + fibers.ts projectFibers EXACTLY (same center,
// same 0.92 framing, same W/2+H/2 mapping) so the cursor lands on the
// mesh/fiber pixel it names — cross-module parity is tested, not hoped.
// What stays out: drawing (chrome concern), occlusion/depth peeling (a
// renderer concern — the z returned is view depth for the caller to sort
// by), world/mm units (our lanes are voxel-space; spacing rides Volume).

/** Voxel coords of the synced crosshair (session.crosshair shape). */
export type Voxel3 = [number, number, number];
/** Volume dims (layout.js Dims3 shape, re-declared to keep this module import-free). */
export type CursorDims = [number, number, number];

export interface CursorOpts {
  width: number;
  height: number;
  angleY: number; // orbit radians (same as RasterOpts)
  tiltX: number; // tilt radians (same as RasterOpts)
  zoom?: number; // view multiplier, default 1
  /** rotation center in voxel coords; default = volume center */
  center?: Voxel3;
}

export interface CursorPoint {
  /** screen x px */
  x: number;
  /** screen y px */
  y: number;
  /** view depth: larger = nearer (camera looks along -z, like raster.ts) */
  z: number;
}

function checkedDims(dims: CursorDims): void {
  if (!dims.every((d) => Number.isFinite(d) && d > 0)) {
    throw new RangeError(`cursor3d-dims: [${dims}]`);
  }
}

function checkedOpts(o: CursorOpts): void {
  if (!(o.width > 0) || !(o.height > 0)) {
    throw new RangeError(`cursor3d-size: ${o.width}x${o.height}`);
  }
  for (const a of [o.angleY, o.tiltX]) {
    if (!Number.isFinite(a)) throw new RangeError(`cursor3d-angle: ${a}`);
  }
}

/**
 * Project one voxel to 3D-viewport screen coords. Rotation + scale + pixel
 * mapping are raster.ts verbatim (orbit around Y, then tilt around X,
 * orthographic, y-down screen). Out-of-volume voxels throw
 * `cursor3d-bounds` — the chrome only ever projects the synced tap, which
 * is always inside; a miss is a bug, never a silent off-screen dot.
 */
export function projectCursor(voxel: Voxel3, dims: CursorDims, opts: CursorOpts): CursorPoint {
  checkedDims(dims);
  checkedOpts(opts);
  if (!voxel.every(Number.isFinite)) throw new RangeError(`cursor3d-voxel: [${voxel}]`);
  const [nx, ny, nz] = dims;
  if (voxel[0] < 0 || voxel[1] < 0 || voxel[2] < 0 || voxel[0] > nx - 1 || voxel[1] > ny - 1 || voxel[2] > nz - 1) {
    throw new RangeError(`cursor3d-bounds: [${voxel}] outside [${dims}]`);
  }
  const { width: W, height: H, angleY, tiltX } = opts;
  const cy = Math.cos(angleY), sy = Math.sin(angleY);
  const cx = Math.cos(tiltX), sx = Math.sin(tiltX);
  const maxDim = Math.max(nx, ny, nz);
  const scale = (Math.min(W, H) / maxDim) * 0.92 * (opts.zoom ?? 1);
  const [ccx, ccy, ccz] = opts.center ?? [nx / 2, ny / 2, nz / 2];
  const x = voxel[0] - ccx, y = voxel[1] - ccy, z = voxel[2] - ccz;
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const y1 = y * cx - z1 * sx;
  const z2 = y * sx + z1 * cx;
  return { x: W / 2 + x1 * scale, y: H / 2 - y1 * scale, z: z2 };
}

/** True when the projected point lands on the canvas (caller draws only then). */
export function cursorOnCanvas(p: CursorPoint, opts: CursorOpts): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < opts.width && p.y < opts.height;
}

/**
 * The three voxel-axis segments through the cursor, clipped to the volume
 * (NiiVue's 3D crosshair lines, as endpoint pairs). Default half-length
 * spans the whole volume; pass less for a marker nub. Endpoints project
 * through projectCursor, so lines agree with the dot by construction.
 */
export function cursorAxes(
  voxel: Voxel3, dims: CursorDims, opts: CursorOpts, halfLen = Math.max(...dims),
): [{ a: CursorPoint; b: CursorPoint }, { a: CursorPoint; b: CursorPoint }, { a: CursorPoint; b: CursorPoint }] {
  if (!(halfLen > 0)) throw new RangeError(`cursor3d-halfLen: ${halfLen}`);
  const at = (axis: 0 | 1 | 2, v: number): Voxel3 => {
    const p: Voxel3 = [...voxel] as Voxel3;
    p[axis] = Math.min(dims[axis]! - 1, Math.max(0, v));
    return p;
  };
  const seg = (axis: 0 | 1 | 2): { a: CursorPoint; b: CursorPoint } => ({
    a: projectCursor(at(axis, voxel[axis]! - halfLen), dims, opts),
    b: projectCursor(at(axis, voxel[axis]! + halfLen), dims, opts),
  });
  return [seg(0), seg(1), seg(2)];
}
