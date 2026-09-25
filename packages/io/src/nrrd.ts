// NRRD reader (NRRD0001-0005 header layout, parsed identically) — the format
// NiiVue lists beside NIfTI and our formats.ts already hints as 'nrrd' with
// no reader behind it. Header: ASCII magic + "key: value" lines + one blank
// line, then data. Covers 3D volumes, raw/ascii/gzip encodings, all 8 scalar
// types, spacings, both endians. Named NrrdError for everything else.
// Skips: detached .nhdr data files, ":=" inline data, space directions
// (spacing magnitudes only), kinds, byte-skip, bzip2.
import { gunzipSync, gzipSync } from 'fflate';

export class NrrdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NrrdError';
  }
}

export type NrrdDType =
  | 'uint8' | 'int8' | 'uint16' | 'int16' | 'uint32' | 'int32'
  | 'float32' | 'float64';

export interface NrrdVolume {
  dims: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  dtype: NrrdDType;
  data: Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;
}

const TYPE_MAP: Record<string, { dtype: NrrdDType; bpe: number }> = {
  'uchar': { dtype: 'uint8', bpe: 1 }, 'unsigned char': { dtype: 'uint8', bpe: 1 },
  'uint8': { dtype: 'uint8', bpe: 1 }, 'uint8_t': { dtype: 'uint8', bpe: 1 },
  'signed char': { dtype: 'int8', bpe: 1 }, 'int8': { dtype: 'int8', bpe: 1 }, 'int8_t': { dtype: 'int8', bpe: 1 },
  'ushort': { dtype: 'uint16', bpe: 2 }, 'unsigned short': { dtype: 'uint16', bpe: 2 },
  'uint16': { dtype: 'uint16', bpe: 2 }, 'uint16_t': { dtype: 'uint16', bpe: 2 },
  'short': { dtype: 'int16', bpe: 2 }, 'short int': { dtype: 'int16', bpe: 2 },
  'signed short': { dtype: 'int16', bpe: 2 }, 'int16': { dtype: 'int16', bpe: 2 }, 'int16_t': { dtype: 'int16', bpe: 2 },
  'uint': { dtype: 'uint32', bpe: 4 }, 'unsigned int': { dtype: 'uint32', bpe: 4 },
  'uint32': { dtype: 'uint32', bpe: 4 }, 'uint32_t': { dtype: 'uint32', bpe: 4 },
  'int': { dtype: 'int32', bpe: 4 }, 'signed int': { dtype: 'int32', bpe: 4 },
  'int32': { dtype: 'int32', bpe: 4 }, 'int32_t': { dtype: 'int32', bpe: 4 },
  'float': { dtype: 'float32', bpe: 4 },
  'double': { dtype: 'float64', bpe: 8 },
};

function splitHeader(bytes: Uint8Array, allowEofHeader = false): { fields: Map<string, string>; dataOffset: number } {
  // Byte-level line scan (binary-safe: data may contain \n\n itself).
  const lines: string[] = [];
  let start = 0, dataOffset = -1;
  for (let i = 0; i <= bytes.length; i++) {
    if (i === bytes.length || bytes[i] === 0x0a) {
      const line = new TextDecoder().decode(bytes.slice(start, i)).replace(/\r$/, '');
      if (line.trim() === '') { dataOffset = (i === bytes.length ? i : i + 1); break; }
      lines.push(line);
      start = i + 1;
    }
  }
  if (dataOffset === -1) {
    // Detached .nhdr files end after the last header line (no blank line,
    // no inline data): the whole file is the header.
    if (!allowEofHeader) throw new NrrdError('no blank line separating header from data');
    dataOffset = bytes.length;
  }
  if (lines.length === 0 || !/^NRRD000[1-5]/.test(lines[0]!)) {
    throw new NrrdError(`bad magic ${JSON.stringify(lines[0] ?? '(empty)')}`);
  }
  const fields = new Map<string, string>();
  for (const line of lines.slice(1)) {
    if (line.startsWith('#')) continue;
    if (line.includes(':=')) throw new NrrdError('inline ":=" data not supported (detached .nhdr neither)');
    const ci = line.indexOf(':');
    if (ci === -1) throw new NrrdError(`malformed header line ${JSON.stringify(line)}`);
    fields.set(line.slice(0, ci).trim().toLowerCase(), line.slice(ci + 1).trim());
  }
  return { fields, dataOffset };
}

function required(fields: Map<string, string>, key: string): string {
  const v = fields.get(key);
  if (v === undefined || v === '') throw new NrrdError(`missing header field "${key}"`);
  return v;
}

/**
 * Full NRRD reader -> volume-shaped data (x fastest, matching sizes order).
 * Throws NrrdError on bad headers, unsupported types/encodings, or
 * size/data mismatches.
 */
