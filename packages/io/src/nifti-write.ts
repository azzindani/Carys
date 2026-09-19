// Minimal NIfTI-1 single-file (.nii) writer — complements nifti1.ts reader.
// Writes: 348B header (LE), vox_offset=352, datatype table for all 8 dtypes,
// pixdim from spacing, slope/intercept passthrough, qform=sform=0 (affine
// METHOD 0: diagonal of pixdims on re-read). No extensions, no compression.
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
  dv.setInt16(252, 0, true); // qform
  dv.setInt16(254, 0, true); // sform
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
