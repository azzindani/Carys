// Ported from VolView utils/imageSpace.ts + utils/lps.ts +
// utils/frameOfReference.ts (pure math only; no VTK).

export type Vec3 = [number, number, number];

/** Index -> world using origin + direction columns + spacing. */
export function indexToWorld(
  idx: Vec3,
  origin: Vec3,
  direction: number[],
  spacing: Vec3,
): Vec3 {
  return [
    origin[0] + (direction[0] * idx[0] + direction[3] * idx[1] + direction[6] * idx[2]) * spacing[0],
    origin[1] + (direction[1] * idx[0] + direction[4] * idx[1] + direction[7] * idx[2]) * spacing[1],
    origin[2] + (direction[2] * idx[0] + direction[5] * idx[1] + direction[8] * idx[2]) * spacing[2],
  ];
}

/** World -> index (assumes orthonormal direction; transpose = inverse). */
export function worldToIndex(
  w: Vec3,
  origin: Vec3,
  direction: number[],
  spacing: Vec3,
): Vec3 {
  const d = [
    (w[0] - origin[0]) / spacing[0],
    (w[1] - origin[1]) / spacing[1],
    (w[2] - origin[2]) / spacing[2],
  ];
  return [
    direction[0] * d[0] + direction[1] * d[1] + direction[2] * d[2],
    direction[3] * d[0] + direction[4] * d[1] + direction[5] * d[2],
    direction[6] * d[0] + direction[7] * d[1] + direction[8] * d[2],
  ];
}

/** Compare two image spaces (VolView compareImageSpaces, lite). */
export function sameSpace(
  a: { origin: Vec3; spacing: Vec3; dims: Vec3 },
  b: { origin: Vec3; spacing: Vec3; dims: Vec3 },
): boolean {
  return (
    a.dims[0] === b.dims[0] && a.dims[1] === b.dims[1] && a.dims[2] === b.dims[2] &&
    a.spacing[0] === b.spacing[0] && a.spacing[1] === b.spacing[1] && a.spacing[2] === b.spacing[2] &&
    a.origin[0] === b.origin[0] && a.origin[1] === b.origin[1] && a.origin[2] === b.origin[2]
  );
}
