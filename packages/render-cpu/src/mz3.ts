// Ported from NiiVue nvmesh-loaders.ts readMZ3 (BSD-2-Clause): 16B LE header
// (u16 magic 23117, u16 attr flags, u32 nface/nvert/nskip), nskip JSON bytes,
// faces u32, verts f32, RGBA u8 (alpha skipped, rgb /255), scalars f32 (f64
// when attr&16). CPU-only cuts: gzip-wrapped files rejected by name (inflate
// upstream with fflate first), attr > 127 (future versions) rejected, AOMAP /
// LOOKUP sidecars ignored — geometry, colors and scalars are what the CPU
// rasterizer consumes.
import type { TriMesh } from './surface.js';

export const MZ3_MAGIC = 23117;
// gzip magic as read u16LE (0x8b1f / 0x1f8b): NiiVue inflates, we name it.
const GZIP_MAGIC_LE = 35615;
const GZIP_MAGIC_BE = 8075;
const ATTR_FACE = 1;
const ATTR_VERT = 2;
const ATTR_RGBA = 4;
const ATTR_SCALAR = 8;
const ATTR_DOUBLE = 16;
const ATTR_FUTURE_MASK = ~127;

export class Mz3Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Mz3Error';
  }
}

/** Content sniff: raw MZ3 magic. Gzip-wrapped files sniff false (see parse). */
export function isMz3Like(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 16);
  return dv.getUint16(0, true) === MZ3_MAGIC;
}

export interface Mz3Data {
  mesh: TriMesh;
  /** per-vertex rgb in 0..1, or null when attr&4 clear */
  colors: Float32Array | null;
  /** concatenated scalar frames (nvert each), or null when attr&8 clear */
  scalars: Float32Array | null;
}

function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3, b = indices[t + 1]! * 3, c = indices[t + 2]! * 3;
    const e1x = positions[b]! - positions[a]!, e1y = positions[b + 1]! - positions[a + 1]!, e1z = positions[b + 2]! - positions[a + 2]!;
    const e2x = positions[c]! - positions[a]!, e2y = positions[c + 1]! - positions[a + 1]!, e2z = positions[c + 2]! - positions[a + 2]!;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) { n[v]! += nx; n[v + 1]! += ny; n[v + 2]! += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1;
    n[i]! /= l; n[i + 1]! /= l; n[i + 2]! /= l;
  }
  return n;
}

/**
 * Full MZ3 mesh reader (faces + verts required) -> indexed TriMesh with
 * accumulated unit vertex normals. Throws Mz3Error on gzip, future attrs,
 * truncation, or out-of-range indices.
 */
