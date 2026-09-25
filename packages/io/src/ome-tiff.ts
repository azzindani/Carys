// OME-TIFF reader: TIFF 6.0 IFD chain (LE/BE, classic 32-bit offsets —
// BigTIFF 43 rejected by name) + OME-XML ImageDescription. Planes arrive as
// strips or tiles; compression 1 (raw), 5 (LZW + predictor 1/2), 7 (JPEG
// baseline mono via jpeg-baseline), 8 (deflate via fflate). Single-sample
// 8/16-bit uint/int, contiguous planar, Photometric 0/1 (6 only with JPEG,
// already folded to luma). Named OmeTiffError for everything else.
import { inflateSync, deflateSync } from 'fflate';
import { lzwDecodeTiff, lzwEncodeTiff, OmeTiffError } from './tiff-lzw.js';
import { decodeJpegBaseline } from './jpeg-baseline.js';
import { isTiffLike } from './sniff.js';

export type OmeTiffDType = 'uint8' | 'int8' | 'uint16' | 'int16';

export interface OmeTiffPlaneRef {
  ifd: number;
  c: number;
  z: number;
  t: number;
}

export interface OmeTiffMeta {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  sizeC: number;
  sizeT: number;
  dimensionOrder: string;
  pixelType: string;
  channels: string[];
  planes: OmeTiffPlaneRef[];
}

export interface OmeTiffPlane {
  width: number;
  height: number;
  dtype: OmeTiffDType;
  data: Uint8Array | Int8Array | Uint16Array | Int16Array;
  c: number;
  z: number;
  t: number;
}

// ---- TIFF low level ----

const T_SIZES: Record<number, number> = {
  1: 1, 2: 1, 6: 1, 7: 1, 3: 2, 8: 2, 4: 4, 9: 4, 11: 4, 13: 4, 5: 8, 10: 8, 12: 8, 16: 8, 17: 8, 18: 8,
};

interface TiffFile {
  dv: DataView;
  little: boolean;
  bytes: Uint8Array;
}

function openTiff(buf: ArrayBuffer): TiffFile {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 8) throw new OmeTiffError(`too small (${bytes.length} bytes)`);
  const le = bytes[0] === 0x49 && bytes[1] === 0x49;
  const be = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!le && !be) throw new OmeTiffError('bad byte-order mark (not II/MM)');
  const dv = new DataView(buf);
  if (dv.getUint16(2, le) === 43) throw new OmeTiffError('BigTIFF (version 43) not supported');
  if (dv.getUint16(2, le) !== 42) throw new OmeTiffError('bad TIFF version (not 42)');
  return { dv, little: le, bytes };
}

type EntryValue = number[] | string;

function readEntry(f: TiffFile, entryOff: number): { tag: number; value: EntryValue; count: number } {
  const { dv, little, bytes } = f;
  if (entryOff + 12 > bytes.length) throw new OmeTiffError('IFD entry runs past EOF');
  const tag = dv.getUint16(entryOff, little);
  const type = dv.getUint16(entryOff + 2, little);
  const count = dv.getUint32(entryOff + 4, little);
  const unit = T_SIZES[type];
  if (!unit) throw new OmeTiffError(`unsupported IFD field type ${type} (tag ${tag})`);
  const total = unit * count;
  let base = entryOff + 8;
  if (total > 4) {
    base = dv.getUint32(entryOff + 8, little);
    if (base + total > bytes.length) throw new OmeTiffError(`tag ${tag} data runs past EOF`);
  }
  if (type === 2) {
    const raw = bytes.slice(base, base + count);
    let end = raw.length;
    while (end > 0 && raw[end - 1] === 0) end--;
    return { tag, count, value: new TextDecoder().decode(raw.slice(0, end)) };
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const o = base + i * unit;
    switch (type) {
      case 1: case 7: out.push(dv.getUint8(o)); break;
      case 6: out.push(dv.getInt8(o)); break;
      case 3: out.push(dv.getUint16(o, little)); break;
      case 8: out.push(dv.getInt16(o, little)); break;
      case 4: case 13: out.push(dv.getUint32(o, little)); break;
      case 9: out.push(dv.getInt32(o, little)); break;
      case 11: out.push(dv.getFloat32(o, little)); break;
      case 12: out.push(dv.getFloat64(o, little)); break;
      case 5: out.push(dv.getUint32(o, little) / (dv.getUint32(o + 4, little) || 1)); break;
      case 10: out.push(dv.getInt32(o, little) / (dv.getInt32(o + 4, little) || 1)); break;
      default: out.push(NaN);
    }
  }
  return { tag, count, value: out };
}

