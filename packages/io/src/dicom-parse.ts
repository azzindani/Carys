// Single-file DICOM byte decoder — ported from Daikon Parser.parse +
// Series.parseImage + Image.getInterpretedData (MIT), shape trimmed for a
// CPU-only static viewer. Native syntaxes only (implicit/explicit LE, explicit
// BE); encapsulated/compressed pixel data throws a named error instead of
// misdecoding. No compression deps. See docs/DIGEST-GROUP1.md.

import type { DicomSlice } from './dicom.js';
import {
  TS_IMPLICIT_LE, TS_EXPLICIT_LE, TS_EXPLICIT_BE, TS_DEFLATED,
} from './dicom-tags.js';
import { isKnownVR, isLength32VR } from './dicom-vr.js';
import { cineFields, foldYbrFrame } from './us.js';
import type { EncapFrames } from './dicom-encap.js';
import { readEncapsulated } from './dicom-encap.js';
import { decodeCompressed, isCompressedSyntax } from './dicom-frames.js';
import { inflateDeflatedDataset } from './dicom-deflate.js';
import { groupGeometry, readFunctionalGroups } from './dicom-groups.js';

const UNDEFINED_LENGTH = 0xffffffff;

export type DicomParseErrorKind =
  | 'truncated'
  | 'unsupported-transfer-syntax'
  | 'encapsulated-requires-decoder'
  | 'encapsulated-framing-error'
  | 'rle-decode-error'
  | 'jpeg-decode-error'
  | 'jpeg-unsupported'
  | 'deflate-error'
  | 'unsupported-pixel-layout'
  | 'multi-frame-unsupported';

export class DicomParseError extends Error {
  kind: DicomParseErrorKind;
  constructor(kind: DicomParseErrorKind, detail: string) {
    super(`DICOM ${kind}: ${detail}`);
    this.kind = kind;
  }
}

