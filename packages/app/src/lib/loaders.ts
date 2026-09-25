import { decodeNiftiBuffer, readFrame, readHeader, readImage, type DicomFileMeta, type Nifti1Header } from '@carys/io';
import { geometryFromRasAffine, histogram, windowLevelFromRange } from '@carys/volume-core';
import { toDisplayOrder } from './orient';
import type { Volume } from './types';

// Typed ports of the shell loaders. Engine stays pure; fetch + scaling
// live here in chrome. All fns accept an AbortSignal (async hygiene).
// NIfTI only: the viewer boots on it. DICOM, NRRD and TIFF are
// formatLoaders.ts, which callers import on first use, so their decoders
// (DICOM parsing, JPEG and JPEG-LS, OME-TIFF) stay out of the entry chunk.

const ARRAYS = {
  uint8: Uint8Array, int8: Int8Array, uint16: Uint16Array, int16: Int16Array,
  uint32: Uint32Array, int32: Int32Array, float32: Float32Array, float64: Float64Array,
} as const;

/**
 * Fetch sample bytes, failing with a name the user can act on.
 *
 * Every fetch here used the response without checking `res.ok`, so a missing
 * sample — the normal state of a fresh clone, where samples/ holds nothing but
 * .gitkeep — handed the server's HTML 404 page to the NIfTI parser, which
 * reported "This does not appear to be a NIFTI file!". That blames the data
 * for being malformed when it is simply absent, and sends the reader looking
 * for a corrupt volume instead of running a generator (§12, §14).
 */
export class MissingSampleError extends Error {
  constructor(public readonly url: string, public readonly status: number) {
    const file = url.split('/').pop() ?? url;
    super(
      status === 404
        ? `sample not installed: ${file} — run \`npm run gen:samples\` for synthetic volumes, or mount your own in samples/`
        : `could not read ${file} (HTTP ${status})`,
    );
    this.name = 'MissingSampleError';
  }
}

/** One fetch for every sample path, so the missing-file story is told once. */
export async function fetchSample(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new MissingSampleError(url, res.status);
  return res.arrayBuffer();
}

/**
 * Decode one frame of an already-read header into a display Volume.
 *
 * Orientation comes from the header's qform/sform when either is set;
 * spacing then follows the affine, which is what places the voxels (pixdim
 * alone can disagree with an sform, and can carry a sign). A header with
 * neither code has no orientation to honour and stays as stored.
 */
export function volumeFromNifti(h: Nifti1Header, frame: ArrayBuffer): Volume {
  const raw = new (ARRAYS[h.dtype as keyof typeof ARRAYS] ?? Uint8Array)(frame);
  const n = h.dims[0] * h.dims[1] * h.dims[2];
  const data = new Float64Array(n);
  const useSlope = Number.isFinite(h.scl_slope) && h.scl_slope !== 0;
  for (let i = 0; i < n; i++) data[i] = useSlope ? raw[i] * h.scl_slope + h.scl_inter : raw[i];
  const pix = (k: number): number => Math.abs(h.pixDims[k] ?? 1) || 1;
  const geometry = h.qform_code > 0 || h.sform_code > 0 ? geometryFromRasAffine(h.affine) : null;
  return toDisplayOrder(
    { dims: h.dims, data, spacing: [pix(1), pix(2), pix(3)] },
    geometry ? { geometry, qformCode: h.qform_code, sformCode: h.sform_code } : null,
  );
}

export function loadNiiBuffer(buf: ArrayBuffer): Volume {
  buf = decodeNiftiBuffer(new Uint8Array(buf));
  const h = readHeader(buf);
  return volumeFromNifti(h, readImage(h, buf));
}

/** Fetch raw (possibly gzipped) NIfTI bytes + header; retained for 4D cine. */
export async function loadNiiRaw(url: string, opts: { signal?: AbortSignal } = {}): Promise<{ hdr: Nifti1Header; buf: ArrayBuffer }> {
  const buf = decodeNiftiBuffer(new Uint8Array(await fetchSample(url, opts.signal)));
  return { hdr: readHeader(buf), buf };
}

/** Decode time frame t of a retained raw 4D load. */
export function decodeNiiFrame(hdr: Nifti1Header, buf: ArrayBuffer, t: number): Volume {
  return volumeFromNifti(hdr, readFrame(hdr, buf, t));
}

export async function loadNii(url: string, opts: { signal?: AbortSignal } = {}): Promise<Volume> {
  return loadNiiBuffer(await fetchSample(url, opts.signal));
}

/**
 * The window the modality asked for: the first image's VOI (0028,1050/1051)
 * when it carries a usable one. Null otherwise — the caller falls back to
 * the data-driven window.
 */
export function fileWindow(meta: DicomFileMeta | null): { width: number; center: number } | null {
  if (!meta || meta.windowWidth == null || meta.windowCenter == null) return null;
  if (!(meta.windowWidth > 1) || !Number.isFinite(meta.windowCenter)) return null;
  return { width: meta.windowWidth, center: meta.windowCenter };
}

/**
 * Data-driven window: the 2nd–98th percentile of the voxels that are not
 * background. Background — the padding value outside the field of view, or
 * the zeros around a skull-stripped brain — is often most of the volume, and
 * counting it drags the low percentile onto it and flattens the anatomy. So
 * the lowest bin sits out whenever it holds more than a fifth of the voxels.
 */
export function autoWindow(
  data: Float64Array | ArrayLike<number>,
  pre?: { hist: Uint32Array; min: number; max: number },
): { width: number; center: number } {
  const { hist, min, max } = pre ?? histogram(data as Float64Array, 256);
  const skip = hist[0]! > data.length * 0.2 && hist[0]! < data.length ? 1 : 0;
  let total = 0;
  for (let b = skip; b < hist.length; b++) total += hist[b]!;
  const at = (q: number): number => {
    let acc = 0;
    for (let b = skip; b < hist.length; b++) {
      acc += hist[b]!;
      if (acc / total >= q / 100) return min + ((b + 0.5) / 256) * (max - min || 1);
    }
    return max;
  };
  return windowLevelFromRange(at(2), at(98));
}

export function toMask(data: ArrayLike<number>, threshold = 0): Uint8Array {
  const mask = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) mask[i] = data[i] > threshold ? 1 : 0;
  return mask;
}
