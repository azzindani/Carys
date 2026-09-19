// Ported from Cornerstone generateVolumeProps/sortImageIds + ITK-Wasm
// readImageDicomFileSeries orchestrator (chunk blocks of 8 -> runTasks ->
// stackImages). CPU-only: File[] become BinaryFile in memory, no Wasm.

import { WorkerPool, defaultPoolSize } from '@carys/volume-core';
import type { BinaryFile } from '@carys/volume-core';
import type { Volume } from '@carys/volume-core';

export interface DicomSeriesOptions {
  inputImages: BinaryFile[];
  singleSortedSeries?: boolean;
  poolSize?: number;
}

export interface DicomSeriesResult {
  outputVolume: Volume;
  sortedFilenames: string[];
}

type Vec3 = [number, number, number];

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Sort slices along scan normal (Cornerstone sortImageIdsAndGetSpacing):
 * normal = rowCos x colCos; dist = dot(refIPP - ipp, normal); desc order.
 */
export function sortSlicesByPosition<T extends { ipp: Vec3 }>(
  slices: T[],
  rowCos: Vec3,
  colCos: Vec3,
): T[] {
  if (slices.length === 0) return slices;
  const normal = cross(rowCos, colCos);
  const ref = slices[0].ipp;
  return [...slices]
    .map((s) => ({ s, d: dot([ref[0] - s.ipp[0], ref[1] - s.ipp[1], ref[2] - s.ipp[2]], normal) }))
    .sort((a, b) => b.d - a.d)
    .map((e) => e.s);
}

/** zSpacing with SliceThickness -> pixelSpacing -> 1 fallback chain. */
export function zSpacing(
  sortedDistances: number[],
  fallback = 1,
): number {
  if (sortedDistances.length > 1) {
    const span = Math.abs(sortedDistances[0] - sortedDistances[sortedDistances.length - 1]);
    const s = span / (sortedDistances.length - 1);
    if (s > 0 && Number.isFinite(s)) return s;
  }
  return fallback > 0 && Number.isFinite(fallback) ? fallback : 1;
}

const SERIES_BLOCK = 8;

/** Orchestrator shape of readImageDicomFileSeries (blocks of 8 -> stitch). */
export async function readDicomSeries(
  opts: DicomSeriesOptions,
  decodeBlock: (files: BinaryFile[]) => Promise<Volume[]>,
): Promise<DicomSeriesResult> {
  if (opts.inputImages.length < 1) throw new Error('No input images');
  const pool = new WorkerPool(opts.poolSize ?? defaultPoolSize(), async (args) =>
    decodeBlock(args[0] as BinaryFile[]),
  );
  const blocks: BinaryFile[][] = [];
  for (let i = 0; i < opts.inputImages.length; i += SERIES_BLOCK) {
    blocks.push(opts.inputImages.slice(i, i + SERIES_BLOCK));
  }
  const { promise } = pool.runTasks(blocks.map((b) => [b]));
  const nested = (await promise) as Volume[][];
  const slabs = nested.flat();
  return { outputVolume: stackVolumes(slabs), sortedFilenames: opts.inputImages.map((f) => f.path) };
}

/** Slab stitch along z (ITK-Wasm stack-images, lite). */
export function stackVolumes(slabs: Volume[]): Volume {
  if (slabs.length === 0) throw new Error('No slabs to stack');
  if (slabs.length === 1) return slabs[0];
  const [nx, ny] = slabs[0].dims;
  let nz = 0;
  for (const s of slabs) {
    if (s.dims[0] !== nx || s.dims[1] !== ny) throw new Error('Slab dims mismatch');
    nz += s.dims[2];
  }
  const first = slabs[0];
  const data =
    first.data instanceof Int16Array
      ? new Int16Array(nx * ny * nz)
      : first.data instanceof Float32Array
        ? new Float32Array(nx * ny * nz)
        : new Uint8Array(nx * ny * nz);
  let off = 0;
  for (const s of slabs) {
    (data as Uint8Array).set(s.data as Uint8Array, off);
    off += s.data.length;
  }
  return {
    dims: [nx, ny, nz],
    spacing: first.spacing,
    origin: first.origin,
    dtype: first.dtype,
    data: data as Volume['data'],
  };
}