interface RawTag {
  group: number;
  element: number;
  vr: string;
  valueOffset: number;
  valueLength: number;
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0').toUpperCase();
const tagId = (g: number, e: number) => hex4(g) + hex4(e);

export class Walker {
  view: DataView;
  bytes: Uint8Array;
  little = true;
  explicit = true;
  transferSyntax = '';
  metaFinished = false;
  metaFinishedOffset = -1;
  tags = new Map<string, RawTag>();
  encap: EncapFrames | null = null;

  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf);
    this.bytes = new Uint8Array(buf);
  }

  u16(off: number, le = this.little): number { return this.view.getUint16(off, le); }
  u32(off: number, le = this.little): number { return this.view.getUint32(off, le); }

  str(off: number, len: number): string {
    let s = '';
    for (let i = 0; i < len; i++) {
      const c = this.bytes[off + i]!;
      if (c === 0) continue;
      s += String.fromCharCode(c);
    }
    return s;
  }

  firstTagOffset(): number {
    const b = this.bytes;
    if (b.length > 132 && b[128] === 68 && b[129] === 73 && b[130] === 67 && b[131] === 77) {
      return 132;
    }
    for (let i = 0; i < Math.min(640, b.length - 4); i++) {
      if (b[i] === 68 && b[i + 1] === 73 && b[i + 2] === 67 && b[i + 3] === 77) return i + 4;
    }
    return 0;
  }

  /**
   * Skip a UN-wrapped implicit sequence (dicomParser
   * readSequenceElementImplicit port): items are tag + u32 length with no VR.
   * Returns the offset past the sequence delimitation. Throws truncated on
   * runaway or on nested undefined lengths (bounded port, stated).
   */
  skipImplicitSequence(off: number): number {
    const end = this.bytes.length;
    let p = off;
    for (;;) {
      if (p + 8 > end) throw new DicomParseError('truncated', 'unterminated implicit sequence');
      const g = this.view.getUint16(p, this.little);
      const e = this.view.getUint16(p + 2, this.little);
      const l = this.view.getUint32(p + 4, this.little);
      if (g === 0xfffe && e === 0xe0dd) return p + 8;
      if (g !== 0xfffe || e !== 0xe000) {
        throw new DicomParseError('truncated', 'non-item tag inside implicit sequence');
      }
      if (l === UNDEFINED_LENGTH) {
        let q = p + 8;
        for (;;) {
          if (q + 8 > end) throw new DicomParseError('truncated', 'unterminated implicit item');
          const ig = this.view.getUint16(q, this.little);
          const ie = this.view.getUint16(q + 2, this.little);
          const il = this.view.getUint32(q + 4, this.little);
          if (ig === 0xfffe && ie === 0xe00d) { q += 8; break; }
          if (ig === 0xfffe || il === UNDEFINED_LENGTH || q + 8 + il > end) {
            throw new DicomParseError('truncated', 'bad implicit item element');
          }
          q += 8 + il;
        }
        p = q;
        continue;
      }
      if (p + 8 + l > end) throw new DicomParseError('truncated', 'implicit item overruns buffer');
      p += 8 + l;
    }
  }

  /** Skip an SQ element (defined or undefined length), return offsetEnd. */
  skipSequence(off: number, len: number): number {
    if (len !== UNDEFINED_LENGTH) return off + len;
    // undefined length: scan items/delimiters with nesting depth
    let depth = 1;
    let p = off;
    while (p + 8 <= this.bytes.length) {
      const g = this.view.getUint16(p, this.little);
      const e = this.view.getUint16(p + 2, this.little);
      const l = this.view.getUint32(p + 4, this.little);
      if (g === 0xfffe && e === 0xe0dd) return p + 8; // sequence delimitation
      if (g === 0xfffe && e === 0xe000) {
        if (l === UNDEFINED_LENGTH) { depth++; p += 8; continue; }
        p += 8 + l;
        continue;
      }
      if (g === 0xfffe && e === 0xe00d) { depth--; p += 8; if (depth <= 0) continue; continue; }
      // nested defined element inside item: group/element + VR + length
      const vr = this.str(p + 4, 2);
      if (isKnownVR(vr)) {
        const ll = isLength32VR(vr) ? this.view.getUint32(p + 8, this.little) : this.view.getUint16(p + 6, this.little);
        const hd = isLength32VR(vr) ? 12 : 8;
        p += ll === UNDEFINED_LENGTH ? hd : hd + ll;
      } else {
        p += 8 + this.view.getUint32(p + 4, this.little);
      }
      if (depth <= 0) break;
    }
    throw new DicomParseError('truncated', 'unterminated sequence');
  }

  walk(): void {
    let off = this.firstTagOffset();
    const end = this.bytes.length;
    for (;;) {
      if (off + 8 > end) break;
      // meta group (0002) is always LE explicit; dataset follows transfer syntax.
      // meta ends at the first non-0002 group, or at metaFinishedOffset once known.
      const peek = this.view.getUint16(off, true);
      const inMeta = peek === 0x0002 &&
        (this.metaFinishedOffset === -1 || off < this.metaFinishedOffset);
      if (!inMeta) this.metaFinished = true;
      const le = this.metaFinished ? this.little : true;
      const group = this.view.getUint16(off, le);
      const element = this.view.getUint16(off + 2, le);
      let vr: string;
      let len: number;
      let voff: number;
      const useExplicit = this.explicit || !this.metaFinished;
      if (useExplicit) {
        const v = this.str(off + 4, 2);
        if (!isKnownVR(v) && this.metaFinished) {
          // implicit fallback (Daikon parser.js:224)
          vr = vrFor(group, element);
          len = this.u32(off + 4);
          voff = off + 8;
          this.explicit = false;
        } else {
          vr = v;
          off += 6; // group+element+vr
          if (isLength32VR(vr)) {
            off += 2; // reserved
            len = this.u32(off);
            off += 4;
          } else {
            len = this.view.getUint16(off, le);
            off += 2;
          }
          voff = off;
        }
      } else {
        vr = vrFor(group, element);
        len = this.u32(off + 4);
        voff = off + 8;
        if (len === UNDEFINED_LENGTH) vr = 'SQ';
      }
      const id = tagId(group, element);
      if (vr === 'SQ') {
        const oend = this.skipSequence(voff, len);
        this.tags.set(id, { group, element, vr, valueOffset: voff, valueLength: oend - voff });
        off = oend;
        if (len === UNDEFINED_LENGTH) {
          // recompute like Daikon: length stays span-based; nothing more needed
        }
      } else {
        if (len === UNDEFINED_LENGTH && id === '7FE00010') {
          if (!isCompressedSyntax(this.transferSyntax)) {
            throw new DicomParseError('encapsulated-requires-decoder', 'undefined-length pixel data');
          }
          try {
            this.encap = readEncapsulated(this.bytes, this.view, voff);
          } catch (e) {
            throw new DicomParseError(
              'encapsulated-framing-error', e instanceof Error ? e.message : String(e),
            );
          }
          this.tags.set(id, { group, element, vr, valueOffset: voff, valueLength: this.encap.endOffset - voff });
          off = this.encap.endOffset;
        } else if (len === UNDEFINED_LENGTH && vr === 'UN') {
          // implicit files rewritten explicit keep UN VR on sequences
          // (dicomParser readDicomElementExplicit): walk the items.
          const oend = this.skipImplicitSequence(voff);
          this.tags.set(id, { group, element, vr, valueOffset: voff, valueLength: oend - voff });
          off = oend;
        } else {
          if (len === UNDEFINED_LENGTH) {
            // was: silent file-tail drop (off jumped past end). Loud now.
            throw new DicomParseError('truncated', `tag ${id} (${vr}) undefined length`);
          }
          if (voff + len > end) {
            throw new DicomParseError('truncated', `tag ${id} overruns buffer`);
          }
          this.tags.set(id, { group, element, vr, valueOffset: voff, valueLength: len });
          if (id === '7FE00010') break; // stop at pixel data (Daikon)
          off = voff + len;
        }
      }
      // side effects
      if (id === '00020010') {
        this.transferSyntax = this.getStrings(this.tags.get(id)!)[0] ?? '';
        if (this.transferSyntax === TS_IMPLICIT_LE) { this.explicit = false; this.little = true; }
        else if (this.transferSyntax === TS_EXPLICIT_BE) { this.explicit = true; this.little = false; }
        else { this.explicit = true; this.little = true; }
        if (
          this.transferSyntax !== TS_IMPLICIT_LE &&
          this.transferSyntax !== TS_EXPLICIT_LE &&
          this.transferSyntax !== TS_EXPLICIT_BE &&
          this.transferSyntax !== TS_DEFLATED &&
          !isCompressedSyntax(this.transferSyntax)
        ) {
          // DEFLATED accepted: parseDicomSlice inflates pre-walk, so bytes
          // here are explicit LE. (Direct Walker use on deflated bytes still
          // misparses — inflateDeflatedDataset first.)
          throw new DicomParseError('unsupported-transfer-syntax', this.transferSyntax);
        }
      } else if (id === '00020000') {
        const nums = this.getNumbers(this.tags.get(id)!);
        this.metaFinishedOffset = voff + (nums[0] ?? 0);
      }
    }
  }

  getStrings(t: RawTag | undefined): string[] {
    if (!t || t.valueLength === 0) return [];
    const raw = this.str(t.valueOffset, t.valueLength);
    return raw.split('\\').map((s) => s.trim()).filter((s) => s.length > 0);
  }

  getNumbers(t: RawTag | undefined): number[] {
    if (!t || t.valueLength === 0) return [];
    const le = this.little;
    const o = t.valueOffset;
    const v = this.view;
    switch (t.vr) {
      case 'US': case 'AT': {
        const n = t.valueLength / 2;
        const out: number[] = [];
        for (let i = 0; i < n; i++) out.push(v.getUint16(o + i * 2, le));
        return out;
      }
      case 'SS': {
        const n = t.valueLength / 2;
        const out: number[] = [];
        for (let i = 0; i < n; i++) out.push(v.getInt16(o + i * 2, le));
        return out;
      }
      case 'UL': {
        const n = t.valueLength / 4;
        const out: number[] = [];
        for (let i = 0; i < n; i++) out.push(v.getUint32(o + i * 4, le));
        return out;
      }
      case 'SL': {
        const n = t.valueLength / 4;
        const out: number[] = [];
        for (let i = 0; i < n; i++) out.push(v.getInt32(o + i * 4, le));
        return out;
      }
      case 'FL': {
        const n = t.valueLength / 4;
        const out: number[] = [];
        for (let i = 0; i < n; i++) out.push(v.getFloat32(o + i * 4, le));
        return out;
      }
      case 'FD': {
        const n = t.valueLength / 8;
        const out: number[] = [];
        for (let i = 0; i < n; i++) out.push(v.getFloat64(o + i * 8, le));
        return out;
      }
      default:
        return this.getStrings(t).map((s) => parseFloat(s)).filter((n) => Number.isFinite(n));
    }
  }
}

