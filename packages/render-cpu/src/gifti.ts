// GIFTI surface reader (XML subset shaped by NiiVue nvmesh-loaders readGII,
// BSD-2-Clause): DataArray intents NIFTI_INTENT_POINTSET (f32 triples) and
// NIFTI_INTENT_TRIANGLE (i32 triples), anything else concatenated as scalars.
// Own tag scanner + base64 decoder (no DOMParser/atob/Buffer) so this runs in
// node, browsers and workers. CPU-only cuts: GZipBase64Binary payloads and
// whole-file .gii.gz rejected by name (inflate upstream), big-endian binary
// rejected, VECTOR intent skipped.
import type { TriMesh } from './surface.js';

export class GiftiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GiftiError';
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64INV: number[] = (() => {
  const t = new Array<number>(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t['='.charCodeAt(0)] = 0;
  return t;
})();

/** Runtime-agnostic base64 decode (whitespace-tolerant). */
export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '');
  if (clean.length % 4 !== 0) throw new GiftiError(`base64 length ${clean.length} not a multiple of 4`);
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64INV[clean.charCodeAt(i)!]!, b = B64INV[clean.charCodeAt(i + 1)!]!;
    const c = B64INV[clean.charCodeAt(i + 2)!]!, d = B64INV[clean.charCodeAt(i + 3)!]!;
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new GiftiError(`bad base64 char at quantum ${i / 4}`);
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = i + 1 < bytes.length ? bytes[i + 1]! : 0, c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (a << 16) | (b << 8) | c;
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
}

/** Content sniff: XML declaration + GIFTI root (also true for .gii.gz: no). */
export function isGiftiLike(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return false;
  const head = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 2048)));
  return head.includes('<?xml') && head.includes('<GIFTI');
}

export interface GiftiData {
  positions: Float32Array;
  indices: Uint32Array;
  scalars: Float32Array;
  /** non-null when a POINTSET + TRIANGLE pair was present */
  mesh: TriMesh | null;
}

type RawArray = { intent: string; dtype: string; encoding: string; colMajor: boolean; dims: number[]; data: string };

function attrOf(tag: string, name: string): string {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return m ? m[1]! : '';
}

function parseArrays(text: string): RawArray[] {
  const out: RawArray[] = [];
  const re = /<DataArray\b([^>]*)>([\s\S]*?)<\/DataArray>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const open = m[1]!, body = m[2]!;
    const dm = /<Data>([\s\S]*?)<\/Data>/.exec(body);
    if (!dm) throw new GiftiError('DataArray without a <Data> payload');
    const dims: number[] = [];
    for (const k of ['Dim0', 'Dim1', 'Dim2']) {
      const v = attrOf(open, k);
      if (v !== '') dims.push(parseInt(v, 10));
    }
    out.push({
      intent: attrOf(open, 'Intent'), dtype: attrOf(open, 'DataType'),
      encoding: attrOf(open, 'Encoding'),
      colMajor: open.includes('ArrayIndexingOrder="ColumnMajorOrder"'),
      dims, data: dm[1]!,
    });
  }
  if (out.length === 0) throw new GiftiError('no <DataArray> elements');
  return out;
}