export function parseMz3(buf: ArrayBuffer): Mz3Data {
  if (buf.byteLength < 16) throw new Mz3Error(`truncated header (${buf.byteLength} bytes)`);
  const dv = new DataView(buf);
  const magic = dv.getUint16(0, true);
  if (magic === GZIP_MAGIC_LE || magic === GZIP_MAGIC_BE) {
    throw new Mz3Error('gzip-wrapped MZ3: inflate (e.g. fflate gunzipSync) before parsing');
  }
  if (magic !== MZ3_MAGIC) throw new Mz3Error(`bad magic ${magic}, need ${MZ3_MAGIC}`);
  const attr = dv.getUint16(2, true);
  if (attr & ATTR_FUTURE_MASK) throw new Mz3Error(`unsupported future attr bits ${attr}`);
  const nface = dv.getUint32(4, true);
  const nvert = dv.getUint32(8, true);
  const nskip = dv.getUint32(12, true);
  if (!(attr & ATTR_FACE) || nface < 1) throw new Mz3Error('no faces: scalar-only MZ3 has no mesh to render');
  if (!(attr & ATTR_VERT) || nvert < 3) throw new Mz3Error(`no verts (nvert=${nvert})`);
  if (nface > 50_000_000 || nvert > 50_000_000) throw new Mz3Error(`implausible sizes nface=${nface} nvert=${nvert}`);
  const need = (n: number, what: string): void => {
    if (buf.byteLength < n) throw new Mz3Error(`truncated ${what}: need ${n} bytes, have ${buf.byteLength}`);
  };
  let pos = 16 + nskip;
  need(pos + nface * 12, 'faces');
  const indices = new Uint32Array(nface * 3);
  for (let i = 0; i < indices.length; i++) {
    const v = dv.getUint32(pos, true);
    pos += 4;
    if (v >= nvert) throw new Mz3Error(`face index ${v} out of range (nvert=${nvert})`);
    indices[i] = v;
  }
  need(pos + nvert * 12, 'verts');
  const positions = new Float32Array(nvert * 3);
  for (let i = 0; i < positions.length; i++) { positions[i] = dv.getFloat32(pos, true); pos += 4; }
  let colors: Float32Array | null = null;
  if (attr & ATTR_RGBA) {
    need(pos + nvert * 4, 'rgba');
    colors = new Float32Array(nvert * 3);
    const raw = new Uint8Array(buf, pos, nvert * 4);
    for (let v = 0; v < nvert; v++) {
      colors[v * 3] = raw[v * 4]! / 255;
      colors[v * 3 + 1] = raw[v * 4 + 1]! / 255;
      colors[v * 3 + 2] = raw[v * 4 + 2]! / 255;
    }
    pos += nvert * 4;
  }
  let scalars: Float32Array | null = null;
  if (attr & ATTR_SCALAR) {
    const bps = (attr & ATTR_DOUBLE) ? 8 : 4;
    const left = buf.byteLength - pos;
    const frames = Math.floor(left / (nvert * bps));
    if (frames < 1) throw new Mz3Error(`SCALAR flag set but only ${left} trailing bytes for ${nvert} verts`);
    scalars = new Float32Array(frames * nvert);
    for (let i = 0; i < scalars.length; i++) {
      scalars[i] = (attr & ATTR_DOUBLE) ? dv.getFloat64(pos, true) : dv.getFloat32(pos, true);
      pos += bps;
    }
  }
  return { mesh: { positions, normals: vertexNormals(positions, indices), indices }, colors, scalars };
}

/** Test-only inverse: build a raw MZ3 buffer from mesh parts. */
export function makeMz3(
  positions: Float32Array,
  indices: Uint32Array,
  opts: { colors?: Float32Array | null; scalars?: Float32Array | null; nskip?: number } = {},
): ArrayBuffer {
  const nvert = positions.length / 3;
  const nface = indices.length / 3;
  if (!Number.isInteger(nvert) || !Number.isInteger(nface)) throw new Mz3Error('positions/indices length not a multiple of 3');
  let attr = ATTR_FACE | ATTR_VERT;
  if (opts.colors) attr |= ATTR_RGBA;
  if (opts.scalars) attr |= ATTR_SCALAR;
  const nskip = opts.nskip ?? 0;
  const size = 16 + nskip + nface * 12 + nvert * 12
    + (opts.colors ? nvert * 4 : 0) + (opts.scalars ? opts.scalars.length * 4 : 0);
  const out = new ArrayBuffer(size);
  const dv = new DataView(out);
  dv.setUint16(0, MZ3_MAGIC, true);
  dv.setUint16(2, attr, true);
  dv.setUint32(4, nface, true);
  dv.setUint32(8, nvert, true);
  dv.setUint32(12, nskip, true);
  let pos = 16 + nskip;
  for (const v of indices) { dv.setUint32(pos, v, true); pos += 4; }
  for (const p of positions) { dv.setFloat32(pos, p, true); pos += 4; }
  if (opts.colors) {
    for (let v = 0; v < nvert; v++) {
      dv.setUint8(pos, Math.round(opts.colors[v * 3]! * 255)); dv.setUint8(pos + 1, Math.round(opts.colors[v * 3 + 1]! * 255));
      dv.setUint8(pos + 2, Math.round(opts.colors[v * 3 + 2]! * 255)); dv.setUint8(pos + 3, 255);
      pos += 4;
    }
  }
  if (opts.scalars) for (const s of opts.scalars) { dv.setFloat32(pos, s, true); pos += 4; }
  return out;
}
