// Patient geometry: where a voxel grid sits in the patient, and how to lay
// any grid out so that the viewer's fixed screen mapping is anatomically
// right.
//
// The MPR panes map voxel axes to the screen with no knowledge of anatomy:
// axial is (i → right, j → down), coronal (i → right, k), sagittal (j → right,
// k). That is only correct for one storage order, and files arrive in all of
// them — NIfTI tools write RAS (the patient's right on screen right, the
// spine at the top of an axial), DICOM stacks follow the scanner, sagittal
// acquisitions put the slice axis across the patient. Showing the raw grid
// is how the liver ended up on the wrong side of the screen.
//
// So every volume with known orientation is re-laid-out once, at load, into
// LPS storage — +i toward the patient's Left, +j Posterior, +k Superior, the
// DICOM patient axes. In the fixed screen mapping that is the radiological
// convention for axial (patient right on screen left, anterior up); the
// coronal and sagittal panes flip k so superior is up. Oblique acquisitions
// snap to their nearest axes, as every CPU MPR viewer does short of
// resampling. The re-layout is a pure axis permutation + flips, so it is
// exactly invertible: exports go back to the source grid and its affine.
import type { Vec3 } from './imagespace.js';
import type { TypedArray } from './types.js';

export interface PatientGeometry {
  /** LPS mm of the centre of voxel (0,0,0). */
  origin: Vec3;
  /** mm per voxel along +i, +j, +k (always positive). */
  spacing: Vec3;
  /** LPS unit vectors of +i, +j, +k. */
  direction: [Vec3, Vec3, Vec3];
}

/** Canonical axis t is source axis perm[t], reversed when flip[t]. */
export interface Reorientation {
  perm: [number, number, number];
  flip: [boolean, boolean, boolean];
}

export const IDENTITY_REORIENTATION: Reorientation = { perm: [0, 1, 2], flip: [false, false, false] };

export function isIdentityReorientation(r: Reorientation): boolean {
  return r.perm[0] === 0 && r.perm[1] === 1 && r.perm[2] === 2 && !r.flip[0] && !r.flip[1] && !r.flip[2];
}

/**
 * NIfTI affine (voxel → RAS mm, 4x4 rows) to LPS geometry. Null when the
 * matrix is degenerate (a zero column): there is no orientation to honour.
 */
export function geometryFromRasAffine(a: number[][]): PatientGeometry | null {
  const spacing: number[] = [];
  const direction: Vec3[] = [];
  for (let c = 0; c < 3; c++) {
    // RAS → LPS negates x and y.
    const col: Vec3 = [-a[0]![c]!, -a[1]![c]!, a[2]![c]!];
    const s = Math.hypot(col[0], col[1], col[2]);
    if (!(s > 1e-9) || !Number.isFinite(s)) return null;
    spacing.push(s);
    direction.push([col[0] / s, col[1] / s, col[2] / s]);
  }
  return {
    origin: [-a[0]![3]!, -a[1]![3]!, a[2]![3]!],
    spacing: spacing as Vec3,
    direction: direction as [Vec3, Vec3, Vec3],
  };
}

/** LPS geometry to a NIfTI affine (voxel → RAS mm, 4x4 rows). */
export function rasAffineFromGeometry(g: PatientGeometry): number[][] {
  const col = (c: number): Vec3 => {
    const d = g.direction[c]!, s = g.spacing[c]!;
    return [-d[0] * s, -d[1] * s, d[2] * s];
  };
  const c0 = col(0), c1 = col(1), c2 = col(2);
  return [
    [c0[0], c1[0], c2[0], -g.origin[0]],
    [c0[1], c1[1], c2[1], -g.origin[1]],
    [c0[2], c1[2], c2[2], g.origin[2]],
    [0, 0, 0, 1],
  ];
}

/**
 * The permutation + flips that bring a grid closest to LPS storage. Greedy
 * on the largest direction cosine, so an oblique grid still yields a true
 * permutation (no two source axes claim one patient axis).
 */
