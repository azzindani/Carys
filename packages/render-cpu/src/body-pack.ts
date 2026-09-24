// The whole-body atlas package (H1, docs/PHASES.md): BodyParts3D meshes,
// one file per body system, in a compact binary the app fetches as is.
//
// Layout ("carys-body/1", little-endian): the magic "CBDY", a u32 version,
// a u32 header length, the header (UTF-8 JSON, space-padded to 4 bytes),
// then every part's positions quantized to u16 over the file's bounds
// (min + q / 65535 · (max − min), so no coordinate moves more than half a
// step), then every part's indices, u16 when the part has at most 65,536
// vertices and u32 past that, each block 4-byte aligned. The header lists
// the parts: FMA concept, BodyParts3D element, name, system, where its
// vertices and indices are, how many triangles its source had and the
// largest distance (mm) the build measured between source and packed
// mesh, both ways. Pure, no DOM.

export const BODY_SYSTEMS = [
  'skeletal', 'muscular', 'nervous', 'cardiovascular', 'lymphatic', 'respiratory', 'digestive',
  'urinary', 'reproductive', 'endocrine', 'sensory', 'integumentary', 'other',
] as const;
export type BodySystem = typeof BODY_SYSTEMS[number];

type V3 = [number, number, number];

export interface BodyPartMeta {
  /** FMA concept id (FMA…) */
  fma: string;
  /** BodyParts3D element mesh id (FJ…) */
  element: string;
  name: string;
  system: BodySystem;
  /** triangles in the source mesh */
  sourceTris: number;
  /** largest distance between the source mesh and this one, both ways, mm */
  errorMm: number;
}

export interface BodyPart extends BodyPartMeta {
  /** mm, BodyParts3D's frame */
  positions: Float32Array;
  indices: Uint32Array;
}

export interface BodyPack {
  min: V3;
  max: V3;
  parts: BodyPart[];
}

interface HeaderPart extends BodyPartMeta {
  /** first vertex, vertex count */
  v: [number, number];
  /** byte offset of the indices, index count, bits per index */
  i: [number, number, 16 | 32];
}

interface Header {
  format: 'carys-body/1';
  min: V3;
  max: V3;
  parts: HeaderPart[];
}

const MAGIC = 0x59444243; // "CBDY"
const VERSION = 1;
const Q = 65535;

const pad4 = (n: number): number => (n + 3) & ~3;

/** The bounds of a set of parts. */
export function bodyBounds(parts: { positions: ArrayLike<number> }[]): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = p.positions[i + k]!;
        if (v < min[k]!) min[k] = v;
        if (v > max[k]!) max[k] = v;
      }
    }
  }
  return { min, max };
}

/**
 * Pack parts into one file, quantized over `bounds` (default: the parts'
 * own; the build passes the whole body's, so every system shares a grid).
 * Throws `body-pack-*` on a part outside the bounds or a bad index.
 */
export function packBody(parts: BodyPart[], bounds = bodyBounds(parts)): Uint8Array {
  const { min, max } = bounds;
  const span = [0, 1, 2].map((k) => max[k]! - min[k]!);
  if (!span.every((s) => Number.isFinite(s) && s > 0)) throw new RangeError(`body-pack-bounds: [${min}] … [${max}]`);
  let nv = 0, ib = 0;
  const head: HeaderPart[] = parts.map((p) => {
    const count = p.positions.length / 3;
    if (!Number.isInteger(count) || p.indices.length % 3 !== 0) throw new RangeError(`body-pack-part: ${p.element}`);
    for (const x of p.indices) if (x >= count) throw new RangeError(`body-pack-index: ${p.element} index ${x} of ${count} vertices`);
    const bits: 16 | 32 = count <= 65536 ? 16 : 32;
    const h: HeaderPart = {
      fma: p.fma, element: p.element, name: p.name, system: p.system, sourceTris: p.sourceTris, errorMm: p.errorMm,
      v: [nv, count], i: [ib, p.indices.length, bits],
    };
    nv += count;
    ib = pad4(ib + p.indices.length * (bits / 8));
    return h;
  });
  const header: Header = { format: 'carys-body/1', min, max, parts: head };
  let json = JSON.stringify(header);
  while ((12 + new TextEncoder().encode(json).length) % 4) json += ' ';
  const text = new TextEncoder().encode(json);
  const posAt = 12 + text.length, idxAt = posAt + pad4(nv * 6);
  const out = new Uint8Array(idxAt + ib);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, VERSION, true); dv.setUint32(8, text.length, true);
  out.set(text, 12);
  parts.forEach((p, n) => {
    const h = head[n]!;
    for (let i = 0; i < p.positions.length; i++) {
      const k = i % 3, t = (p.positions[i]! - min[k]!) / span[k]!;
      if (!(t >= -1e-9 && t <= 1 + 1e-9)) throw new RangeError(`body-pack-outside: ${p.element} coordinate ${p.positions[i]}`);
      dv.setUint16(posAt + (h.v[0] * 3 + i) * 2, Math.round(Math.min(1, Math.max(0, t)) * Q), true);
    }
    const at = idxAt + h.i[0];
    p.indices.forEach((x, j) => (h.i[2] === 16 ? dv.setUint16(at + j * 2, x, true) : dv.setUint32(at + j * 4, x, true)));
  });
  return out;
}

