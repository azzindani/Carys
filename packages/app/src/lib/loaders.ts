import {
  decodeNiftiBuffer, groupDicomStacks, isNrrdLike, isTiffLike, parseDicomFrames, parseNrrd,
  parseNrrdDetached, parseOmeTiff, readFrame, readHeader, readImage, stackVoxels,
  type DicomFileMeta, type DicomStack, type Nifti1Header, type ParsedDicomSlice,
} from '@carys/io';
import { geometryFromRasAffine, histogram, windowLevelFromRange } from '@carys/volume-core';
import { toDisplayOrder } from './orient';
import type { Volume } from './types';

// Typed ports of the shell loaders. Engine stays pure; fetch + scaling
// live here in chrome. All fns accept an AbortSignal (async hygiene).

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

/** Decode NRRD bytes (raw/ascii/gzip, any dtype) into a display Volume. */
export function loadNrrdBuffer(buf: ArrayBuffer): Volume {
  if (!isNrrdLike(new Uint8Array(buf))) throw new Error('not an NRRD file');
  const v = parseNrrd(buf);
  return volumeFromNrrd(v.dims, v.spacing, v.data);
}

/** Decode a detached .nhdr header + its separate data payload. */
export function loadNrrdDetached(headerBuf: ArrayBuffer, data: Uint8Array): Volume {
  const v = parseNrrdDetached(headerBuf, data);
  return volumeFromNrrd(v.dims, v.spacing, v.data);
}

function volumeFromNrrd(
  dims: [number, number, number], spacing: [number, number, number], src: ArrayLike<number>,
): Volume {
  const n = dims[0] * dims[1] * dims[2];
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) data[i] = src[i]!;
  return { dims, data, spacing };
}

/**
 * Decode TIFF/OME-TIFF bytes into a display Volume: uniform same-channel
 * planes stack along z, otherwise the first plane. Spacing is unit (TIFF
 * PhysicalSize is display metadata, not geometry).
 */
export function loadOmeTiffBuffer(buf: ArrayBuffer): Volume {
  if (!isTiffLike(new Uint8Array(buf))) throw new Error('not a TIFF file');
  const { planes } = parseOmeTiff(buf);
  if (planes.length === 0) throw new Error('TIFF has no decodable planes');
  const first = planes[0]!;
  const stack = planes
    .filter((p) => p.c === first.c && p.width === first.width && p.height === first.height && p.dtype === first.dtype)
    .sort((a, b) => a.z - b.z);
  const use = stack.length > 1 ? stack : [first];
  const n = first.width * first.height;
  const data = new Float64Array(n * use.length);
  use.forEach((p, k) => {
    for (let i = 0; i < n; i++) data[k * n + i] = p.data[i]!;
  });
  return { dims: [first.width, first.height, use.length], data, spacing: [1, 1, 1] };
}

/**
 * Decode ALL planes of a TIFF/OME-TIFF into per-(t,c,z) volumes sharing the
 * first plane's geometry (uniform stacks win; odd-sized planes are skipped,
 * never stretched). Returns the volumes + 5D extents for the dimension
 * sliders. Powers the OME 5D TCZYX item; the plain loader above keeps the
 * first-channel z-stack behavior for the default upload path.
 */
export function loadOmeTiff5D(buf: ArrayBuffer): {
  vols: { t: number; c: number; z: number; vol: Volume }[];
  extents: { sizeT: number; sizeC: number; sizeZ: number };
} {
  if (!isTiffLike(new Uint8Array(buf))) throw new Error('not a TIFF file');
  const { planes } = parseOmeTiff(buf);
  if (planes.length === 0) throw new Error('TIFF has no decodable planes');
  const first = planes[0]!;
  const good = planes.filter(
    (p) => p.width === first.width && p.height === first.height && p.dtype === first.dtype,
  );
  if (good.length === 0) throw new Error('TIFF has no geometry-consistent planes');
  const n = first.width * first.height;
  // group by (t, c): each group stacks its z planes into one volume
  const groups = new Map<string, typeof good>();
  for (const p of good) {
    const k = `${p.t}/${p.c}`;
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }
  const vols = [...groups.entries()].map(([k, ps]) => {
    const [t, c] = k.split('/').map(Number);
    const zs = ps.slice().sort((a, b) => a.z - b.z);
    const data = new Float64Array(n * zs.length);
    zs.forEach((p, zi) => {
      for (let i = 0; i < n; i++) data[zi * n + i] = p.data[i]!;
    });
    return {
      t: t!, c: c!,
      z: 0,
      vol: { dims: [first.width, first.height, zs.length], data, spacing: [1, 1, 1] } as Volume,
    };
  });
  return {
    vols,
    extents: {
      sizeT: Math.max(...good.map((p) => p.t)) + 1,
      sizeC: Math.max(...good.map((p) => p.c)) + 1,
      sizeZ: Math.max(...good.map((p) => p.z)) + 1,
    },
  };
}

/**
 * One DICOM stack as a display Volume. Image Position/Orientation place it
 * in the patient (written back as a scanner-anatomical xform on export);
 * a stack without them keeps its stored order and no geometry.
 */
export function volumeFromStack(stack: DicomStack): Volume {
  const placed = stack.origin && stack.direction
    ? { geometry: { origin: stack.origin, spacing: stack.spacing, direction: stack.direction }, qformCode: 1, sformCode: 1 }
    : null;
  return toDisplayOrder({ dims: stack.dims, data: stackVoxels(stack), spacing: stack.spacing }, placed);
}

/** Fetch + parse every file (multi-frame files expand to their frames). */
export async function fetchDicomParts(urls: string[], opts: { signal?: AbortSignal } = {}): Promise<ParsedDicomSlice[]> {
  const parts: ParsedDicomSlice[] = [];
  for (const u of urls) {
    for (const p of parseDicomFrames(await fetchSample(u, opts.signal))) parts.push(p);
  }
  return parts;
}

/**
 * Load a set of DICOM files as stacks (see io/dicom-stack.ts): the files
 * are grouped by series and geometry, never stacked blindly. `pick` selects
 * which stack to open (largest first); the rest come back so the caller can
 * offer them as their own series.
 */
export async function loadDicomSeries(urls: string[], opts: { signal?: AbortSignal; pick?: number } = {}): Promise<{
  vol: Volume; meta: DicomFileMeta; stack: DicomStack; stacks: DicomStack[];
}> {
  const stacks = groupDicomStacks(await fetchDicomParts(urls, opts));
  const stack = stacks[opts.pick ?? 0] ?? stacks[0];
  if (!stack) throw new Error('no decodable DICOM images');
  return { vol: volumeFromStack(stack), meta: stack.meta, stack, stacks };
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