export function parseNrrd(buf: ArrayBuffer): NrrdVolume {
  const bytes = new Uint8Array(buf);
  const { fields, dataOffset } = splitHeader(bytes);
  return decodeNrrd(fields, bytes.slice(dataOffset));
}

/**
 * Detached-header reader (.nhdr + separate data file): same header grammar,
 * payload supplied by the caller (the loader resolves the "data file" name
 * and optional "byte skip"). Throws NrrdError like parseNrrd.
 */
export function parseNrrdDetached(headerBuf: ArrayBuffer, data: Uint8Array): NrrdVolume {
  const { fields } = splitHeader(new Uint8Array(headerBuf), true);
  const skipRaw = fields.get('byte skip') ?? fields.get('byteskip');
  const skip = skipRaw === undefined ? 0 : parseInt(skipRaw, 10);
  if (!Number.isInteger(skip) || skip < 0) throw new NrrdError(`bad byte skip ${JSON.stringify(skipRaw)}`);
  if (skip > data.length) throw new NrrdError(`byte skip ${skip} past ${data.length}-byte data file`);
  return decodeNrrd(fields, data.slice(skip));
}

/**
 * The "data file" name a detached header points at ("data file:" or
 * "datafile:"), or null for an attached header. Throws NrrdError on a
 * non-NRRD buffer — callers treat that as "not a header".
 */
export function nrrdDetachedName(headerBuf: ArrayBuffer): string | null {
  const { fields } = splitHeader(new Uint8Array(headerBuf), true);
  const v = fields.get('data file') ?? fields.get('datafile');
  return v === undefined || v === '' ? null : v;
}

function decodeNrrd(fields: Map<string, string>, raw0: Uint8Array): NrrdVolume {
  const typeInfo = TYPE_MAP[required(fields, 'type').toLowerCase()];
  if (!typeInfo) throw new NrrdError(`unsupported type ${JSON.stringify(fields.get('type'))}`);
  const dimension = parseInt(required(fields, 'dimension'), 10);
  if (dimension !== 3) throw new NrrdError(`dimension=${dimension}: only 3D volumes supported`);
  const sizes = required(fields, 'sizes').split(/\s+/).map(Number);
  if (sizes.length !== 3 || sizes.some((s) => !Number.isInteger(s) || s < 1)) {
    throw new NrrdError(`bad sizes ${JSON.stringify(fields.get('sizes'))}`);
  }
  const dims = sizes as [number, number, number];
  const n = dims[0] * dims[1] * dims[2];
  let spacing: [number, number, number] = [1, 1, 1];
  if (fields.has('spacings') || fields.has('spacing')) {
    const sp = (fields.get('spacings') ?? fields.get('spacing')!).split(/\s+/).map(Number);
    spacing = [
      Number.isFinite(sp[0]) ? sp[0]! : 1,
      Number.isFinite(sp[1]) ? sp[1]! : 1,
      Number.isFinite(sp[2]) ? sp[2]! : 1,
    ];
  }
  const bigEndian = (fields.get('endian') ?? 'little').toLowerCase() === 'big';
  const encoding = required(fields, 'encoding').toLowerCase();
  const { dtype, bpe } = typeInfo;
  let raw: Uint8Array;
  if (encoding === 'raw') {
    raw = raw0;
    if (raw.length === n * bpe + 1 && raw[raw.length - 1] === 0x0a) raw = raw.slice(0, n * bpe); // trailing newline
    if (raw.length !== n * bpe) throw new NrrdError(`raw data ${raw.length} bytes != ${n} x ${bpe}`);
  } else if (encoding === 'ascii' || encoding === 'text' || encoding === 'txt') {
    const toks = new TextDecoder().decode(raw0).trim().split(/\s+/);
    if (toks.length !== n) throw new NrrdError(`ascii values ${toks.length} != ${n} voxels`);
    const isInt = bpe <= 4 && dtype !== 'float32' && dtype !== 'float64';
    const vals = toks.map(Number);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(vals[i])) throw new NrrdError(`non-numeric ascii value ${i}`);
      if (isInt && !Number.isInteger(vals[i]!)) throw new NrrdError(`non-integer ascii value ${i} for ${dtype}`);
    }
    const dv = new DataView(new ArrayBuffer(n * bpe));
    for (let i = 0; i < n; i++) setValue(dv, dtype, i, vals[i]!, true);
    return { dims, spacing, origin: [0, 0, 0], dtype, data: wrapArray(dv, dtype, n) };
  } else if (encoding === 'gzip' || encoding === 'gz') {
    try {
      raw = gunzipSync(raw0);
    } catch (e) {
      throw new NrrdError(`gzip payload corrupt: ${(e as Error).message}`);
    }
    if (raw.length !== n * bpe) throw new NrrdError(`gunzipped ${raw.length} bytes != ${n} x ${bpe}`);
  } else {
    throw new NrrdError(`unsupported encoding ${JSON.stringify(fields.get('encoding'))}`);
  }
  if (bpe === 1) {
    return {
      dims, spacing, origin: [0, 0, 0], dtype,
      data: dtype === 'uint8' ? Uint8Array.from(raw) : Int8Array.from(raw),
    };
  }
  // Aligned copy (slice may be unaligned) + optional endian swap.
  const copy = new Uint8Array(n * bpe);
  copy.set(raw.subarray(0, n * bpe));
  const dv = new DataView(copy.buffer);
  const little = !bigEndian;
  if (!little) {
    const tmp = new Uint8Array(bpe);
    for (let i = 0; i < n; i++) {
      for (let b = 0; b < bpe; b++) tmp[b] = dv.getUint8(i * bpe + b);
      for (let b = 0; b < bpe; b++) dv.setUint8(i * bpe + b, tmp[bpe - 1 - b]!);
    }
  }
  return { dims, spacing, origin: [0, 0, 0], dtype, data: wrapArray(dv, dtype, n) };
}