function readIfds(f: TiffFile): Map<number, EntryValue>[] {
  const ifds: Map<number, EntryValue>[] = [];
  const seen = new Set<number>();
  let off = f.dv.getUint32(4, f.little);
  while (off !== 0) {
    if (seen.has(off)) throw new OmeTiffError('IFD chain loops');
    if (off + 2 > f.bytes.length) throw new OmeTiffError('IFD offset past EOF');
    seen.add(off);
    if (ifds.length > 4096) throw new OmeTiffError('IFD chain too long (>4096)');
    const n = f.dv.getUint16(off, f.little);
    const m = new Map<number, EntryValue>();
    for (let i = 0; i < n; i++) {
      const e = readEntry(f, off + 2 + i * 12);
      m.set(e.tag, e.value);
    }
    ifds.push(m);
    off = f.dv.getUint32(off + 2 + n * 12, f.little);
  }
  if (ifds.length === 0) throw new OmeTiffError('no IFDs');
  return ifds;
}

function nums(m: Map<number, EntryValue>, tag: number): number[] {
  const v = m.get(tag);
  return Array.isArray(v) ? v : [];
}

function num(m: Map<number, EntryValue>, tag: number, dflt: number): number {
  const v = nums(m, tag);
  return v.length > 0 ? v[0]! : dflt;
}

function text(m: Map<number, EntryValue>, tag: number): string {
  const v = m.get(tag);
  return typeof v === 'string' ? v : '';
}

function undoPredictor(raw: Uint8Array, width: number, bpe: number, little: boolean): Uint8Array {
  // Horizontal differencing (Predictor 2) undone per sample: bytes for
  // Gray8, 16-bit words in file byte order for Gray16. Single-sample only.
  const out = Uint8Array.from(raw);
  if (bpe === 1) {
    for (let r = 0; r < out.length; r += width) {
      for (let i = 1; i < width; i++) out[r + i] = (out[r + i]! + out[r + i - 1]!) & 0xff;
    }
    return out;
  }
  const dv = new DataView(out.buffer);
  const rows = out.length / (width * bpe);
  for (let r = 0; r < rows; r++) {
    const base = r * width * bpe;
    for (let i = 1; i < width; i++) {
      const v = (dv.getUint16(base + i * bpe, little) + dv.getUint16(base + (i - 1) * bpe, little)) & 0xffff;
      dv.setUint16(base + i * bpe, v, little);
    }
  }
  return out;
}

// ---- OME-XML (regex subset: Pixels attrs, Channel names, TiffData map) ----

function attrOf(tag: string, name: string): string {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return m ? m[1]! : '';
}

function parseOmeXml(xml: string): OmeTiffMeta | null {
  const pm = /<Pixels\b([^>]*)>/.exec(xml);
  if (!pm) return null;
  const open = pm[1]!;
  const num = (k: string, d: number): number => {
    const v = parseInt(attrOf(open, k), 10);
    return Number.isFinite(v) ? v : d;
  };
  const channels: string[] = [];
  const cre = /<Channel\b([^>]*)\/>/g;
  let cm: RegExpExecArray | null;
  while ((cm = cre.exec(xml)) !== null) channels.push(attrOf(cm[1]!, 'Name'));
  const planes: OmeTiffPlaneRef[] = [];
  const tre = /<TiffData\b([^>]*)\/>/g;
  let tm: RegExpExecArray | null;
  while ((tm = tre.exec(xml)) !== null) {
    const t = tm[1]!;
    const ni = (k: string, d: number): number => {
      const v = parseInt(attrOf(t, k), 10);
      return Number.isFinite(v) ? v : d;
    };
    const ifd = ni('IFD', planes.length);
    const count = ni('PlaneCount', 1);
    // Without explicit FirstC/Z/T the planes walk C (matches SizeC stride:
    // the vendored tczyx fixture + every builder-emitted file enumerate
    // per-(T,Z) TiffData elements this way, and DimensionOrder strings like
    // XYCTZ vs XYZCT disagree on which axis is "fastest" — C-walk is the
    // honest documented default, never a guess from an ambiguous string).
    const fc = attrOf(t, 'FirstC'), fz = attrOf(t, 'FirstZ'), ft = attrOf(t, 'FirstT');
    for (let p = 0; p < count; p++) {
      planes.push({
        ifd: ifd + p,
        c: fc !== '' ? ni('FirstC', 0) + p : p,
        z: fz !== '' ? ni('FirstZ', 0) : 0,
        t: ft !== '' ? ni('FirstT', 0) : 0,
      });
    }
  }
  return {
    sizeX: num('SizeX', 0), sizeY: num('SizeY', 0),
    sizeZ: num('SizeZ', 1), sizeC: num('SizeC', 1), sizeT: num('SizeT', 1),
    dimensionOrder: attrOf(open, 'DimensionOrder') || 'XYZCT',
    pixelType: attrOf(open, 'Type') || 'uint8',
    channels, planes,
  };
}

