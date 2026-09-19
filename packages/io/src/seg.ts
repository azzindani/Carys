// DICOM Segmentation (Sup 58) parse + write.
// Writer emits axial frames ordered by (segment, slice); the reader maps
// frame z-positions onto caller-supplied slice geometry. Bit-packed
// 1-bit frames, MSB first, rows byte-padded.
import { readDataset, type Dataset } from './dcm-read.js';
import { makeUID, writePart10, type DcmElement, type DcmItem } from './dcm-write.js';

export const SEG_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.66.4';

export interface SegSegment {
  number: number; // 1-based
  label: string;
}

export interface SegFrame {
  segmentNumber: number;
  z: number;
  bits: Uint8Array; // packed, rows*strideBytes
}

export interface SegObject {
  segments: SegSegment[];
  frames: SegFrame[];
  rows: number;
  cols: number;
}

export function parseSEG(buffer: ArrayBuffer): SegObject {
  const ds = readDataset(buffer);
  const sop = ds.text('00080016');
  if (sop !== SEG_SOP_CLASS) throw new Error(`not a SEG object: ${sop}`);
  const rows = ds.number('00280010')!;
  const cols = ds.number('00280011')!;
  const frames = ds.number('00280008') ?? 0;
  const bitsAllocated = ds.number('00280100');
  if (bitsAllocated !== 1) throw new Error(`SEG BitsAllocated=${bitsAllocated}, need 1`);
  const segments: SegSegment[] = ds.sequence('00620002').map((item) => ({
    number: item.number('00620004') ?? 0,
    label: item.text('00620005') ?? `Segment ${item.number('00620004') ?? 0}`,
  }));
  const pixelData = ds.bytes('7FE00010');
  if (!pixelData) throw new Error('SEG has no PixelData');
  const stride = Math.ceil(cols / 8);
  const frameBytes = rows * stride;
  if (pixelData.length < frames * frameBytes) {
    throw new Error(`SEG PixelData short: ${pixelData.length} < ${frames * frameBytes}`);
  }
  const perFrame = ds.sequence('52009230');
  const out: SegFrame[] = [];
  for (let f = 0; f < frames; f++) {
    const item = perFrame[f];
    if (!item) throw new Error(`SEG missing per-frame item ${f}`);
    // DimensionIndexValues lives in FrameContentSequence (00209111)
    const frameContent = item.sequence('00209111')[0];
    const div = frameContent ? frameContent.numbers('00209157') : [];
    const planePos = item.sequence('00209113')[0];
    const ipp = planePos ? planePos.numbers('00200032') : [];
    out.push({
      segmentNumber: div[0] ?? 1,
      z: ipp[2] ?? f,
      bits: pixelData.slice(f * frameBytes, (f + 1) * frameBytes),
    });
  }
  return { segments, frames: out, rows, cols };
}

/** Unpack one bit-packed frame (MSB first, byte-padded rows) to binary. */
export function unpackFrame(bits: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows);
  const stride = Math.ceil(cols / 8);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const byte = bits[r * stride + (c >> 3)]!;
      out[r * cols + c] = (byte >> (7 - (c & 7))) & 1;
    }
  }
  return out;
}

function packFrame(slice: Uint8Array, cols: number, rows: number): Uint8Array {
  const stride = Math.ceil(cols / 8);
  const out = new Uint8Array(rows * stride);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (slice[r * cols + c]) out[r * stride + (c >> 3)]! |= 1 << (7 - (c & 7));
    }
  }
  return out;
}

export interface SegGeometry {
  dims: [number, number, number];
  /** slice z per index (patient coords); frames snap to nearest */
  sliceZs: number[];
  origin?: [number, number, number];
}

/** Rasterize SEG frames into per-segment masks on the given geometry. */
export function segToMasks(seg: SegObject, geo: SegGeometry): Map<number, Uint8Array> {
  const [nx, ny, nz] = geo.dims;
  const masks = new Map<number, Uint8Array>();
  for (const s of seg.segments) masks.set(s.number, new Uint8Array(nx * ny * nz));
  const order = geo.sliceZs.map((z, i) => ({ z, i })).sort((a, b) => a.z - b.z);
  for (const f of seg.frames) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < order.length; k++) {
      const d = Math.abs(order[k]!.z - f.z);
      if (d < bd) { bd = d; best = k; }
    }
    const slice = order[best]!.i;
    const m = masks.get(f.segmentNumber);
    if (!m) continue;
    const bits = unpackFrame(f.bits, seg.cols, seg.rows);
    // resample rows/cols if the SEG grid differs from the target grid
    for (let y = 0; y < ny; y++) {
      const sy = Math.min(seg.rows - 1, Math.floor((y * seg.rows) / ny));
      for (let x = 0; x < nx; x++) {
        const sx = Math.min(seg.cols - 1, Math.floor((x * seg.cols) / nx));
        if (bits[sy * seg.cols + sx]) m[slice * nx * ny + y * nx + x] = 1;
      }
    }
  }
  return masks;
}