function decodePayload(a: RawArray): { kind: 'f32' | 'i32'; values: Float32Array | Int32Array } {
  const n = a.dims.reduce((x, y) => x * y, 1);
  if (!Number.isInteger(n) || n < 1) throw new GiftiError(`bad dims [${a.dims}]`);
  const wantFloat = a.dtype === 'NIFTI_TYPE_FLOAT32' || a.dtype === 'NIFTI_TYPE_FLOAT64';
  const wantInt = a.dtype === 'NIFTI_TYPE_INT32' || a.dtype === 'NIFTI_TYPE_UINT8' || a.dtype === 'NIFTI_TYPE_INT16';
  if (!wantFloat && !wantInt) throw new GiftiError(`unsupported DataType ${a.dtype || '(missing)'}`);
  if (a.encoding === 'ASCII') {
    const toks = a.data.trim().split(/\s+/);
    if (toks.length !== n) throw new GiftiError(`ASCII count ${toks.length} != dims product ${n}`);
    if (wantFloat) {
      const v = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = parseFloat(toks[i]!); if (!Number.isFinite(x)) throw new GiftiError(`non-numeric ASCII value ${i}`); v[i] = x; }
      return { kind: 'f32', values: v };
    }
    const v = new Int32Array(n);
    for (let i = 0; i < n; i++) { const x = Number(toks[i]); if (!Number.isInteger(x)) throw new GiftiError(`non-integer ASCII value ${i}`); v[i] = x; }
    return { kind: 'i32', values: v };
  }
  if (a.encoding === 'GZipBase64Binary') throw new GiftiError('GZipBase64Binary: gunzip the payload (fflate) or re-export ASCII first');
  if (a.encoding !== 'Base64Binary') throw new GiftiError(`unsupported Encoding ${a.encoding || '(missing)'}`);
  const raw = base64ToBytes(a.data);
  const bpe = a.dtype === 'NIFTI_TYPE_FLOAT64' ? 8 : a.dtype === 'NIFTI_TYPE_INT16' ? 2 : a.dtype === 'NIFTI_TYPE_UINT8' ? 1 : 4;
  if (raw.length !== n * bpe) throw new GiftiError(`binary size ${raw.length} != ${n} x ${bpe}`);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.length);
  if (wantFloat) {
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = bpe === 8 ? dv.getFloat64(i * 8, true) : dv.getFloat32(i * 4, true);
    return { kind: 'f32', values: v };
  }
  const v = new Int32Array(n);
  for (let i = 0; i < n; i++) v[i] = bpe === 2 ? dv.getInt16(i * 2, true) : bpe === 1 ? dv.getUint8(i) : dv.getInt32(i * 4, true);
  return { kind: 'i32', values: v };
}

/** NiiVue col-major rule: flat triples stored column-first (x…x y…y z…z). */
function rowMajor(values: Float32Array | Int32Array, a: RawArray): Float32Array | Int32Array {
  if (!a.colMajor || values.length % 3 !== 0) return values;
  const np = values.length / 3;
  const out = values instanceof Float32Array ? new Float32Array(values.length) : new Int32Array(values.length);
  let j = 0;
  for (let p = 0; p < np; p++) for (let k = 0; k < 3; k++) out[j++] = values[k * np + p]!;
  return out;
}

/**
 * GIFTI surface reader -> positions/indices/scalars + TriMesh when a
 * POINTSET + TRIANGLE pair is present (scalar-only overlays give mesh null).
 * Throws GiftiError on bad XML, missing payloads, gzip, or shape mismatches.
 */
