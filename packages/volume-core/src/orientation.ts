// Ported from Papaya src/js/volume/orientation.js (364 lines, MIT).
// 6-char orientation strings e.g. "XYZ+--": first 3 = axis permutation,
// last 3 = flip sense. Strides + orientMat drive all voxel addressing.

export type Mat4 = number[][];

export const ORIENTATION_DEFAULT = 'XYZ+--';

export function isValidOrientationString(s: string): boolean {
  if (s === null || s.length !== 6) return false;
  const u = s.toUpperCase();
  for (const ax of ['X', 'Y', 'Z']) {
    const t = u.indexOf(ax);
    if (t === -1 || t > 2 || u.lastIndexOf(ax) !== t) return false;
  }
  for (let i = 3; i < 6; i++) {
    if (s.charAt(i) !== '+' && s.charAt(i) !== '-') return false;
  }
  return true;
}

export interface ImageDims {
  cols: number; rows: number; slices: number;
  xDim: number; yDim: number; zDim: number;
}

export interface VoxelSizes {
  colSize: number; rowSize: number; sliceSize: number;
  xSize: number; ySize: number; zSize: number;
}

export class Orientation {
  orientMat: Mat4 | null = null;
  xIncrement = -1;
  yIncrement = -1;
  zIncrement = -1;

  constructor(public orientation = ORIENTATION_DEFAULT) {}

  isValid(): boolean {
    return isValidOrientationString(this.orientation);
  }

  convertIndexToOffsetNative(x: number, y: number, z: number): number {
    return x * this.xIncrement + y * this.yIncrement + z * this.zIncrement;
  }

  convertIndexToOffset(x: number, y: number, z: number): number {
    const m = this.orientMat!;
    const x2 = Math.floor(x * m[0][0] + y * m[0][1] + z * m[0][2] + m[0][3]);
    const y2 = Math.floor(x * m[1][0] + y * m[1][1] + z * m[1][2] + m[1][3]);
    const z2 = Math.floor(x * m[2][0] + y * m[2][1] + z * m[2][2] + m[2][3]);
    return x2 * this.xIncrement + y2 * this.yIncrement + z2 * this.zIncrement;
  }

  /** Permutation table ported 1:1 from Papaya createInfo (all 6 orders). */
  createInfo(d: ImageDims, v: VoxelSizes): void {
    const { cols: nc, rows: nr, slices: ns } = d;
    const slice = nc * nr;
    const colP = this.orientation.charAt(3) === '+';
    const rowP = this.orientation.charAt(4) === '+';
    const slcP = this.orientation.charAt(5) === '+';
    const perm = this.orientation.toUpperCase().slice(0, 3);
    let xm = 1, xs = 0, ym = 1, ys = 0, zm = 1, zs = 0;

    const setDims = (
      xd: number, yd: number, zd: number,
      xs2: number, ys2: number, zs2: number,
      xi: number, yi: number, zi: number,
    ) => {
      d.xDim = xd; d.yDim = yd; d.zDim = zd;
      v.xSize = xs2; v.ySize = ys2; v.zSize = zs2;
      this.xIncrement = xi; this.yIncrement = yi; this.zIncrement = zi;
    };

    if (perm === 'XYZ') {
      setDims(nc, nr, ns, v.colSize, v.rowSize, v.sliceSize, 1, nc, slice);
      xm = colP ? 1 : -1; xs = colP ? 0 : nc - 1;
      ym = rowP ? -1 : 1; ys = rowP ? nr - 1 : 0;
      zm = slcP ? -1 : 1; zs = slcP ? ns - 1 : 0;
    } else if (perm === 'XZY') {
      setDims(nc, ns, nr, v.colSize, v.sliceSize, v.rowSize, 1, slice, nc);
      xm = colP ? 1 : -1; xs = colP ? 0 : nc - 1;
      zm = rowP ? -1 : 1; zs = rowP ? nr - 1 : 0;
      ym = slcP ? -1 : 1; ys = slcP ? ns - 1 : 0;
    } else if (perm === 'YXZ') {
      setDims(nr, nc, ns, v.rowSize, v.colSize, v.sliceSize, nc, 1, slice);
      ym = colP ? -1 : 1; ys = colP ? nc - 1 : 0;
      xm = rowP ? 1 : -1; xs = rowP ? 0 : nr - 1;
      zm = slcP ? -1 : 1; zs = slcP ? ns - 1 : 0;
    } else if (perm === 'YZX') {
      setDims(ns, nc, nr, v.sliceSize, v.colSize, v.rowSize, slice, 1, nc);
      ym = colP ? -1 : 1; ys = colP ? nc - 1 : 0;
      zm = rowP ? -1 : 1; zs = rowP ? nr - 1 : 0;
      xm = slcP ? 1 : -1; xs = slcP ? 0 : ns - 1;
    } else if (perm === 'ZXY') {
      setDims(nr, ns, nc, v.rowSize, v.sliceSize, v.colSize, nc, slice, 1);
      zm = colP ? -1 : 1; zs = colP ? nc - 1 : 0;
      xm = rowP ? 1 : -1; xs = rowP ? 0 : nr - 1;
      ym = slcP ? -1 : 1; ys = slcP ? ns - 1 : 0;
    } else if (perm === 'ZYX') {
      setDims(ns, nr, nc, v.sliceSize, v.rowSize, v.colSize, slice, nc, 1);
      zm = colP ? -1 : 1; zs = colP ? nc - 1 : 0;
      ym = rowP ? -1 : 1; ys = rowP ? nr - 1 : 0;
      xm = slcP ? 1 : -1; xs = slcP ? 0 : ns - 1;
    }

    this.orientMat = [
      [xm, 0, 0, xs],
      [0, ym, 0, ys],
      [0, 0, zm, zs],
      [0, 0, 0, 1],
    ];
  }

