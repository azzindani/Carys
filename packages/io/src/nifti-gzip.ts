// .nii.gz support — fflate was a declared dependency but never wired, so
// every gzipped NIfTI failed with a confusing header error. Pure functions,
// worker-safe, no DOM.
import { gunzipSync, gzipSync } from 'fflate';

export class NiftiGzipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NiftiGzipError';
  }
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Decompress gzipped NIfTI bytes. Throws NiftiGzipError on corrupt input. */
export function gunzipNifti(bytes: Uint8Array): ArrayBuffer {
  let out: Uint8Array;
  try {
    out = gunzipSync(bytes);
  } catch (e) {
    throw new NiftiGzipError(`not valid gzip: ${(e as Error).message}`);
  }
  if (out.length < 348) {
    throw new NiftiGzipError(`decompressed to ${out.length} bytes, smaller than a NIfTI header`);
  }
  const buf = new ArrayBuffer(out.length);
  new Uint8Array(buf).set(out);
  return buf;
}

/** Compress a plain .nii buffer for .nii.gz export. */
export function gzipNifti(buf: ArrayBuffer): Uint8Array {
  return gzipSync(new Uint8Array(buf));
}

/**
 * Accept either plain .nii bytes or .nii.gz bytes; return a plain .nii
 * ArrayBuffer ready for readHeader. Non-gzip input is copied, never mutated.
 */
export function decodeNiftiBuffer(bytes: Uint8Array): ArrayBuffer {
  if (!isGzip(bytes)) {
    const buf = new ArrayBuffer(bytes.length);
    new Uint8Array(buf).set(bytes);
    return buf;
  }
  return gunzipNifti(bytes);
}
