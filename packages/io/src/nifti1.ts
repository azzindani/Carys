// Ported from NIFTI-Reader-JS src/nifti1.ts + src/nifti.ts + src/utilities.ts (MIT).
// Read-only NIfTI-1 subset: 348B header, endian detect, datatype table,
// qform/sform affine (METHOD 0/2/3), slope/intercept (stored, not applied),
// extension %16 chain, gzip via fflate. Skips: NIfTI-2, async streaming,
// serializers, orientation search, HDR/IMG pairs, complex/RGB, 5D.

export const MAGIC_COOKIE = 348;
export const HEADER_SIZE = 348;
export const MAGIC_LOCATION = 344;
export const MAGIC_NII = [0x6e, 0x2b, 0x31]; // n+1
export const MAGIC_HDR = [0x6e, 0x69, 0x31]; // ni1
export const GZIP1 = 31;
export const GZIP2 = 139;

export const TYPE_UINT8 = 2;
export const TYPE_INT16 = 4;
export const TYPE_INT32 = 8;
export const TYPE_FLOAT32 = 16;
export const TYPE_FLOAT64 = 64;
export const TYPE_INT8 = 256;
export const TYPE_UINT16 = 512;
export const TYPE_UINT32 = 768;

export type NiftiDType =
  | 'uint8' | 'int8' | 'uint16' | 'int16' | 'uint32' | 'int32'
  | 'float32' | 'float64';

const DATATYPE_TO_DTYPE: Record<number, NiftiDType> = {
  [TYPE_UINT8]: 'uint8',
  [TYPE_INT8]: 'int8',
  [TYPE_UINT16]: 'uint16',
  [TYPE_INT16]: 'int16',
  [TYPE_UINT32]: 'uint32',
  [TYPE_INT32]: 'int32',
  [TYPE_FLOAT32]: 'float32',
  [TYPE_FLOAT64]: 'float64',
};

export interface Nifti1Header {
  dims: [number, number, number];
  /** time points (dim[4]); 1 for plain 3D files */
  nt: number;
  datatypeCode: number;
  dtype: NiftiDType;
  numBitsPerVoxel: number;
  pixDims: number[];
  vox_offset: number;
  scl_slope: number;
  scl_inter: number;
  qform_code: number;
  sform_code: number;
  affine: number[][]; // 4x4
  extensionFlag: number[];
  littleEndian: boolean;
}

function getStringAt(d: DataView, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) {
    const c = d.getUint8(i);
    if (c === 0) continue;
    s += String.fromCharCode(c);
  }
  return s;
}

export function isCompressed(bytes: Uint8Array): boolean {
  return bytes[0] === GZIP1 && bytes[1] === GZIP2;
}

export function isNIFTI1(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 348) return false;
  const d = new DataView(buf);
  for (const le of [false, true]) {
    if (d.getInt32(0, le) !== MAGIC_COOKIE) continue;
    const m = [d.getUint8(344), d.getUint8(345), d.getUint8(346)];
    if (
      (m[0] === MAGIC_NII[0] && m[1] === MAGIC_NII[1] && m[2] === MAGIC_NII[2]) ||
      (m[0] === MAGIC_HDR[0] && m[1] === MAGIC_HDR[1] && m[2] === MAGIC_HDR[2])
    ) {
      return true;
    }
  }
  return false;
}

export function readHeader(buf: ArrayBuffer): Nifti1Header {
  const raw = new DataView(buf);
  let le = false;
  if (raw.getInt32(0, le) !== MAGIC_COOKIE) {
    le = true;
    if (raw.getInt32(0, le) !== MAGIC_COOKIE) {
      throw new Error('This does not appear to be a NIFTI file!');
    }
  }
  const dims: number[] = [];
  for (let c = 0; c < 8; c++) dims.push(raw.getInt16(40 + c * 2, le));
  const datatypeCode = raw.getInt16(70, le);
  const numBitsPerVoxel = raw.getInt16(72, le);
  const pixDims: number[] = [];
  for (let c = 0; c < 8; c++) pixDims.push(raw.getFloat32(76 + c * 4, le));
  const vox_offset = raw.getFloat32(108, le);
  const scl_slope = raw.getFloat32(112, le);
  const scl_inter = raw.getFloat32(116, le);
  const qform_code = raw.getInt16(252, le);
  const sform_code = raw.getInt16(254, le);
  const qb = raw.getFloat32(256, le);
  const qc = raw.getFloat32(260, le);
  const qd = raw.getFloat32(264, le);
  const qx = raw.getFloat32(268, le);
  const qy = raw.getFloat32(272, le);
  const qz = raw.getFloat32(276, le);
  const srow: number[] = [];
  for (let c = 0; c < 12; c++) srow.push(raw.getFloat32(280 + c * 4, le));
  const extensionFlag = [
    raw.getUint8(348), raw.getUint8(349), raw.getUint8(350), raw.getUint8(351),
  ];

  const dtype = DATATYPE_TO_DTYPE[datatypeCode];
  if (!dtype) throw new Error(`Unsupported NIfTI datatype ${datatypeCode}`);

  const nx = dims[1], ny = dims[2], nz = dims[3];
  const nt = Number.isInteger(dims[4]) && (dims[4] as number) > 0 ? (dims[4] as number) : 1;
  const affine = buildAffine(pixDims, qform_code, sform_code, qb, qc, qd, qx, qy, qz, srow);

  return {
    dims: [nx, ny, nz], nt,
    datatypeCode, dtype, numBitsPerVoxel, pixDims,
    vox_offset, scl_slope, scl_inter,
    qform_code, sform_code, affine, extensionFlag, littleEndian: le,
  };
}