function setValue(dv: DataView, dtype: NrrdDType, i: number, v: number, little: boolean): void {
  switch (dtype) {
    case 'uint8': dv.setUint8(i, v); break;
    case 'int8': dv.setInt8(i, v); break;
    case 'uint16': dv.setUint16(i * 2, v, little); break;
    case 'int16': dv.setInt16(i * 2, v, little); break;
    case 'uint32': dv.setUint32(i * 4, v, little); break;
    case 'int32': dv.setInt32(i * 4, v, little); break;
    case 'float32': dv.setFloat32(i * 4, v, little); break;
    case 'float64': dv.setFloat64(i * 8, v, little); break;
  }
}

function wrapArray(dv: DataView, dtype: NrrdDType, n: number): NrrdVolume['data'] {
  switch (dtype) {
    case 'uint8': return new Uint8Array(dv.buffer, dv.byteOffset, n);
    case 'int8': return new Int8Array(dv.buffer, dv.byteOffset, n);
    case 'uint16': return new Uint16Array(dv.buffer, dv.byteOffset, n);
    case 'int16': return new Int16Array(dv.buffer, dv.byteOffset, n);
    case 'uint32': return new Uint32Array(dv.buffer, dv.byteOffset, n);
    case 'int32': return new Int32Array(dv.buffer, dv.byteOffset, n);
    case 'float32': return new Float32Array(dv.buffer, dv.byteOffset, n);
    case 'float64': return new Float64Array(dv.buffer, dv.byteOffset, n);
  }
}

/** Test-only builder: header + payload in the requested encoding/endian. */
export function makeNrrd(
  dims: [number, number, number],
  dtype: NrrdDType,
  values: number[],
  opts: { encoding?: 'raw' | 'ascii' | 'gzip'; endian?: 'little' | 'big'; spacing?: [number, number, number] } = {},
): ArrayBuffer {
  const encoding = opts.encoding ?? 'raw';
  const endian = opts.endian ?? 'little';
  const n = dims[0] * dims[1] * dims[2];
  if (values.length !== n) throw new NrrdError(`builder: ${values.length} values != ${n} voxels`);
  const typeName = { uint8: 'uchar', int8: 'signed char', uint16: 'ushort', int16: 'short', uint32: 'uint', int32: 'int', float32: 'float', float64: 'double' }[dtype];
  const bpe = { uint8: 1, int8: 1, uint16: 2, int16: 2, uint32: 4, int32: 4, float32: 4, float64: 8 }[dtype];
  let head = `NRRD0004\ntype: ${typeName}\ndimension: 3\nsizes: ${dims[0]} ${dims[1]} ${dims[2]}\nendian: ${endian}\nencoding: ${encoding}\n`;
  if (opts.spacing) head += `spacings: ${opts.spacing[0]} ${opts.spacing[1]} ${opts.spacing[2]}\n`;
  head += '\n';
  const hb = new TextEncoder().encode(head);
  let payload: Uint8Array;
  if (encoding === 'ascii') {
    payload = new TextEncoder().encode(values.join(' '));
  } else {
    const dv = new DataView(new ArrayBuffer(n * bpe));
    const little = endian === 'little';
    values.forEach((v, i) => setValue(dv, dtype, i, v, little));
    payload = new Uint8Array(dv.buffer);
    if (encoding === 'gzip') payload = gzipSync(payload);
  }
  const out = new Uint8Array(hb.length + payload.length);
  out.set(hb, 0);
  out.set(payload, hb.length);
  return out.buffer as ArrayBuffer;
}
