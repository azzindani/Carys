// Minimal NIfTI-1 single-file (.nii) writer — complements nifti1.ts reader.
// Writes: 348B header (LE), vox_offset=352, datatype table for all 8 dtypes,
// pixdim from spacing, slope/intercept passthrough. No extensions, no
// compression.
//
// Geometry: without `affine` the header says qform=sform=0 (METHOD 0, pixdim
// only) — honest for a volume whose placement is unknown. With `affine` it
// writes both the sform rows and the equivalent qform quaternion, because
// readers disagree about which to trust (nibabel prefers sform, ITK-based
// tools — ITK-SNAP, 3D Slicer — the qform). A mask exported without either
// lands at the origin with no orientation and cannot be overlaid on the scan
// it was drawn on.
import type { Volume } from '@carys/volume-core';
import type { NiftiDType } from './nifti1.js';

const DTYPE_INFO: Record<NiftiDType, { code: number; bitpix: number; ctor: new (n: number) => ArrayLike<number> }> = {
  uint8: { code: 2, bitpix: 8, ctor: Uint8Array },
  int8: { code: 256, bitpix: 8, ctor: Int8Array },
  uint16: { code: 512, bitpix: 16, ctor: Uint16Array },
  int16: { code: 4, bitpix: 16, ctor: Int16Array },
  uint32: { code: 768, bitpix: 32, ctor: Uint32Array },
  int32: { code: 8, bitpix: 32, ctor: Int32Array },
  float32: { code: 16, bitpix: 32, ctor: Float32Array },
  float64: { code: 64, bitpix: 64, ctor: Float64Array },
};

const INT_DTYPES = new Set(['uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32']);

export interface NiftiWriteOpts {
  slope?: number;
  intercept?: number;
  /** voxel → RAS mm (4x4 rows). Written as sform + qform; pixdim follows it. */
  affine?: number[][];
  /** xform codes for the affine (default 1, scanner anatomical). */
  qformCode?: number;
  sformCode?: number;
}

/**
 * Affine → NIfTI quaternion (nifti1_io.c nifti_mat44_to_quatern): proper
 * rotation b/c/d, offsets, per-axis spacing and qfac (-1 for a left-handed
 * grid, carried by negating the third column).
 */
export function affineToQuatern(a: number[][]): {
  b: number; c: number; d: number; qx: number; qy: number; qz: number;
  dx: number; dy: number; dz: number; qfac: number;
} {
  const col = (j: number): [number, number, number] => [a[0]![j]!, a[1]![j]!, a[2]![j]!];
  const len = (v: [number, number, number]): number => Math.hypot(v[0], v[1], v[2]);
  const cols = [col(0), col(1), col(2)];
  const sizes = cols.map(len);
  const r = cols.map((v, j) => (sizes[j]! > 0 ? v.map((x) => x / sizes[j]!) : [j === 0 ? 1 : 0, j === 1 ? 1 : 0, j === 2 ? 1 : 0]));
  // r[j][i] is row i of column j
  const det = r[0]![0]! * (r[1]![1]! * r[2]![2]! - r[2]![1]! * r[1]![2]!)
    - r[1]![0]! * (r[0]![1]! * r[2]![2]! - r[2]![1]! * r[0]![2]!)
    + r[2]![0]! * (r[0]![1]! * r[1]![2]! - r[1]![1]! * r[0]![2]!);
  let qfac = 1;
  if (det < 0) {
    qfac = -1;
    r[2] = r[2]!.map((x) => -x);
  }
  const r11 = r[0]![0]!, r21 = r[0]![1]!, r31 = r[0]![2]!;
  const r12 = r[1]![0]!, r22 = r[1]![1]!, r32 = r[1]![2]!;
  const r13 = r[2]![0]!, r23 = r[2]![1]!, r33 = r[2]![2]!;
  let qa: number, qb: number, qc: number, qd: number;
  const tr = r11 + r22 + r33 + 1;
  if (tr > 0.5) {
    qa = 0.5 * Math.sqrt(tr);
    qb = 0.25 * (r32 - r23) / qa;
    qc = 0.25 * (r13 - r31) / qa;
    qd = 0.25 * (r21 - r12) / qa;
  } else {
    const xd = 1 + r11 - (r22 + r33), yd = 1 + r22 - (r11 + r33), zd = 1 + r33 - (r11 + r22);
    if (xd > 1) {
      qb = 0.5 * Math.sqrt(xd); qc = 0.25 * (r12 + r21) / qb; qd = 0.25 * (r13 + r31) / qb; qa = 0.25 * (r32 - r23) / qb;
    } else if (yd > 1) {
      qc = 0.5 * Math.sqrt(yd); qb = 0.25 * (r12 + r21) / qc; qd = 0.25 * (r23 + r32) / qc; qa = 0.25 * (r13 - r31) / qc;
    } else {
      qd = 0.5 * Math.sqrt(zd); qb = 0.25 * (r13 + r31) / qd; qc = 0.25 * (r23 + r32) / qd; qa = 0.25 * (r21 - r12) / qd;
    }
    if (qa < 0) { qb = -qb; qc = -qc; qd = -qd; }
  }
  return {
    b: qb, c: qc, d: qd,
    qx: a[0]![3]!, qy: a[1]![3]!, qz: a[2]![3]!,
    dx: sizes[0]!, dy: sizes[1]!, dz: sizes[2]!, qfac,
  };
}

