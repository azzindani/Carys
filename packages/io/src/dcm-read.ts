// Generic Part-10 dataset reader: Explicit VR Little Endian elements with
// typed accessors + sequence items (defined AND undefined length).
// Built for SEG / RTSTRUCT / SR; not a full implicit-VR parser (see
// dicom-parse.ts for pixel pipelines).

import { isLength32VR } from './dicom-vr.js';
import { inflateDeflatedDataset } from './dicom-deflate.js';
import { DicomParseError } from './dicom-parse.js';

const UNDEF = 0xffffffff;

export interface DataElement {
  tag: string;
  vr: string;
  /** raw value bytes (for SQ: the full item blob, use items()) */
  bytes: Uint8Array;
}

export class Dataset {
  elements = new Map<string, DataElement>();
  items: Dataset[][] = []; // parallel: items[i] = parsed items of i-th SQ, aligned with sqTags
  sqTags: string[] = [];

  constructor(public buffer: ArrayBuffer) {}

  get(tag: string): DataElement | undefined {
    return this.elements.get(tag.toUpperCase());
  }

  text(tag: string): string | null {
    const el = this.get(tag);
    if (!el) return null;
    let s = '';
    for (const c of el.bytes) {
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.trim().replace(/\s+$/, '');
  }

  texts(tag: string): string[] {
    const t = this.text(tag);
    return t == null || t === '' ? [] : t.split('\\');
  }

  numbers(tag: string): number[] {
    const el = this.get(tag);
    if (!el) return [];
    if (el.vr === 'US') return readU16(el.bytes);
    if (el.vr === 'SS') return readI16(el.bytes);
    if (el.vr === 'UL') return readU32(el.bytes);
    if (el.vr === 'SL') return readI32(el.bytes);
    if (el.vr === 'FL') return readF32(el.bytes);
    if (el.vr === 'FD') return readF64(el.bytes);
    const t = this.text(tag);
    if (t == null || t === '') return [];
    return t.split('\\').map(Number).filter((v) => Number.isFinite(v));
  }

  number(tag: string): number | null {
    const n = this.numbers(tag);
    return n.length > 0 ? n[0]! : null;
  }

  bytes(tag: string): Uint8Array | null {
    const el = this.get(tag);
    return el ? el.bytes : null;
  }

  /** Parsed items of the n-th SQ element in document order. */
  sequence(tag: string): Dataset[] {
    const i = this.sqTags.findIndex((t) => t === tag.toUpperCase());
    return i >= 0 ? this.items[i]! : [];
  }
}

function dvOf(b: Uint8Array): DataView {
  return new DataView(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);
}

function readU16(b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < b.length; i += 2) out.push(b[i]! | (b[i + 1]! << 8));
  return out;
}
function readI16(b: Uint8Array): number[] {
  return readU16(b).map((v) => (v >= 0x8000 ? v - 0x10000 : v));
}
function readU32(b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < b.length; i += 4) {
    out.push((b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0);
  }
  return out;
}
function readI32(b: Uint8Array): number[] {
  return readU32(b).map((v) => (v >= 0x80000000 ? v - 0x100000000 : v));
}
function viewOf(b: Uint8Array): DataView {
  const c = Uint8Array.from(b);
  return new DataView(c.buffer);
}
function readF32(b: Uint8Array): number[] {
  const dv = viewOf(b);
  const out: number[] = [];
  for (let i = 0; i + 3 < b.length; i += 4) out.push(dv.getFloat32(i, true));
  return out;
}
function readF64(b: Uint8Array): number[] {
  const dv = viewOf(b);
  const out: number[] = [];
  for (let i = 0; i + 7 < b.length; i += 8) out.push(dv.getFloat64(i, true));
  return out;
}

const hex4 = (n: number): string => n.toString(16).padStart(4, '0').toUpperCase();

interface RawItem {
  start: number;
  end: number;
}