  getOrientationDescription(): string {
    const o = this.orientation;
    return `Cols (${o.charAt(0)}${o.charAt(3)}), Rows (${o.charAt(1)}${o.charAt(4)}), Slices (${o.charAt(2)}${o.charAt(5)})`;
  }
}

export type AnatomyPlane = 'axial' | 'coronal' | 'sagittal';

export interface EdgeLabels {
  left: string;
  right: string;
  top: string;
  bottom: string;
}

/** DICOM patient axes: +X = Left, +Y = Posterior, +Z = Superior. */
function axisLetter(v: [number, number, number]): string {
  const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
  if (ax >= ay && ax >= az) return v[0] >= 0 ? 'L' : 'R';
  if (ay >= az) return v[1] >= 0 ? 'P' : 'A';
  return v[2] >= 0 ? 'S' : 'I';
}

const neg = (v: [number, number, number]): [number, number, number] => [-v[0], -v[1], -v[2]];

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Anatomy edge labels for an MPR pane from ImageOrientationPatient
 * (row + column direction cosines). Screen mapping matches the CPU
 * reslicer: axial (u=x, v=y), coronal (u=x, v=z), sagittal (u=y, v=z).
 * Only axial acquisitions resolve (row/column ⊥ z, the standard stack):
 * non-axial IOP returns null and the caller hides the labels rather than
 * guessing. All-zero IOP (IOP-stripped converts, still LPS-ordered)
 * falls back to the identity labels.
 */
export function iopEdgeLabels(
  iop: [number, number, number, number, number, number],
  plane: AnatomyPlane,
): EdgeLabels | null {
  const r: [number, number, number] = [iop[0], iop[1], iop[2]];
  const c: [number, number, number] = [iop[3], iop[4], iop[5]];
  const rn = Math.hypot(...r), cn = Math.hypot(...c);
  const identity = (): EdgeLabels => plane === 'sagittal'
    ? { left: 'A', right: 'P', top: 'I', bottom: 'S' }
    : { left: 'R', right: 'L', top: plane === 'axial' ? 'A' : 'I', bottom: plane === 'axial' ? 'P' : 'S' };
  if (!(rn > 0) || !(cn > 0)) return identity();
  if (Math.abs(r[2]) > 1e-6 || Math.abs(c[2]) > 1e-6) return null;
  const n = cross(r, c);
  const nn = Math.hypot(...n);
  const w: [number, number, number] = nn > 0 ? [n[0] / nn, n[1] / nn, n[2] / nn] : [0, 0, 1];
  const [u, v] = plane === 'axial' ? [r, c] : plane === 'coronal' ? [r, w] : [c, w];
  return { left: axisLetter(neg(u)), right: axisLetter(u), top: axisLetter(neg(v)), bottom: axisLetter(v) };
}