// Minimal VR fallback for implicit syntax (Daikon dictionary.js subset:
// tags this decoder actually reads).
function vrFor(group: number, element: number): string {
  const id = tagId(group, element);
  if (id === '7FE00010') return 'OW';
  if (group === 0x0028) {
    if (['0010', '0011', '0100', '0101', '0102', '0103', '0002', '0006'].includes(id.slice(4))) return 'US';
    if (id === '00280008') return 'IS';
    return 'DS';
  }
  if (group === 0x0020) {
    if (id === '0020000E') return 'UI';
    if (id === '00200013') return 'IS';
    return 'DS';
  }
  if (group === 0x0002) return id === '00020000' ? 'UL' : 'UI';
  return 'OB';
}

export interface DicomFileMeta {
  transferSyntaxUID: string;
  rows: number;
  cols: number;
  bitsAllocated: number;
  bitsStored: number;
  pixelRepresentation: 0 | 1;
  samplesPerPixel: number;
  numberOfFrames: number;
  photometric: string | null;
  slope: number;
  intercept: number;
  windowCenter: number | null;
  windowWidth: number | null;
  instanceNumber: number | null;
  sliceLocation: number | null;
  seriesUID: string | null;
  sopClassUID: string | null;
  ipp: [number, number, number] | null;
  iop: [number, number, number, number, number, number] | null;
  pixelSpacing: [number, number] | null;
  sliceThickness: number | null;
  /** BTO stack geometry (C.8.21.3): imager spacing + slice interval. */
  imagerPixelSpacing: [number, number] | null;
  spacingBetweenSlices: number | null;
  /** Mammo acquisition context: laterality + view, null when absent. */
  laterality: string | null;
  imageLaterality: string | null;
  viewPosition: string | null;
  patientName: string | null;
  patientID: string | null;
  studyUID: string | null;
  seriesNumber: number | null;
  modality: string | null;
  studyDate: string | null;
  seriesDescription: string | null;
  /** Cine timing (C.8.6): effective frame interval + playback rate. */
  frameTimeMs: number | null;
  cineFps: number | null;
}