/** Read a packed file. Throws `body-pack-*` on anything malformed. */
export function unpackBody(src: ArrayBuffer | Uint8Array): BodyPack {
  const bytes = src instanceof Uint8Array ? src : new Uint8Array(src);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || dv.getUint32(0, true) !== MAGIC) throw new RangeError('body-pack-magic: not a carys-body file');
  if (dv.getUint32(4, true) !== VERSION) throw new RangeError(`body-pack-version: ${dv.getUint32(4, true)}`);
  const hl = dv.getUint32(8, true);
  if (12 + hl > bytes.length) throw new RangeError('body-pack-truncated: header');
  let header: Header;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + hl))) as Header;
  } catch {
    throw new RangeError('body-pack-header: not JSON');
  }
  if (header.format !== 'carys-body/1' || !Array.isArray(header.parts)) throw new RangeError('body-pack-header: not carys-body/1');
  const { min, max } = header;
  const step = [0, 1, 2].map((k) => (max[k]! - min[k]!) / Q);
  const nv = header.parts.reduce((s, p) => Math.max(s, p.v[0] + p.v[1]), 0);
  const posAt = 12 + hl, idxAt = posAt + pad4(nv * 6);
  const parts = header.parts.map((h): BodyPart => {
    const [v0, count] = h.v, [at, n, bits] = h.i;
    if (!BODY_SYSTEMS.includes(h.system)) throw new RangeError(`body-pack-system: ${h.system}`);
    if (idxAt + at + n * (bits / 8) > bytes.length) throw new RangeError(`body-pack-truncated: ${h.element}`);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < positions.length; i++) {
      positions[i] = min[i % 3]! + dv.getUint16(posAt + (v0 * 3 + i) * 2, true) * step[i % 3]!;
    }
    const indices = new Uint32Array(n);
    for (let j = 0; j < n; j++) {
      const x = bits === 16 ? dv.getUint16(idxAt + at + j * 2, true) : dv.getUint32(idxAt + at + j * 4, true);
      if (x >= count) throw new RangeError(`body-pack-index: ${h.element} index ${x} of ${count} vertices`);
      indices[j] = x;
    }
    return { fma: h.fma, element: h.element, name: h.name, system: h.system, sourceTris: h.sourceTris, errorMm: h.errorMm, positions, indices };
  });
  return { min, max, parts };
}

/** One system file in the digest's index. */
export interface BodySystemFile {
  file: string;
  parts: number;
  tris: number;
  sourceTris: number;
  bytes: number;
  worstErrorMm: number;
}

/** A part without its mesh: element, FMA concept, name, system. */
export type BodyIndexRow = [element: string, fma: string, name: string, system: BodySystem];

/** The digest's index.json ("carys-body-index/1"): its systems' files and
 *  every part, so a structure is found before its file is fetched. */
export interface BodyIndex {
  pin: string;
  attribution: string;
  /** the grid every system file is quantized on (BodyParts3D frame, mm) */
  min: V3;
  max: V3;
  systems: Partial<Record<BodySystem, BodySystemFile>>;
  tris: number;
  bytes: number;
  worstErrorMm: number;
  /** in element order; each system file holds its rows in this order */
  parts: BodyIndexRow[];
}

/** Check a parsed index.json. Throws `body-index: …` on anything off:
 *  a count that disagrees, an unknown system, a repeated element. */
export function validateBodyIndex(raw: unknown): BodyIndex {
  const bad = (why: string): RangeError => new RangeError(`body-index: ${why}`);
  if (!raw || typeof raw !== 'object') throw bad('not an object');
  const r = raw as Record<string, unknown>;
  if (r['format'] !== 'carys-body-index/1') throw bad(`format ${String(r['format'])}`);
  for (const k of ['pin', 'attribution'] as const) if (typeof r[k] !== 'string' || !r[k]) throw bad(`${k} missing`);
  const v3 = (x: unknown): x is V3 => Array.isArray(x) && x.length === 3 && x.every((n) => Number.isFinite(n));
  if (!v3(r['min']) || !v3(r['max']) || ![0, 1, 2].every((k) => (r['min'] as V3)[k]! < (r['max'] as V3)[k]!)) throw bad('bounds');
  const systems = r['systems'] as Record<string, BodySystemFile> | undefined;
  if (!systems || typeof systems !== 'object') throw bad('systems missing');
  const rows = r['parts'];
  if (!Array.isArray(rows) || rows.length !== r['elements']) throw bad(`${Array.isArray(rows) ? rows.length : 'no'} part rows for ${String(r['elements'])} elements`);
  const count = new Map<string, number>(), seen = new Set<string>();
  for (const row of rows as unknown[]) {
    if (!Array.isArray(row) || row.length !== 4 || !row.every((x) => typeof x === 'string' && x)) throw bad(`row ${JSON.stringify(row)}`);
    const [element, , , system] = row as string[];
    if (seen.has(element!)) throw bad(`element ${element} twice`);
    seen.add(element!);
    if (!systems[system!]) throw bad(`${element} in system ${system}, which has no file`);
    count.set(system!, (count.get(system!) ?? 0) + 1);
  }
  for (const [s, f] of Object.entries(systems)) {
    if (!(BODY_SYSTEMS as readonly string[]).includes(s)) throw bad(`unknown system ${s}`);
    if (f.file !== `${s}.cbdy` || !Number.isInteger(f.parts) || !(f.tris > 0)) throw bad(`system ${s} file entry`);
    if (count.get(s) !== f.parts) throw bad(`system ${s}: ${count.get(s) ?? 0} rows, file has ${f.parts} parts`);
  }
  return r as unknown as BodyIndex;
}
