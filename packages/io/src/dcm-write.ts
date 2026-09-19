// Minimal DICOM Part-10 writer: Explicit VR Little Endian, defined lengths.
// Covers the attribute set SEG / RTSTRUCT / SR writers need. Text VRs are
// space-padded, UI null-padded, binary zero-padded (all to even length).

import { isLength32VR } from './dicom-vr.js';

export const IMPLICIT_LE = '1.2.840.10008.1.2';
export const EXPLICIT_LE = '1.2.840.10008.1.2.1';

export type DcmTag = [group: number, element: number];

export interface DcmElement {
  tag: DcmTag;
  vr: string;
  /** strings, numbers (encoded per VR), raw bytes, or sequence items */
  value: string | number | (string | number)[] | Uint8Array | SeqValue;
}

export interface DcmItem {
  elements: DcmElement[];
}

export type SeqValue = DcmItem[];

function padEven(n: number): number {
  return n + (n % 2);
}

/** Spread has an argument-count ceiling (~65k): chunk large appends. */
function pushAll(out: number[], arr: ArrayLike<number>): void {
  const CHUNK = 32768;
  for (let i = 0; i < arr.length; i += CHUNK) {
    const end = Math.min(arr.length, i + CHUNK);
    for (let j = i; j < end; j++) out.push(arr[j]!);
  }
}

function encodeText(vr: string, s: string): Uint8Array {
  const bytes = new Uint8Array(padEven(s.length + (vr === 'UI' ? 1 : 0)));
  bytes.fill(vr === 'UI' ? 0 : 0x20);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  if (vr === 'UI') bytes[s.length] = 0;
  return bytes;
}

function encodeNumber(vr: string, v: number, out: number[], dv: DataView, pos: number): number {
  switch (vr) {
    case 'US': case 'SS':
      dv.setUint16(pos, v, true);
      return 2;
    case 'UL': case 'SL':
      dv.setUint32(pos, v, true);
      return 4;
    case 'FL':
      dv.setFloat32(pos, v, true);
      return 4;
    case 'FD':
      dv.setFloat64(pos, v, true);
      return 8;
    default: { // IS, DS and friends: decimal string
      const s = String(v);
      const b = encodeText('LO', s);
      out.push(...b);
      return b.length;
    }
  }
}

function encodeElement(el: DcmElement, out: number[]): void {
  const [g, e] = el.tag;
  out.push(g & 0xff, (g >> 8) & 0xff, e & 0xff, (e >> 8) & 0xff);
  const vr = el.vr;
  out.push(vr.charCodeAt(0), vr.charCodeAt(1));
  if (vr === 'SQ') {
    const items = el.value as unknown as SeqValue;
    const body: number[] = [];
    for (const item of items) {
      body.push(0xfe, 0xff, 0x00, 0xe0);
      const ib: number[] = [];
      for (const sub of item.elements) encodeElement(sub, ib);
      const len = ib.length;
      body.push(len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff);
      pushAll(body, ib);
    }
    const len = body.length;
    if (isLength32VR('SQ')) out.push(0, 0);
    out.push(len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff);
    pushAll(out, body);
    return;
  }
  let payload: Uint8Array;
  if (el.value instanceof Uint8Array) {
    // OB/OW must be even-length: pad a copy (never mutate the caller's bytes)
    if (el.value.length % 2 === 0) {
      payload = el.value;
    } else {
      const padded = new Uint8Array(el.value.length + 1);
      padded.set(el.value);
      payload = padded;
    }
  } else if (Array.isArray(el.value)) {
    if (el.value.length > 0 && el.value.every((v) => typeof v === 'number') &&
      ['US', 'SS', 'UL', 'SL', 'FL', 'FD'].includes(vr)) {
      const parts: number[] = [];
      const dvv = new DataView(new ArrayBuffer(8));
      for (const v of el.value as number[]) {
        const tmp: number[] = [];
        const n = encodeNumber(vr, v, tmp, dvv, 0);
        for (let i = 0; i < n; i++) parts.push(dvv.getUint8(i));
      }
      payload = new Uint8Array(parts.length % 2 ? [...parts, 0] : parts);
    } else {
      // multi-valued text: join raw with backslash, pad once at the end
      payload = encodeText(vr, (el.value as (string | number)[]).map(String).join('\\'));
    }
  } else if (typeof el.value === 'number') {
    if (['US', 'SS', 'UL', 'SL', 'FL', 'FD'].includes(vr)) {
      const dvv = new DataView(new ArrayBuffer(8));
      const tmp: number[] = [];
      const n = encodeNumber(vr, el.value, tmp, dvv, 0);
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = dvv.getUint8(i);
      payload = bytes;
    } else {
      // IS, DS and friends: decimal string, padded once
      payload = encodeText(vr, String(el.value));
    }
  } else {
    payload = encodeText(vr, el.value);
  }
  if (isLength32VR(vr)) {
    out.push(0, 0);
    const len = payload.length;
    out.push(len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff);
  } else {
    out.push(payload.length & 0xff, (payload.length >> 8) & 0xff);
  }
  pushAll(out, payload);
}

let uidCounter = 0;

/** Deterministic-ish UID under our root (not globally registered — interchange use). */
export function makeUID(): string {
  uidCounter++;
  const t = Date.now().toString().slice(-10);
  return `1.2.826.0.1.999999.2.${t}.${uidCounter}`;
}

/** Assemble a Part-10 file: 128-byte preamble + DICM + meta + dataset. */
export function writePart10(sopClassUID: string, sopInstanceUID: string, dataset: DcmElement[]): ArrayBuffer {
  const meta: DcmElement[] = [
    { tag: [0x0002, 0x0001], vr: 'OB', value: new Uint8Array([0, 1]) },
    { tag: [0x0002, 0x0002], vr: 'UI', value: sopClassUID },
    { tag: [0x0002, 0x0003], vr: 'UI', value: sopInstanceUID },
    { tag: [0x0002, 0x0010], vr: 'UI', value: EXPLICIT_LE },
  ];
  const metaBytes: number[] = [];
  for (const el of meta) encodeElement(el, metaBytes);
  // group length must precede the group: prepend (0002,0000) UL
  const full: number[] = [];
  encodeElement({ tag: [0x0002, 0x0000], vr: 'UL', value: metaBytes.length }, full);
  full.push(...metaBytes);
  for (const el of dataset) encodeElement(el, full);
  const out = new Uint8Array(132 + full.length);
  out.fill(0, 0, 128);
  out[128] = 68; out[129] = 73; out[130] = 67; out[131] = 77; // DICM
  out.set(full, 132);
  return out.buffer as ArrayBuffer;
}