/** METHOD 0/2/3 affine builder (NIFTI-Reader-JS readHeader lines 224-339). */
function buildAffine(
  pixDims: number[], qform: number, sform: number,
  qb: number, qc: number, qd: number, qx: number, qy: number, qz: number,
  srow: number[],
): number[][] {
  if (qform < 1 && sform < 1) {
    // METHOD 0: diagonal of pixDims
    return [
      [pixDims[1], 0, 0, 0],
      [0, pixDims[2], 0, 0],
      [0, 0, pixDims[3], 0],
      [0, 0, 0, 1],
    ];
  }
  if (qform > 0 && sform < qform) {
    // METHOD 2: quaternion
    const a = Math.sqrt(Math.max(0, 1 - qb * qb - qc * qc - qd * qd));
    const qfac = pixDims[0] === 0 ? 1 : pixDims[0];
    const R = [
      [a * a + qb * qb - qc * qc - qd * qd, 2 * (qb * qc - a * qd), 2 * (qb * qd + a * qc)],
      [2 * (qb * qc + a * qd), a * a + qc * qc - qb * qb - qd * qd, 2 * (qc * qd - a * qb)],
      [2 * (qb * qd - a * qc), 2 * (qc * qd + a * qb), a * a + qd * qd - qb * qb - qc * qc],
    ];
    return [
      [R[0][0] * pixDims[1], R[0][1] * pixDims[2], R[0][2] * pixDims[3] * qfac, qx],
      [R[1][0] * pixDims[1], R[1][1] * pixDims[2], R[1][2] * pixDims[3] * qfac, qy],
      [R[2][0] * pixDims[1], R[2][1] * pixDims[2], R[2][2] * pixDims[3] * qfac, qz],
      [0, 0, 0, 1],
    ];
  }
  // METHOD 3: srow wins
  return [
    [srow[0], srow[1], srow[2], srow[3]],
    [srow[4], srow[5], srow[6], srow[7]],
    [srow[8], srow[9], srow[10], srow[11]],
    [0, 0, 0, 1],
  ];
}

/** Image bytes slice: dims product * bits/8 from vox_offset. */
export function readImage(h: Nifti1Header, buf: ArrayBuffer): ArrayBuffer {
  return readFrame(h, buf, 0);
}

/** Raw bytes of time frame t (0-based). Throws RangeError when out of range. */
export function readFrame(h: Nifti1Header, buf: ArrayBuffer, t: number): ArrayBuffer {
  if (!Number.isInteger(t) || t < 0 || t >= h.nt) {
    throw new RangeError(`frame ${t} out of range (nt=${h.nt})`);
  }
  const [nx, ny, nz] = h.dims;
  const size = Math.floor((nx * ny * nz * h.numBitsPerVoxel) / 8);
  const off = Math.floor(h.vox_offset) + t * size;
  if (off + size > buf.byteLength) throw new RangeError(`frame ${t} overruns buffer`);
  return buf.slice(off, off + size);
}

export interface NiftiExtension { esize: number; ecode: number; edata: ArrayBuffer }

/** Extension chain walk with %16 validation (NIFTI-Reader-JS getExtensionsAt). */
export function readExtensions(h: Nifti1Header, buf: ArrayBuffer): NiftiExtension[] {
  if (h.extensionFlag[0] === 0) return [];
  const raw = new DataView(buf);
  const out: NiftiExtension[] = [];
  let idx = 352;
  const end = Math.floor(h.vox_offset);
  while (idx < end) {
    const esize = raw.getInt32(idx, h.littleEndian);
    if (!esize) break;
    if (esize % 16 !== 0) throw new Error('Extension size must be multiple of 16');
    const ecode = raw.getInt32(idx + 4, h.littleEndian);
    out.push({ esize, ecode, edata: buf.slice(idx + 8, idx + esize) });
    idx += esize;
  }
  return out;
}

export { getStringAt };