/** Split an SQ value blob into item byte ranges (defined + undefined). */
function splitItems(bytes: Uint8Array): RawItem[] {
  const dv = dvOf(bytes);
  const items: RawItem[] = [];
  let p = 0;
  for (;;) {
    if (p + 8 > bytes.length) break;
    const g = dv.getUint16(p, true);
    const e = dv.getUint16(p + 2, true);
      if (g === 0xfffe && e === 0xe0dd) break; // sequence delimitation
    if (g !== 0xfffe || e !== 0xe000) throw new Error(`expected item tag at ${p}, got ${hex4(g)}${hex4(e)}`);
    const len = dv.getUint32(p + 4, true);
    if (len !== UNDEF) {
      items.push({ start: p + 8, end: p + 8 + len });
      p += 8 + len;
    } else {
      // undefined-length item: ends at item delimitation (no nesting of
      // undefined items inside DEFINED items in our scope — nested
      // undefined SQs are consumed by depth scan)
      const end = findItemEnd(bytes, p + 8);
      items.push({ start: p + 8, end });
      p = end + 8;
    }
  }
  return items;
}

function elemHeader(bytes: Uint8Array, dv: DataView, p: number): { hlen: number; len: number } {
  const vr = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!);
  if (isLength32VR(vr)) return { hlen: 12, len: dv.getUint32(p + 8, true) };
  return { hlen: 8, len: dv.getUint16(p + 6, true) };
}

/**
 * Offset of the E00D closing the undefined-length item starting at `from`.
 * depth counts nested undefined SQs (their E00Ds belong to inner items).
 */
function findItemEnd(bytes: Uint8Array, from: number): number {
  const dv = dvOf(bytes);
  let p = from;
  let depth = 0;
  while (p + 8 <= bytes.length) {
    const g = dv.getUint16(p, true);
    const e = dv.getUint16(p + 2, true);
    if (g === 0xfffe && e === 0xe00d) {
      if (depth === 0) return p;
      p += 8;
      continue;
    }
    if (g === 0xfffe && e === 0xe0dd) {
      if (depth === 0) throw new Error('sequence delimited before item end');
      depth--;
      p += 8;
      continue;
    }
    if (g === 0xfffe && e === 0xe000) {
      const l = dv.getUint32(p + 4, true);
      p = l === UNDEF ? findItemEnd(bytes, p + 8) + 8 : p + 8 + l;
      continue;
    }
    const { hlen, len } = elemHeader(bytes, dv, p);
    if (len === UNDEF) {
      depth++;
      p += hlen;
    } else {
      p += hlen + len;
    }
  }
  throw new Error('unterminated item');
}

/**
 * Offset of the E0DD closing the undefined-length SQ starting at `from`.
 * depth counts nested undefined SQs.
 */
function skipUndefinedSQ(bytes: Uint8Array, from: number): number {
  const dv = dvOf(bytes);
  let p = from;
  let depth = 0;
  while (p + 8 <= bytes.length) {
    const g = dv.getUint16(p, true);
    const e = dv.getUint16(p + 2, true);
    if (g === 0xfffe && e === 0xe0dd) {
      if (depth === 0) return p;
      depth--;
      p += 8;
      continue;
    }
    if (g === 0xfffe && e === 0xe000) {
      const l = dv.getUint32(p + 4, true);
      p = l === UNDEF ? findItemEnd(bytes, p + 8) + 8 : p + 8 + l;
      continue;
    }
    if (g === 0xfffe && e === 0xe00d) throw new Error('stray item delimitation in sequence');
    const { hlen, len } = elemHeader(bytes, dv, p);
    if (len === UNDEF) {
      depth++;
      p += hlen;
    } else {
      p += hlen + len;
    }
  }
  throw new Error('unterminated sequence');
}

function firstTagOffset(bytes: Uint8Array): number {
  if (bytes.length > 132 && bytes[128] === 68 && bytes[129] === 73 && bytes[130] === 67 && bytes[131] === 77) {
    return 132;
  }
  return 0;
}