export interface ParsedDicomSlice {
  slice: DicomSlice;
  meta: DicomFileMeta;
}

/**
 * Parse every frame of a (possibly multi-frame) file. Classic single-frame
 * files return one entry. Frame order is file order. Enhanced MR/CT
 * per-frame geometry resolves per frame (per-frame item, else shared item,
 * else file-level tags) onto slice.ipp/iop/sliceLocation; shared Pixel
 * Measures stay file-level on meta. Per-frame item count must equal
 * NumberOfFrames when the sequence is present.
 * Shares one meta object across frames (geometry is file-level).
 */
export function parseDicomFrames(buffer: ArrayBuffer): ParsedDicomSlice[] {
  try {
    buffer = inflateDeflatedDataset(buffer);
  } catch (e) {
    throw new DicomParseError('deflate-error', e instanceof Error ? e.message : String(e));
  }
  const w = new Walker(buffer);
  w.walk();
  const num = (id: string, i = 0): number | null => {
    const t = w.tags.get(id);
    if (!t) return null;
    const a = w.getNumbers(t);
    return a[i] ?? null;
  };
  const nums = (id: string): number[] | null => {
    const t = w.tags.get(id);
    if (!t) return null;
    return w.getNumbers(t);
  };
  const str = (id: string): string | null => {
    const t = w.tags.get(id);
    if (!t) return null;
    return w.getStrings(t)[0] ?? null;
  };
  const rows = num('00280010');
  const cols = num('00280011');
  const bitsAllocated = num('00280100');
  const bitsStored = num('00280101') ?? bitsAllocated;
  const pixelRep = num('00280103') ?? 0;
  const samples = num('00280002') ?? 1;
  const frames = num('00280008') ?? 1;
  if (rows == null || cols == null || bitsAllocated == null) {
    throw new DicomParseError('unsupported-pixel-layout', 'missing rows/cols/bits');
  }
  const photometric = str('00280004');
  const compressed = w.encap !== null;
  if (isCompressedSyntax(w.transferSyntax) && !compressed) {
    throw new DicomParseError('encapsulated-framing-error', 'compressed syntax with native pixel data');
  }
  // Native US color: 3-sample frames (YBR_FULL/RGB triples, YBR_FULL_422
  // pairs) fold to luma in the frame reader; anything else stays loud.
  // Range check before the fold: vendors write 12-bit US in 16-bit
  // containers, so color tolerates any container the gray path takes.
  const planar = num('00280006') ?? 0;
  const nativeColor = !compressed && samples === 3 &&
    (photometric === 'YBR_FULL' || photometric === 'YBR_FULL_422' || photometric === 'RGB');
  if (!compressed && bitsAllocated !== 8 && bitsAllocated !== 16) {
    throw new DicomParseError('unsupported-pixel-layout', `bitsAllocated=${bitsAllocated}`);
  }
  if (!compressed && samples !== 1 && !nativeColor) {
    throw new DicomParseError('unsupported-pixel-layout', `samplesPerPixel=${samples}`);
  }
  if (nativeColor && planar !== 0) {
    throw new DicomParseError('unsupported-pixel-layout', `planarConfiguration=${planar}`);
  }
  const px = w.tags.get('7FE00010');
  if (!px) throw new DicomParseError('truncated', 'no pixel data');
  const n = rows * cols;
  const frameBytesOf = (fi: number): { bytes: Uint8Array; bits: number; stored: number } => {
    if (compressed) {
      const dec = decodeCompressed(
        w.encap!, w.transferSyntax, rows, cols, bitsAllocated, samples, photometric,
        frames, fi,
      );
      return { bytes: dec.bytes, bits: dec.bits, stored: dec.bits };
    }
    if (nativeColor) {
      // one color frame packs n*samples bytes (422: n*2); the fold returns
      // 8-bit luma per pixel, so bits/stored stay 8/8 exactly.
      const perFrame = photometric === 'YBR_FULL_422' ? n * 2 : n * 3;
      const all = new Uint8Array(buffer, px.valueOffset, px.valueLength);
      if (all.length < perFrame * frames) {
        throw new DicomParseError('truncated', 'pixel data short');
      }
      const raw = all.subarray(fi * perFrame, (fi + 1) * perFrame);
      let luma: Uint8Array;
      try {
        luma = foldYbrFrame(raw, rows, cols, photometric!);
      } catch (e) {
        throw new DicomParseError('unsupported-pixel-layout', (e as Error).message);
      }
      return { bytes: luma, bits: 8, stored: 8 };
    }
    const bpp = bitsAllocated / 8;
    const all = new Uint8Array(buffer, px.valueOffset, px.valueLength);
    if (all.length < n * bpp * frames) {
      throw new DicomParseError('truncated', 'pixel data short');
    }
    return {
      bytes: all.subarray(fi * n * bpp, (fi + 1) * n * bpp),
      bits: bitsAllocated,
      stored: bitsStored ?? bitsAllocated,
    };
  };
  const invert = photometric === 'MONOCHROME1';
  const slope = num('00281053') ?? 1;
  const intercept = num('00281052') ?? 0;
  /**
   * Stored values → modality values (rescale applied), in the narrowest
   * array that holds them exactly.
   *
   * This used to write everything into an Int16Array. That is exact for CT
   * (-1024..3071 HU) and silently wrong for the rest: unsigned 16-bit MR
   * above 32767 wrapped negative, and a fractional rescale (MR/PET slopes
   * like 2.708913) was rounded away. Signed pixels stored in fewer bits than
   * allocated were masked instead of sign-extended, so -5 in 12 bits read
   * back as 4091. Int16 stays the representation whenever it is exact — the
   * CT path and every consumer that expects it are unchanged — and anything
   * it cannot hold comes back as Float32.
   */
  const convert = (bytes: Uint8Array, workBits: number, workStored: number): Int16Array | Float32Array => {
    const maxVal = 2 ** workStored - 1;
    const partial = workStored < workBits;
    const mask = partial ? (2 ** workStored) - 1 : 0xffffffff;
    const signShift = 32 - workStored;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Float32Array(n);
    let fitsInt16 = true;
    for (let i = 0; i < n; i++) {
      let raw = workBits === 16
        ? pixelRep === 1 ? dv.getInt16(i * 2, w.little) : dv.getUint16(i * 2, w.little)
        : pixelRep === 1 ? dv.getInt8(i) : dv.getUint8(i);
      if (partial) {
        raw &= mask;
        // two's complement in `workStored` bits: shift the sign bit to bit 31
        if (pixelRep === 1) raw = (raw << signShift) >> signShift;
      }
      if (invert) raw = maxVal - raw;
      const v = raw * slope + intercept;
      out[i] = v;
      if (fitsInt16 && (v !== Math.trunc(v) || v < -32768 || v > 32767)) fitsInt16 = false;
    }
    return fitsInt16 ? Int16Array.from(out) : out;
  };
  // validate + learn the shared layout from frame 0 (bits are file-level:
  // every frame of one syntax decodes to the same container; the native
  // US fold always emits 8-bit luma, so the meta describes the pixels)
  const first = frameBytesOf(0);
  const workBits = first.bits;
  const workStored = first.stored;
  const ippA = nums('00200032');
  const iopA = nums('00200037');
  const psA = nums('00280030');
  const imA = nums('00181164');
  // Cine timing (C.8.6): RecommendedDisplayFrameRate, else CineRate, else
  // FrameTime/FrameTimeVector-derived. Null when the file carries none.
  const ftv = nums('00181065');
  const frameTime = num('00181063');
  const cineRate = num('00180040');
  const recRate = num('00082144');
  const cine = cineFields(frameTime, ftv, cineRate, recRate);
  const meta: DicomFileMeta = {
    transferSyntaxUID: w.transferSyntax,
    rows, cols, bitsAllocated: workBits, bitsStored: workStored,
    pixelRepresentation: pixelRep === 1 ? 1 : 0,
    samplesPerPixel: samples, numberOfFrames: frames,
    photometric, slope, intercept,
    windowCenter: num('00281050'),
    windowWidth: num('00281051'),
    instanceNumber: num('00200013'),
    sliceLocation: num('00201041'),
    seriesUID: str('0020000E'),
    sopClassUID: str('00080016'),
    ipp: ippA && ippA.length >= 3 ? [ippA[0]!, ippA[1]!, ippA[2]!] : null,
    iop: iopA && iopA.length >= 6 ? [iopA[0]!, iopA[1]!, iopA[2]!, iopA[3]!, iopA[4]!, iopA[5]!] : null,
    pixelSpacing: psA && psA.length >= 2 ? [psA[0]!, psA[1]!] : null,
    sliceThickness: num('00180050'),
    imagerPixelSpacing: imA && imA.length >= 2 ? [imA[0]!, imA[1]!] : null,
    spacingBetweenSlices: num('00180088'),
    laterality: str('00200060'),
    imageLaterality: str('00200062'),
    viewPosition: str('00185101'),
    patientName: str('00100010'),
    patientID: str('00100020'),
    studyUID: str('0020000D'),
    seriesNumber: num('00200011'),
    modality: str('00080060'),
    studyDate: str('00080020'),
    seriesDescription: str('0008103E'),
    frameTimeMs: cine.frameTimeMs,
    cineFps: cine.cineFps,
  };
  const out: ParsedDicomSlice[] = [];
  const fg = readFunctionalGroups(buffer);
  if (fg.perFrame.length > 0 && fg.perFrame.length !== frames) {
    throw new DicomParseError(
      'truncated',
      `per-frame groups ${fg.perFrame.length} != NumberOfFrames ${frames}`,
    );
  }
  const sharedGeo = groupGeometry(fg.shared);
  for (let fi = 0; fi < frames; fi++) {
    const fb = frameBytesOf(fi);
    const itemGeo = groupGeometry(fg.perFrame[fi] ?? null);
    const ipp = itemGeo.ipp ?? sharedGeo.ipp;
    const iop = itemGeo.iop ?? sharedGeo.iop;
    const div = itemGeo.dimensionIndexValues.length > 0
      ? itemGeo.dimensionIndexValues
      : sharedGeo.dimensionIndexValues;
    // Pixel Measures stay file-level on meta for the stacked Volume (which
    // cannot express per-slice spacing); per-frame values ride the slice.
    const ps = itemGeo.pixelSpacing ?? sharedGeo.pixelSpacing;
    const st = itemGeo.sliceThickness ?? sharedGeo.sliceThickness;
    out.push({
      slice: {
        instanceNumber: meta.instanceNumber ?? 0,
        // Enhanced frames position by per-frame IPP; classic files keep the
        // file-level SliceLocation exactly as before.
        sliceLocation: ipp ? ipp[2] : meta.sliceLocation ?? undefined,
        rows, cols, pixelData: convert(fb.bytes, fb.bits, fb.stored),
        ...(frames > 1 ? { frameIndex: fi } : {}),
        ...(ipp ? { ipp } : {}),
        ...(iop ? { iop } : {}),
        ...(div.length > 0 ? { dimensionIndexValues: div } : {}),
        ...(ps ? { pixelSpacing: ps } : {}),
        ...(st != null ? { sliceThickness: st } : {}),
      },
      meta,
    });
  }
  return out;
}

/**
 * Single-slice contract: classic one-frame files parse, multi-frame files
 * throw (use parseDicomFrames). Unchanged behavior for every existing caller.
 */
export function parseDicomSlice(buffer: ArrayBuffer): ParsedDicomSlice {
  const all = parseDicomFrames(buffer);
  if (all.length !== 1) {
    throw new DicomParseError('multi-frame-unsupported', `frames=${all.length}`);
  }
  return all[0]!;
}