export interface SegWriteOpts {
  segments: { label: string; mask: Uint8Array }[];
  dims: [number, number, number];
  spacing?: [number, number, number];
  origin?: [number, number, number];
  sliceThickness?: number;
  seriesUID?: string;
  studyUID?: string;
}

/** Encode labelmaps as a multiframe SEG Part-10 file. */
export function writeSEG(opts: SegWriteOpts): ArrayBuffer {
  const [nx, ny, nz] = opts.dims;
  const sp = opts.spacing ?? [1, 1, 1];
  const origin = opts.origin ?? [0, 0, 0];
  const seriesUID = opts.seriesUID ?? makeUID();
  const studyUID = opts.studyUID ?? makeUID();
  const sopUID = makeUID();
  const segItems: DcmItem[] = opts.segments.map((s, i) => ({
    elements: [
      { tag: [0x0062, 0x0004], vr: 'US', value: i + 1 },
      { tag: [0x0062, 0x0005], vr: 'LO', value: s.label },
      { tag: [0x0062, 0x0006], vr: 'LO', value: 'Manual segmentation' },
      { tag: [0x0062, 0x0008], vr: 'CS', value: 'MANUAL' },
    ],
  }));
  const frameItems: { elements: DcmElement[] }[] = [];
  const pixelBytes: number[] = [];
  for (let s = 0; s < opts.segments.length; s++) {
    for (let z = 0; z < nz; z++) {
      const slice = opts.segments[s]!.mask.subarray(z * nx * ny, (z + 1) * nx * ny);
      const packed = packFrame(slice, nx, ny);
      for (const byte of packed) pixelBytes.push(byte);
      frameItems.push({
        elements: [
          {
            tag: [0x0020, 0x9113], vr: 'SQ', value: [{
              elements: [{
                tag: [0x0020, 0x0032], vr: 'DS',
                value: [origin[0], origin[1], origin[2] + z * sp[2]],
              }],
            }],
          },
          {
            tag: [0x0020, 0x9111], vr: 'SQ', value: [{
              elements: [{
                tag: [0x0020, 0x9157], vr: 'US', value: [s + 1, 1, z + 1],
              }],
            }],
          },
        ],
      });
    }
  }
  const dataset: DcmElement[] = [
    { tag: [0x0008, 0x0016], vr: 'UI', value: SEG_SOP_CLASS },
    { tag: [0x0008, 0x0018], vr: 'UI', value: sopUID },
    { tag: [0x0020, 0x000d], vr: 'UI', value: studyUID },
    { tag: [0x0020, 0x000e], vr: 'UI', value: seriesUID },
    { tag: [0x0020, 0x0011], vr: 'IS', value: 1 },
    { tag: [0x0028, 0x0002], vr: 'US', value: 1 },
    { tag: [0x0028, 0x0004], vr: 'CS', value: 'MONOCHROME2' },
    { tag: [0x0028, 0x0010], vr: 'US', value: ny },
    { tag: [0x0028, 0x0011], vr: 'US', value: nx },
    { tag: [0x0028, 0x0008], vr: 'IS', value: frameItems.length },
    { tag: [0x0028, 0x0100], vr: 'US', value: 1 },
    { tag: [0x0028, 0x0101], vr: 'US', value: 1 },
    { tag: [0x0028, 0x0102], vr: 'US', value: 0 },
    { tag: [0x0028, 0x0103], vr: 'US', value: 0 },
    { tag: [0x0062, 0x0001], vr: 'US', value: opts.segments.length },
    { tag: [0x0062, 0x0002], vr: 'SQ', value: segItems },
    {
      tag: [0x5200, 0x9229], vr: 'SQ', value: [{
        elements: [
          {
            tag: [0x0028, 0x9110], vr: 'SQ', value: [{
              elements: [
                { tag: [0x0018, 0x0050], vr: 'DS', value: opts.sliceThickness ?? sp[2] },
                { tag: [0x0028, 0x0030], vr: 'DS', value: [sp[1], sp[0]] },
                {
                  tag: [0x0020, 0x0037], vr: 'DS',
                  value: [1, 0, 0, 0, 1, 0],
                },
              ],
            }],
          },
        ],
      }],
    },
    { tag: [0x5200, 0x9230], vr: 'SQ', value: frameItems },
    { tag: [0x7fe0, 0x0010], vr: 'OB', value: new Uint8Array(pixelBytes) },
  ];
  return writePart10(SEG_SOP_CLASS, sopUID, dataset);
}

export function datasetOf(buffer: ArrayBuffer): Dataset {
  return readDataset(buffer);
}
