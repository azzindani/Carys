// Tract ROI filtering: waypoint / exclusion filtering over fence-posted
// streamlines + along-tract FA-ish profiles. Operates on voxel coords
// (the FiberSet the importers produce), never pixels. Pure, no DOM.
//
// Prototype scope: waypoint = sphere test per streamline, exclusion =
// sphere veto; profile = mean per-point scalar along the tract (the
// caller supplies per-point scalars, e.g. FA volumes sampled externally).
// Full bundle segmentation (AFQ/RecoBundles atlases) stays out.
export interface TractRoi {
  /** sphere center in voxel coords */
  center: [number, number, number];
  /** sphere radius in voxels (must be > 0) */
  radius: number;
}

function checkRoi(roi: TractRoi, what: string): void {
  if (!roi.center.every(Number.isFinite)) throw new RangeError(`tract-roi-center: ${what}`);
  if (!(roi.radius > 0)) throw new RangeError(`tract-roi-radius: ${what} ${roi.radius}`);
}

function hitsSphere(
  pts: Float32Array, offsetPt0: Uint32Array, s: number, roi: TractRoi,
): boolean {
  const r2 = roi.radius * roi.radius;
  for (let v = offsetPt0[s]!; v < offsetPt0[s + 1]!; v++) {
    const dx = pts[v * 3]! - roi.center[0];
    const dy = pts[v * 3 + 1]! - roi.center[1];
    const dz = pts[v * 3 + 2]! - roi.center[2];
    if (dx * dx + dy * dy + dz * dz <= r2) return true;
  }
  return false;
}

/**
 * Keep streamline indices passing ALL waypoints and NO exclusion ROIs.
 * Empty waypoints = keep all (minus exclusions); empty everything = all.
 */
export function filterTracts(
  pts: Float32Array, offsetPt0: Uint32Array,
  waypoints: TractRoi[], exclusions: TractRoi[],
): number[] {
  for (const w of waypoints) checkRoi(w, 'waypoint');
  for (const e of exclusions) checkRoi(e, 'exclusion');
  const n = offsetPt0.length - 1;
  const keep: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!waypoints.every((w) => hitsSphere(pts, offsetPt0, s, w))) continue;
    if (exclusions.some((e) => hitsSphere(pts, offsetPt0, s, e))) continue;
    keep.push(s);
  }
  return keep;
}

/**
 * Along-tract profile: resample every kept streamline to `samples` points
 * (linear interp over arc position) and average the per-point scalar.
 * Returns one mean per sample bin (length `samples`).
 */
export function tractProfile(
  pts: Float32Array, offsetPt0: Uint32Array,
  scalars: Float32Array, keep: number[], samples = 32,
): number[] {
  if (!Number.isInteger(samples) || samples < 2) throw new RangeError(`tract-profile-samples: ${samples}`);
  if (scalars.length * 3 !== pts.length) {
    throw new RangeError(`tract-profile-scalars: ${scalars.length} vs ${pts.length / 3} points`);
  }
  const sums = new Array<number>(samples).fill(0);
  const counts = new Array<number>(samples).fill(0);
  for (const s of keep) {
    if (s < 0 || s + 1 >= offsetPt0.length) throw new RangeError(`tract-profile-streamline: ${s}`);
    const a = offsetPt0[s]!, b = offsetPt0[s + 1]!;
    if (b - a < 2) continue;
    for (let k = 0; k < samples; k++) {
      const f = (k / (samples - 1)) * (b - a - 1);
      const i0 = a + Math.floor(f), frac = f - Math.floor(f);
      const i1 = Math.min(b - 1, i0 + 1);
      sums[k]! += scalars[i0]! * (1 - frac) + scalars[i1]! * frac;
      counts[k]!++;
    }
  }
  return sums.map((t, k) => (counts[k]! > 0 ? t / counts[k]! : NaN));
}