// ---- plane assembly ----

interface PlaneLayout {
  width: number;
  height: number;
  bpe: number;
  signed: boolean;
  compression: number;
  photometric: number;
  predictor: number;
  chunks: { offset: number; length: number; rows: number; top: number; left: number; w: number; h: number; fw: number; fh: number }[];
}

function layoutOf(m: Map<number, EntryValue>): PlaneLayout {
  const width = num(m, 256, 0);
  const height = num(m, 257, 0);
  if (width < 1 || height < 1 || width > 65536 || height > 65536) {
    throw new OmeTiffError(`bad image size ${width}x${height}`);
  }
  const bits = nums(m, 258);
  const bps = bits.length > 0 ? bits[0]! : 1;
  if (bps !== 8 && bps !== 16) throw new OmeTiffError(`BitsPerSample=${bps}: only 8/16-bit planes supported`);
  if (bits.some((b) => b !== bps)) throw new OmeTiffError('mixed BitsPerSample across samples unsupported');
  const spp = num(m, 277, 1);
  if (spp !== 1) throw new OmeTiffError(`SamplesPerPixel=${spp}: only single-sample planes supported`);
  const format = num(m, 339, 1);
  if (format !== 1 && format !== 2) throw new OmeTiffError(`SampleFormat=${format}: only uint/int supported`);
  const compression = num(m, 259, 1);
  if (![1, 5, 7, 8].includes(compression)) {
    throw new OmeTiffError(`Compression=${compression}: only raw/LZW/JPEG/deflate supported`);
  }
  const photometric = num(m, 262, 1);
  if (photometric !== 0 && photometric !== 1 && !(photometric === 6 && compression === 7)) {
    throw new OmeTiffError(`PhotometricInterpretation=${photometric} unsupported here`);
  }
  const planar = num(m, 284, 1);
  if (planar !== 1) throw new OmeTiffError('separate planes (PlanarConfiguration 2) unsupported');
  const predictor = num(m, 317, 1);
  if (predictor !== 1 && predictor !== 2) throw new OmeTiffError(`Predictor=${predictor} unsupported`);
  const bpe = bps / 8;
  const chunks: PlaneLayout['chunks'] = [];
  if (m.has(322)) {
    const tw = num(m, 322, 0), th = num(m, 323, 0);
    const offs = nums(m, 324), counts = nums(m, 325);
    if (tw < 1 || th < 1) throw new OmeTiffError('bad tile size');
    const across = Math.ceil(width / tw), down = Math.ceil(height / th);
    if (offs.length !== across * down || counts.length !== across * down) {
      throw new OmeTiffError(`tile tables ${offs.length}/${counts.length} != ${across}x${down} grid`);
    }
    for (let ty = 0; ty < down; ty++) {
      for (let tx = 0; tx < across; tx++) {
        const k = ty * across + tx;
        chunks.push({
          offset: offs[k]!, length: counts[k]!,
          rows: th, top: ty * th, left: tx * tw,
          w: Math.min(tw, width - tx * tw), h: Math.min(th, height - ty * th),
          fw: tw, fh: th,
        });
      }
    }
  } else {
    const offs = nums(m, 273), counts = nums(m, 279);
    if (offs.length === 0 || offs.length !== counts.length) {
      throw new OmeTiffError('StripOffsets/StripByteCounts missing or mismatched');
    }
    const rps = num(m, 278, 0xffffffff);
    let top = 0;
    for (let s = 0; s < offs.length; s++) {
      const h = Math.min(rps, height - top);
      if (h <= 0) throw new OmeTiffError('strip layout overruns image height');
      chunks.push({ offset: offs[s]!, length: counts[s]!, rows: h, top, left: 0, w: width, h, fw: width, fh: h });
      top += h;
    }
    if (top !== height) throw new OmeTiffError(`strips cover ${top} rows != ${height}`);
  }
  return { width, height, bpe, signed: format === 2, compression, photometric, predictor, chunks };
}