export function writeNifti1(vol: Volume, opts: NiftiWriteOpts = {}): ArrayBuffer {
  const info = DTYPE_INFO[vol.dtype as NiftiDType];
  if (!info) throw new Error(`Unsupported dtype for NIfTI write: ${vol.dtype}`);
  const [nx, ny, nz] = vol.dims;
  const n = nx * ny * nz;
  if (vol.data.length < n) throw new Error(`Volume data short: ${vol.data.length} < ${n}`);
  const out = new ArrayBuffer(352 + (n * info.bitpix) / 8);
  const dv = new DataView(out);
  dv.setInt32(0, 348, true); // sizeof_hdr
  dv.setInt16(40, 3, true); // dim[0]
  dv.setInt16(42, nx, true);
  dv.setInt16(44, ny, true);
  dv.setInt16(46, nz, true);
  for (let i = 4; i < 8; i++) dv.setInt16(40 + i * 2, 1, true);
  dv.setInt16(70, info.code, true); // datatype
  dv.setInt16(72, info.bitpix, true); // bitpix
  dv.setFloat32(76, 1, true); // pixdim[0] qfac
  dv.setFloat32(80, vol.spacing[0], true);
  dv.setFloat32(84, vol.spacing[1], true);
  dv.setFloat32(88, vol.spacing[2], true);
  dv.setFloat32(108, 352, true); // vox_offset
  dv.setFloat32(112, opts.slope ?? 1, true);
  dv.setFloat32(116, opts.intercept ?? 0, true);
  if (opts.affine) {
    const q = affineToQuatern(opts.affine);
    dv.setFloat32(76, q.qfac, true);
    dv.setFloat32(80, q.dx, true);
    dv.setFloat32(84, q.dy, true);
    dv.setFloat32(88, q.dz, true);
    dv.setUint8(123, 2); // xyzt_units: NIFTI_UNITS_MM
    dv.setInt16(252, opts.qformCode ?? 1, true);
    dv.setInt16(254, opts.sformCode ?? 1, true);
    [q.b, q.c, q.d, q.qx, q.qy, q.qz].forEach((v, i) => dv.setFloat32(256 + i * 4, v, true));
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) dv.setFloat32(280 + (r * 4 + c) * 4, opts.affine[r]![c]!, true);
    }
  } else {
    dv.setInt16(252, 0, true); // qform
    dv.setInt16(254, 0, true); // sform
  }
  dv.setUint8(344, 0x6e); // 'n+1'
  dv.setUint8(345, 0x2b);
  dv.setUint8(346, 0x31);
  // 348..351 extension flag stays zero
  const img = new info.ctor(n) as unknown as { [i: number]: number; readonly buffer: ArrayBuffer };
  const integral = INT_DTYPES.has(vol.dtype);
  for (let i = 0; i < n; i++) {
    const v = vol.data[i] as number;
    img[i] = integral ? Math.round(v) : v;
  }
  new Uint8Array(out, 352).set(new Uint8Array(img.buffer));
  return out;
}