export function parseGifti(buf: ArrayBuffer): GiftiData {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    throw new GiftiError('whole-file gzip (.gii.gz): gunzip before parsing');
  }
  const text = new TextDecoder().decode(bytes);
  if (!text.includes('<?xml') || !text.includes('<GIFTI')) throw new GiftiError('not a GIFTI file (no xml/GIFTI tags)');
  let positions: Float32Array = new Float32Array(0);
  let indices: Uint32Array = new Uint32Array(0);
  const scalarParts: Float32Array[] = [];
  let scalarLen = 0;
  for (const a of parseArrays(text)) {
    if (a.intent === 'NIFTI_INTENT_VECTOR') continue; // NiiVue skips vectors
    const { kind, values } = decodePayload(a);
    if (a.intent === 'NIFTI_INTENT_POINTSET') {
      const v = rowMajor(values, a);
      if (v.length % 3 !== 0) throw new GiftiError(`pointset length ${v.length} not triples`);
      positions = kind === 'f32' ? (v as Float32Array) : Float32Array.from(v as Int32Array);
    } else if (a.intent === 'NIFTI_INTENT_TRIANGLE') {
      const v = rowMajor(values, a);
      if (v.length % 3 !== 0) throw new GiftiError(`triangle length ${v.length} not triples`);
      const ints = kind === 'i32' ? (v as Int32Array) : Int32Array.from(v as Float32Array);
      for (const x of ints) if (x < 0) throw new GiftiError(`negative triangle index ${x}`);
      indices = Uint32Array.from(ints);
    } else {
      const f = kind === 'f32' ? (values as Float32Array) : Float32Array.from(values as Int32Array);
      scalarParts.push(f);
      scalarLen += f.length;
    }
  }
  const scalars = new Float32Array(scalarLen);
  let o = 0;
  for (const p of scalarParts) { scalars.set(p, o); o += p.length; }
  let mesh: TriMesh | null = null;
  if (positions.length > 0 && indices.length > 0) {
    const nv = positions.length / 3;
    for (const x of indices) if (x >= nv) throw new GiftiError(`triangle index ${x} out of range (${nv} verts)`);
    const normals = new Float32Array(positions.length);
    for (let t = 0; t < indices.length; t += 3) {
      const a3 = indices[t]! * 3, b3 = indices[t + 1]! * 3, c3 = indices[t + 2]! * 3;
      const e1x = positions[b3]! - positions[a3]!, e1y = positions[b3 + 1]! - positions[a3 + 1]!, e1z = positions[b3 + 2]! - positions[a3 + 2]!;
      const e2x = positions[c3]! - positions[a3]!, e2y = positions[c3 + 1]! - positions[a3 + 1]!, e2z = positions[c3 + 2]! - positions[a3 + 2]!;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      for (const v of [a3, b3, c3]) { normals[v]! += nx; normals[v + 1]! += ny; normals[v + 2]! += nz; }
    }
    for (let i = 0; i < normals.length; i += 3) {
      const l = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
      normals[i]! /= l; normals[i + 1]! /= l; normals[i + 2]! /= l;
    }
    mesh = { positions: positions.slice(), normals, indices: indices.slice() };
  }
  return { positions, indices, scalars, mesh };
}

/** Test-only builder: ASCII GIFTI with one POINTSET + one TRIANGLE array. */
export function makeGiftiAscii(positions: number[], indices: number[], opts: { colMajor?: boolean; encoding?: 'ASCII' | 'Base64Binary' } = {}): ArrayBuffer {
  const enc = opts.encoding ?? 'ASCII';
  const body = (vals: number[], isFloat: boolean): string => {
    if (enc === 'ASCII') return vals.map((v) => (isFloat ? String(v) : String(Math.round(v)))).join(' ');
    const buf = new ArrayBuffer(vals.length * 4);
    const dv = new DataView(buf);
    vals.forEach((v, i) => (isFloat ? dv.setFloat32(i * 4, v, true) : dv.setInt32(i * 4, Math.round(v), true)));
    return bytesToB64(new Uint8Array(buf));
  };
  const order = opts.colMajor ? 'ColumnMajorOrder' : 'RowMajorOrder';
  const store = (vals: number[]): number[] => {
    if (!opts.colMajor) return vals;
    const np = vals.length / 3, out: number[] = [];
    for (let k = 0; k < 3; k++) for (let p = 0; p < np; p++) out.push(vals[p * 3 + k]!);
    return out;
  };
  const nv = positions.length / 3, nt = indices.length / 3;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GIFTI Version="1.0" NumberOfDataArrays="2">
<DataArray Intent="NIFTI_INTENT_POINTSET" DataType="NIFTI_TYPE_FLOAT32" ArrayIndexingOrder="${order}" Dimensionality="2" Dim0="${nv}" Dim1="3" Encoding="${enc}" Endian="LittleEndian">
<Data>${body(store(positions), true)}</Data>
</DataArray>
<DataArray Intent="NIFTI_INTENT_TRIANGLE" DataType="NIFTI_TYPE_INT32" ArrayIndexingOrder="${order}" Dimensionality="2" Dim0="${nt}" Dim1="3" Encoding="${enc}" Endian="LittleEndian">
<Data>${body(store(indices), false)}</Data>
</DataArray>
</GIFTI>`;
  return new TextEncoder().encode(xml).buffer as ArrayBuffer;
}