/**
 * Decode one strip/tile payload. Returns bytes + stored row stride in
 * pixels: edge tiles arrive full-size (padded) from most writers and
 * cropped from others — both accepted, cropped on paste.
 */
function decodeChunk(
  f: TiffFile, lay: PlaneLayout, ch: PlaneLayout['chunks'][number],
): { bytes: Uint8Array; strideW: number } {
  if (ch.offset + ch.length > f.bytes.length) throw new OmeTiffError('chunk runs past EOF');
  const payload = f.bytes.slice(ch.offset, ch.offset + ch.length);
  const { bpe } = lay;
  const wantCrop = ch.w * ch.h * bpe;
  const wantFull = ch.fw * ch.fh * bpe;
  if (lay.compression === 1) {
    // Raw: accept full or cropped (trailing pad tolerated above full).
    if (payload.length >= wantFull) return { bytes: payload.slice(0, wantFull), strideW: ch.fw };
    if (payload.length >= wantCrop) return { bytes: payload.slice(0, wantCrop), strideW: ch.w };
    throw new OmeTiffError(`raw chunk short: ${payload.length} < ${wantCrop}`);
  }
  if (lay.compression === 8) {
    let raw: Uint8Array;
    try {
      raw = inflateSync(payload);
    } catch (e) {
      throw new OmeTiffError(`deflate chunk corrupt: ${(e as Error).message}`);
    }
    const sized = sizeChunk(raw, wantCrop, wantFull, 'deflated');
    const full = sized.length === wantFull;
    const out = lay.predictor === 2 ? undoPredictor(sized, full ? ch.fw : ch.w, bpe, f.little) : sized;
    return { bytes: out, strideW: full ? ch.fw : ch.w };
  }
  if (lay.compression === 5) {
    return finishLzw(payload, wantCrop, wantFull, ch.w, ch.fw, lay.predictor, bpe, f.little);
  }
  // Compression 7: baseline JPEG tile, folded to luma by the shared decoder.
  let jpg: { width: number; height: number; gray: Uint8Array };
  try {
    jpg = decodeJpegBaseline(payload);
  } catch (e) {
    throw new OmeTiffError(`JPEG tile corrupt: ${(e as Error).message}`);
  }
  if (jpg.width === ch.w && jpg.height === ch.h) return { bytes: jpg.gray, strideW: ch.w };
  if (jpg.width === ch.fw && jpg.height === ch.fh) return { bytes: jpg.gray, strideW: ch.fw };
  throw new OmeTiffError(`JPEG tile ${jpg.width}x${jpg.height} fits neither crop ${ch.w}x${ch.h} nor tile ${ch.fw}x${ch.fh}`);
}

function sizeChunk(raw: Uint8Array, wantCrop: number, wantFull: number, what: string): Uint8Array {
  if (raw.length >= wantFull) return raw.slice(0, wantFull);
  if (raw.length >= wantCrop) return raw.slice(0, wantCrop);
  throw new OmeTiffError(`${what} ${raw.length} bytes fits neither crop ${wantCrop} nor tile ${wantFull}`);
}

function finishLzw(
  payload: Uint8Array, wantCrop: number, wantFull: number, w: number, fullW: number,
  predictor: number, bpe: number, little: boolean,
): { bytes: Uint8Array; strideW: number } {
  // LZW has no padding concept: exact cropped or full size required.
  // Try full first (padded edge tiles), fall back to cropped.
  const attempt = (want: number, stride: number): { bytes: Uint8Array; strideW: number } | null => {
    try {
      const raw = lzwDecodeTiff(payload, want);
      return { bytes: predictor === 2 ? undoPredictor(raw, stride, bpe, little) : raw, strideW: stride };
    } catch {
      return null;
    }
  };
  return attempt(wantFull, fullW) ?? attempt(wantCrop, w) ?? (() => {
    throw new OmeTiffError(`LZW payload fits neither crop ${wantCrop} nor tile ${wantFull} bytes`);
  })();
}

