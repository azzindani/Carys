// The formats the viewer does not boot with: NRRD, TIFF/OME-TIFF and DICOM
// stacks into display Volumes. Imported on first use (`await
// import('./formatLoaders')`), so their decoders — DICOM parsing, the JPEG,
// JPEG-LS and RLE codecs, OME-TIFF — load when such a file is opened,
// not with the viewer. The parse worker imports it directly.
import {
  groupDicomStacks, isNrrdLike, isTiffLike, parseDicomFrames, parseNrrd, parseNrrdDetached, parseOmeTiff,
  stackVoxels, type DicomFileMeta, type DicomStack, type ParsedDicomSlice,
} from '@carys/io';
import { fetchSample } from './loaders';
import { toDisplayOrder } from './orient';
import type { Volume } from './types';

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
