// V1 cornerstone-studied annotation lifecycle (REFERENCE → engine-pure).
// Studied: cornerstone3D LengthTool (MIT, Open Health Imaging Foundation,
// verified 2026-09-18 from the live LICENSE file) + its math/line utility.
// What we PORT (behaviour, not code): the annotation record shape
// (uid + world-space handle points + per-target cached stats + invalidated
// flag + locked/visible/highlighted), the draw→select→drag→end lifecycle
// with stats invalidation on every handle move, and proximity picking via
// point-to-segment distance. What stays out: DOM/toolGroups/rendering
// engines/SVG helpers, throttled recompute (a scheduler concern), volume
// viewports, calibration (getCalibratedLengthUnitsAndScale — our spacing
// already rides the Volume). Pure, no DOM: the caller projects world→canvas
// and computes stats with the shipped length/angle/ellipse/cobb math.

/** World-space point (voxel coords; spacing applied by the stats fn). */
export type AnnotationPoint = [number, number, number];
/** Canvas point after the caller's world→canvas projection. */
export type CanvasPoint = [number, number];

export type AnnotationKind = 'length' | 'angle' | 'ellipse' | 'cobb' | 'probe' | 'roi';

/** Minimum handle counts (cornerstone draws length with 2 world points). */
const MIN_HANDLES: Record<AnnotationKind, number> = {
  length: 2, angle: 3, ellipse: 2, cobb: 4, probe: 1, roi: 2,
};

export interface AnnotationStats {
  value: number;
  unit: string;
}

/** Engine-pure annotation record (mirrors the LengthTool data contract). */
export interface AnnotationRecord {
  uid: string;
  kind: AnnotationKind;
  /** handle points in world space (cornerstone data.handles.points) */
  points: AnnotationPoint[];
  locked: boolean;
  visible: boolean;
  highlighted: boolean;
  /** true after any handle move until stats recompute (invalidated flag) */
  invalidated: boolean;
  stats: AnnotationStats | null;
  label: string;
}

let seq = 0;

/** Start a new annotation (cornerstone addNewAnnotation: two coincident
 *  world points, second handle live). Throws on too few points. */
export function createAnnotation(kind: AnnotationKind, points: AnnotationPoint[]): AnnotationRecord {
  if (points.length < MIN_HANDLES[kind]) {
    throw new RangeError(`annotation-handles: ${kind} needs ${MIN_HANDLES[kind]} points, got ${points.length}`);
  }
  seq++;
  return {
    uid: `anno-${seq}`, kind,
    points: points.map((p) => [...p] as AnnotationPoint),
    locked: false, visible: true, highlighted: false,
    invalidated: true, stats: null, label: `${kind} ${seq}`,
  };
}

/** Select: highlight on, returns the record for the modify session
 *  (cornerstone toolSelectedCallback). Locked annotations refuse. */
export function selectAnnotation(ann: AnnotationRecord): AnnotationRecord {
  if (ann.locked) throw new Error(`annotation-locked: ${ann.uid} is locked`);
  return { ...ann, highlighted: true };
}

/** Drag a handle to a new world position (cornerstone _dragCallback move
 *  mode): stats invalidate, highlight stays. Returns a new record — the
 *  caller keeps the old one as the undo memo (doneEditMemo pattern). */
export function moveHandle(ann: AnnotationRecord, index: number, pt: AnnotationPoint): AnnotationRecord {
  if (ann.locked) throw new Error(`annotation-locked: ${ann.uid} is locked`);
  if (!Number.isInteger(index) || index < 0 || index >= ann.points.length) {
    throw new RangeError(`annotation-handle: index ${index} of ${ann.points.length}`);
  }
  const points = ann.points.map((p) => [...p] as AnnotationPoint);
  points[index] = [...pt] as AnnotationPoint;
  return { ...ann, points, invalidated: true };
}

/** Recompute cached stats after a move (cornerstone _calculateCachedStats):
 *  the caller supplies stats from the shipped math; the flag clears. */
export function commitStats(ann: AnnotationRecord, stats: AnnotationStats): AnnotationRecord {
  return { ...ann, stats, invalidated: false };
}

/** Mid-draw cancel (cornerstone cancel): caller drops the record; the uid
 *  is returned so the chrome can announce what was discarded. */
export function cancelAnnotationUid(ann: AnnotationRecord): string {
  return ann.uid;
}

/** Text line for the annotation (cornerstone defaultGetTextLines:
 *  `${roundNumber(length)} ${unit}`). Unknown/NaN stats render nothing —
 *  never a "NaN mm" label. Rounds to 2dp like measurementsToCSV. */
export function annotationText(ann: AnnotationRecord): string[] {
  if (!ann.stats || !Number.isFinite(ann.stats.value)) return [];
  return [`${Math.round(ann.stats.value * 100) / 100} ${ann.stats.unit}`];
}

/**
 * Squared point-to-segment distance (cornerstone math/line
 * distanceToPointSquared, textbook projection, ported verbatim-behaviour:
 * clamp t to [0,1], degenerate segment = distance to a). Canvas 2D.
 */
export function segmentDistSq(a: CanvasPoint, b: CanvasPoint, p: CanvasPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = p[0] - a[0], ey = p[1] - a[1];
    return ex * ex + ey * ey;
  }
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const cx = a[0] + t * dx - p[0], cy = a[1] + t * dy - p[1];
  return cx * cx + cy * cy;
}

/** Point-to-segment distance (cornerstone math/line distanceToPoint). */
export function segmentDist(a: CanvasPoint, b: CanvasPoint, p: CanvasPoint): number {
  return Math.sqrt(segmentDistSq(a, b, p));
}

/** Proximity pick (cornerstone isPointNearTool): canvas point within
 *  `proximity` px of any handle segment. Locked/invisible annotations
 *  never pick (filtered like filterInteractableAnnotationsForElement).
 *  Needs 2+ projected points; probe (1 handle) picks by handle radius. */
export function isPointNearAnnotation(
  ann: AnnotationRecord,
  canvasPt: CanvasPoint,
  proximity: number,
  project: (world: AnnotationPoint) => CanvasPoint,
): boolean {
  if (ann.locked || !ann.visible) return false;
  if (!(proximity > 0)) throw new RangeError(`annotation-proximity: ${proximity}`);
  const pts = ann.points.map(project);
  if (pts.length === 1) return segmentDist(pts[0]!, pts[0]!, canvasPt) <= proximity;
  if (pts.length < 2) throw new RangeError(`annotation-handles: ${ann.kind} has no segments`);
  return pts.slice(1).some((b, i) => segmentDist(pts[i]!, b, canvasPt) <= proximity);
}