/**
 * Full OME-TIFF (or plain TIFF) reader -> decoded planes in IFD order.
 * meta is null without OME-XML (planes get c=0, z=ifd, t=0). Throws
 * OmeTiffError on bad structure, unsupported features, or short data.
 */
export function parseOmeTiff(buf: ArrayBuffer): { meta: OmeTiffMeta | null; planes: OmeTiffPlane[] } {
  const f = openTiff(buf);
  const ifds = readIfds(f);
  let xml = '';
  for (const m of ifds) {
    const d = text(m, 270);
    if (d.includes('<OME')) { xml = d; break; }
  }
  const meta = xml ? parseOmeXml(xml) : null;
  const planes: OmeTiffPlane[] = [];
  ifds.forEach((m, fi) => {
    const lay = layoutOf(m);
    const { width, height, bpe, signed } = lay;
    const plane = new Uint8Array(width * height * bpe);
    for (const ch of lay.chunks) {
      const { bytes: raw, strideW } = decodeChunk(f, lay, ch);
      // Tile rows may be wider than the visible crop (right/bottom edges).
      for (let r = 0; r < ch.h; r++) {
        const src = raw.subarray(r * strideW * bpe, (r * strideW + ch.w) * bpe);
        plane.set(src, ((ch.top + r) * width + ch.left) * bpe);
      }
    }
    if (!f.little && bpe > 1) {
      // Typed arrays are native-endian: swap big-endian samples in place.
      for (let i = 0; i < plane.length; i += bpe) {
        for (let b = 0; b < bpe / 2; b++) {
          const t = plane[i + b]!;
          plane[i + b] = plane[i + bpe - 1 - b]!;
          plane[i + bpe - 1 - b] = t;
        }
      }
    }
    const bits = bpe * 8;
    const dtype: OmeTiffDType = bits === 8 ? (signed ? 'int8' : 'uint8') : signed ? 'int16' : 'uint16';
    let data: OmeTiffPlane['data'];
    if (dtype === 'uint8') data = new Uint8Array(plane.buffer);
    else if (dtype === 'int8') data = new Int8Array(plane.buffer);
    else if (dtype === 'uint16') data = new Uint16Array(plane.buffer);
    else data = new Int16Array(plane.buffer);
    if (lay.photometric === 0) {
      // Min-is-white: invert into min-is-black (unsigned planes in practice).
      const max = bits === 8 ? 255 : 65535;
      for (let i = 0; i < data.length; i++) data[i] = max - data[i]!;
    }
    const ref = meta?.planes.find((p) => p.ifd === fi);
    planes.push({
      width, height, dtype, data,
      c: ref?.c ?? 0, z: ref?.z ?? fi, t: ref?.t ?? 0,
    });
  });
  return { meta, planes };
}

/** OME sniff: TIFF magic + an OME-XML marker in the first 256 KiB. */
export function isOmeTiffLike(bytes: Uint8Array): boolean {
  if (!isTiffLike(bytes)) return false;
  return new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 262144))).includes('<OME');
}

export interface OmeTiffBuildPlane {
  w: number;
  h: number;
  /** display values row-major (builder inverts for photometric 0, differences for predictor 2) */
  values: number[];
  bits?: 8 | 16;
  compression?: 1 | 5 | 7 | 8;
  predictor?: 1 | 2;
  photometric?: 0 | 1;
  tiled?: { tw: number; th: number };
  rowsPerStrip?: number;
  /** verbatim payload per chunk for compression 7 (must match stored chunk dims) */
  jpegBytes?: Uint8Array;
}

interface BuildChunk { bytes: Uint8Array }