export function toLps(direction: [Vec3, Vec3, Vec3]): Reorientation {
  const perm: [number, number, number] = [0, 1, 2];
  const flip: [boolean, boolean, boolean] = [false, false, false];
  const freeSrc = new Set([0, 1, 2]);
  const freeAxis = new Set([0, 1, 2]);
  for (let round = 0; round < 3; round++) {
    let best = -1, bs = 0, bt = 0;
    for (const s of freeSrc) {
      for (const t of freeAxis) {
        const m = Math.abs(direction[s]![t]!);
        if (m > best) { best = m; bs = s; bt = t; }
      }
    }
    perm[bt] = bs;
    flip[bt] = direction[bs]![bt]! < 0;
    freeSrc.delete(bs);
    freeAxis.delete(bt);
  }
  return { perm, flip };
}

export function reorientDims(dims: Vec3, r: Reorientation): Vec3 {
  return [dims[r.perm[0]]!, dims[r.perm[1]]!, dims[r.perm[2]]!];
}

/** Geometry of the re-laid-out grid (same patient space, new voxel order). */
export function reorientGeometry(g: PatientGeometry, dims: Vec3, r: Reorientation): PatientGeometry {
  const origin: Vec3 = [...g.origin];
  const direction: Vec3[] = [];
  const spacing: number[] = [];
  for (let t = 0; t < 3; t++) {
    const s = r.perm[t]!;
    const d = g.direction[s]!;
    const sign = r.flip[t] ? -1 : 1;
    direction.push([d[0] * sign, d[1] * sign, d[2] * sign]);
    spacing.push(g.spacing[s]!);
    if (r.flip[t]) {
      // canonical index 0 is the source's last index along this axis
      const run = (dims[s]! - 1) * g.spacing[s]!;
      origin[0] += d[0] * run; origin[1] += d[1] * run; origin[2] += d[2] * run;
    }
  }
  return { origin, spacing: spacing as Vec3, direction: direction as [Vec3, Vec3, Vec3] };
}

/**
 * Move voxels between the source layout (`dims`) and the re-laid-out one.
 * 'forward' reads source order and writes canonical order; 'inverse' takes
 * canonical data back to the source grid (exports). Same array type out.
 */
export function reorientVoxels<T extends TypedArray>(
  data: T, dims: Vec3, r: Reorientation, way: 'forward' | 'inverse' = 'forward',
): T {
  const stride = [1, dims[0], dims[0] * dims[1]];
  const cd = reorientDims(dims, r);
  let base = 0;
  const step = [0, 0, 0];
  for (let t = 0; t < 3; t++) {
    const s = r.perm[t]!;
    step[t] = (r.flip[t] ? -1 : 1) * stride[s]!;
    if (r.flip[t]) base += (dims[s]! - 1) * stride[s]!;
  }
  const out = new (data.constructor as new (n: number) => T)(data.length);
  const [s0, s1, s2] = step as Vec3;
  let o = 0;
  for (let c = 0; c < cd[2]; c++) {
    const zc = base + c * s2;
    for (let b = 0; b < cd[1]; b++) {
      let idx = zc + b * s1;
      if (way === 'forward') {
        for (let a = 0; a < cd[0]; a++, idx += s0) out[o++] = data[idx]!;
      } else {
        for (let a = 0; a < cd[0]; a++, idx += s0) out[idx] = data[o++]!;
      }
    }
  }
  return out;
}

/** Three-letter code of the patient direction each axis points toward, e.g. 'LPS', 'RAS'. */
export function orientationCode(direction: [Vec3, Vec3, Vec3]): string {
  const letters = [['L', 'R'], ['P', 'A'], ['S', 'I']] as const;
  return direction.map((d) => {
    const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
    const t = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    return letters[t]![d[t]! >= 0 ? 0 : 1];
  }).join('');
}

/** LPS mm of a (possibly fractional) voxel index. */
export function voxelToPatient(g: PatientGeometry, ijk: Vec3): Vec3 {
  const out: Vec3 = [...g.origin];
  for (let a = 0; a < 3; a++) {
    const d = g.direction[a]!, m = ijk[a]! * g.spacing[a]!;
    out[0] += d[0] * m; out[1] += d[1] * m; out[2] += d[2] * m;
  }
  return out;
}