/** Parse top-level elements; SQ bodies are kept raw until sequence() is called. */
export function readDataset(buffer: ArrayBuffer): Dataset {
  buffer = inflateDeflatedDataset(buffer);
  const bytes = new Uint8Array(buffer);
  // Shorter than one tag header: not a dataset (previously returned an
  // empty Dataset, letting zero-byte files masquerade as valid input).
  if (bytes.length < 8) throw new DicomParseError('truncated', `only ${bytes.length} bytes`);
  const dv = dvOf(new Uint8Array(buffer));
  const ds = new Dataset(buffer);
  let off = firstTagOffset(bytes);
  const end = bytes.length;
  while (off + 8 <= end) {
    const group = dv.getUint16(off, true);
    if (group === 0x0002) {
      // skip meta group: length-prefixed walk
      const vr = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!);
      let hlen: number;
      let len: number;
      if (isLength32VR(vr)) {
        hlen = 12;
        len = dv.getUint32(off + 8, true);
      } else {
        hlen = 8;
        len = dv.getUint16(off + 6, true);
      }
      off += hlen + (len === UNDEF ? 0 : len);
      continue;
    }
    if (group === 0xfffe) break; // stray delimitation
    const element = dv.getUint16(off + 2, true);
    const vr = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!);
    let hlen: number;
    let len: number;
    if (isLength32VR(vr)) {
      hlen = 12;
      len = dv.getUint32(off + 8, true);
    } else {
      hlen = 8;
      len = dv.getUint16(off + 6, true);
    }
    const tag = hex4(group) + hex4(element);
    if (vr === 'SQ') {
      let raw: Uint8Array;
      if (len === UNDEF) {
        const endOff = skipUndefinedSQ(bytes, off + hlen);
        raw = bytes.subarray(off + hlen, endOff);
        const items = splitItems(raw).map((r) => parseItem(raw, r));
        ds.sqTags.push(tag);
        ds.items.push(items);
        ds.elements.set(tag, { tag, vr, bytes: raw });
        off = endOff + 8;
      } else {
        raw = bytes.subarray(off + hlen, off + hlen + len);
        const items = splitItems(raw).map((r) => parseItem(raw, r));
        ds.sqTags.push(tag);
        ds.items.push(items);
        ds.elements.set(tag, { tag, vr, bytes: raw });
        off += hlen + len;
      }
    } else {
      if (len === UNDEF) throw new Error(`undefined length on non-SQ ${tag}`);
      ds.elements.set(tag, { tag, vr, bytes: bytes.subarray(off + hlen, off + hlen + len) });
      off += hlen + len;
    }
  }
  return ds;
}

/** Parse one item's elements into a Dataset (views share the file buffer). */
function parseItem(raw: Uint8Array, r: RawItem): Dataset {
  const ibytes = raw.subarray(r.start, r.end);
  const dv = dvOf(ibytes);
  const ds = new Dataset(Uint8Array.from(ibytes).buffer);
  let off = 0;
  while (off + 8 <= ibytes.length) {
    const group = dv.getUint16(off, true);
    const element = dv.getUint16(off + 2, true);
    const vr = String.fromCharCode(ibytes[off + 4]!, ibytes[off + 5]!);
    let hlen: number;
    let len: number;
    if (isLength32VR(vr)) {
      hlen = 12;
      len = dv.getUint32(off + 8, true);
    } else {
      hlen = 8;
      len = dv.getUint16(off + 6, true);
    }
    const tag = hex4(group) + hex4(element);
    if (vr === 'SQ') {
      let items: Dataset[];
      let rawSq: Uint8Array;
      let next: number;
      if (len === UNDEF) {
        const endOff = skipUndefinedSQ(ibytes, off + hlen);
        rawSq = ibytes.subarray(off + hlen, endOff);
        items = splitItems(rawSq).map((rr) => parseItem(rawSq, rr));
        next = endOff + 8;
      } else {
        rawSq = ibytes.subarray(off + hlen, off + hlen + len);
        items = splitItems(rawSq).map((rr) => parseItem(rawSq, rr));
        next = off + hlen + len;
      }
      ds.sqTags.push(tag);
      ds.items.push(items);
      ds.elements.set(tag, { tag, vr, bytes: rawSq });
      off = next;
    } else {
      if (len === UNDEF) throw new Error(`undefined length on non-SQ ${tag}`);
      ds.elements.set(tag, { tag, vr, bytes: ibytes.subarray(off + hlen, off + hlen + len) });
      off += hlen + len;
    }
  }
  return ds;
}