/** Test-only builder: little-endian classic TIFF (+ optional OME-XML). */
export function makeOmeTiff(
  planes: OmeTiffBuildPlane[],
  opts: { omexml?: string | null; channels?: string[] } = {},
): ArrayBuffer {
  if (planes.length === 0) throw new OmeTiffError('builder needs at least one plane');
  // Phase 1: payloads (no offsets needed yet).
  const dv = new DataView(new ArrayBuffer(8));
  const numBytes = (v: number, bpe: number): number[] => {
    if (bpe === 1) return [v & 0xff];
    dv.setUint16(0, v, true);
    return [dv.getUint8(0), dv.getUint8(1)];
  };
  const payloads: BuildChunk[][] = planes.map((p) => {
    const bits = p.bits ?? 8;
    const bpe = bits / 8;
    const max = bits === 8 ? 255 : 65535;
    if (p.w < 1 || p.h < 1 || p.w > 1024 || p.h > 1024) throw new OmeTiffError('builder dims out of range');
    if (p.values.length !== p.w * p.h) throw new OmeTiffError('builder values size mismatch');
    let stored = p.values.map((v) => (p.photometric ?? 1) === 0 ? max - v : v);
    if ((p.predictor ?? 1) === 2) {
      stored = stored.map((v, i) => (i % p.w === 0 ? v : (v - stored[i - 1]!) & max));
    }
    const raw = new Uint8Array(p.w * p.h * bpe);
    stored.forEach((v, i) => raw.set(numBytes(v, bpe), i * bpe));
    const comp = p.compression ?? 1;
    const encode = (bytes: Uint8Array): Uint8Array => {
      if (comp === 1) return bytes;
      if (comp === 5) return lzwEncodeTiff(bytes);
      if (comp === 8) return deflateSync(bytes);
      if (!p.jpegBytes) throw new OmeTiffError('builder: jpegBytes required for compression 7');
      return p.jpegBytes;
    };
    const out: BuildChunk[] = [];
    if (p.tiled) {
      const { tw, th } = p.tiled;
      for (let ty = 0; ty * th < p.h; ty++) {
        for (let tx = 0; tx * tw < p.w; tx++) {
          const cw = Math.min(tw, p.w - tx * tw), chh = Math.min(th, p.h - ty * th);
          const full = new Uint8Array(tw * th * bpe); // edge tiles padded full
          for (let r = 0; r < chh; r++) {
            full.set(
              raw.subarray(((ty * th + r) * p.w + tx * tw) * bpe, ((ty * th + r) * p.w + tx * tw + cw) * bpe),
              r * tw * bpe,
            );
          }
          out.push({ bytes: encode(full) });
        }
      }
    } else {
      const rps = p.rowsPerStrip ?? p.h;
      for (let top = 0; top < p.h; top += rps) {
        const h = Math.min(rps, p.h - top);
        out.push({ bytes: encode(raw.subarray(top * p.w * bpe, (top + h) * p.w * bpe)) });
      }
    }
    return out;
  });
  // Phase 2: layout. Entry descriptor: tag/type/count + inline bytes or blob.
  interface Desc { tag: number; type: number; count: number; inline: number[] | null; blob: number[] | null }
  const shorts = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
  const longs = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
  const descOf = (p: OmeTiffBuildPlane, chunks: BuildChunk[], xml: string | null): Desc[] => {
    const list: Desc[] = [
      { tag: 256, type: 3, count: 1, inline: [...shorts(p.w), 0, 0], blob: null },
      { tag: 257, type: 3, count: 1, inline: [...shorts(p.h), 0, 0], blob: null },
      { tag: 258, type: 3, count: 1, inline: [...shorts(p.bits ?? 8), 0, 0], blob: null },
      { tag: 259, type: 3, count: 1, inline: [...shorts(p.compression ?? 1), 0, 0], blob: null },
      { tag: 262, type: 3, count: 1, inline: [...shorts(p.photometric ?? 1), 0, 0], blob: null },
    ];
    if ((p.predictor ?? 1) === 2) {
      list.push({ tag: 317, type: 3, count: 1, inline: [...shorts(2), 0, 0], blob: null });
    }
    const offTag = p.tiled ? 324 : 273;
    const cntTag = p.tiled ? 325 : 279;
    if (chunks.length === 1) {
      list.push({ tag: offTag, type: 4, count: 1, inline: null, blob: null }); // offset patched
      list.push({ tag: cntTag, type: 4, count: 1, inline: longs(chunks[0]!.bytes.length), blob: null });
    } else {
      list.push({ tag: offTag, type: 4, count: chunks.length, inline: null, blob: null }); // array patched
      list.push({ tag: cntTag, type: 4, count: chunks.length, inline: null, blob: chunks.flatMap((c) => longs(c.bytes.length)) });
    }
    if (!p.tiled) {
      const rps = p.rowsPerStrip ?? p.h;
      list.push({ tag: 278, type: 4, count: 1, inline: longs(rps), blob: null });
    } else {
      list.push({ tag: 322, type: 3, count: 1, inline: [...shorts(p.tiled.tw), 0, 0], blob: null });
      list.push({ tag: 323, type: 3, count: 1, inline: [...shorts(p.tiled.th), 0, 0], blob: null });
    }
    if (xml !== null) {
      const ascii = [...new TextEncoder().encode(xml), 0];
      list.push({ tag: 270, type: 2, count: ascii.length, inline: null, blob: ascii });
    }
    return list;
  };
  const xmlForDefault = (): string => {
    const w = planes[0]!.w, h = planes[0]!.h;
    // Single-channel z-stack: one channel, N TiffData planes walking Z
    // (explicit FirstZ — the bare-IFD C-walk default would stack them as
    // channels and collapse the volume to a single slice).
    const names = opts.channels ?? ['C0'];
    const ch = names.map((n, i) => `<Channel ID="Channel:0:${i}" Name="${n}" SamplesPerPixel="1"/>`).join('');
    const td = planes.map((_, i) => `<TiffData IFD="${i}" PlaneCount="1" FirstC="0" FirstZ="${i}" FirstT="0"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06"><Image ID="Image:0"><Pixels DimensionOrder="XYZCT" ID="Pixels:0" SizeC="1" SizeT="1" SizeX="${w}" SizeY="${h}" SizeZ="${planes.length}" Type="uint8">${ch}${td}</Pixels></Image></OME>`;
  };
  const useXml = opts.omexml === undefined ? xmlForDefault() : opts.omexml;
  const descs = planes.map((p, i) => descOf(p, payloads[i]!, i === 0 ? useXml : null));
  // Phase 3: emit. Header + IFDs first (sizes known), then blobs.
  const out: number[] = [0x49, 0x49, 42, 0, 0, 0, 0, 0];
  const ifdAt: number[] = [];
  for (const d of descs) {
    ifdAt.push(out.length);
    out.push(0, 0); // count patched below
    for (let k = 0; k < d.length; k++) out.push(...new Array(12).fill(0));
    out.push(0, 0, 0, 0); // next-IFD patched below
  }
  const patchU16 = (at: number, v: number): void => { out[at] = v & 0xff; out[at + 1] = (v >> 8) & 0xff; };
  const patchU32 = (at: number, v: number): void => {
    out[at] = v & 0xff; out[at + 1] = (v >> 8) & 0xff; out[at + 2] = (v >> 16) & 0xff; out[at + 3] = (v >> 24) & 0xff;
  };
  const allocBlob = (bytes: ArrayLike<number>): number => {
    while (out.length % 2) out.push(0);
    const at = out.length;
    for (let i = 0; i < bytes.length; i++) out.push(bytes[i]!);
    return at;
  };
  patchU32(4, ifdAt[0]!);
  planes.forEach((p, pi) => {
    const d = descs[pi]!;
    const base = ifdAt[pi]!;
    patchU16(base, d.length);
    // Chunk payloads first so offset arrays can reference them.
    const offs = payloads[pi]!.map((c) => allocBlob(c.bytes));
    d.forEach((e, i) => {
      const at = base + 2 + i * 12;
      patchU16(at, e.tag);
      patchU16(at + 2, e.type);
      patchU32(at + 4, e.count);
      const isOff = (e.tag === 273 || e.tag === 324);
      if (e.inline) {
        for (let k = 0; k < 4; k++) out[at + 8 + k] = e.inline[k] ?? 0;
      } else if (isOff && offs.length === 1) {
        patchU32(at + 8, offs[0]!);
      } else if (isOff) {
        patchU32(at + 8, allocBlob(offs.flatMap(longs)));
      } else if (e.blob) {
        patchU32(at + 8, allocBlob(e.blob));
      }
    });
    patchU32(base + 2 + d.length * 12, pi + 1 < planes.length ? ifdAt[pi + 1]! : 0);
    void p;
  });
  return new Uint8Array(out).buffer as ArrayBuffer;
}

