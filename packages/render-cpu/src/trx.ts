// TRX tractogram reader (layout ported from NiiVue nvmesh-loaders.ts
// readTRX, BSD-2-Clause): a zip of offsets (.uint64 fence posts, final post
// implied), positions.3.(float16|float32), optional header.json. Data-per-
// group/streamline/vertex sidecars are skipped over, not stored — same
// boundary as the TRK reader (no consumer yet). fflate unzips; float16
// decodes via LUT.
import { unzipSync, zipSync } from 'fflate';

export class TrxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrxError';
  }
}

export interface TrxData {
  /** xyz triplets, all streamlines concatenated */
  pts: Float32Array;
  /** fence-posted streamline starts; streamlines = length - 1 */
  offsetPt0: Uint32Array;
  /** parsed header.json, or null when absent */
  header: Record<string, unknown> | null;
  /** data_per_vertex arrays (dps): name → per-point float32 */
  dps: Map<string, Float32Array>;
  /** data_per_streamline arrays: name → per-streamline float32 */
  dpsStreamline: Map<string, Float32Array>;
}

const F16_LUT: Float32Array = (() => {
  const lut = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) {
    const exp = (i & 0x7c00) >> 10;
    const frac = i & 0x03ff;
    lut[i] = (i >> 15 ? -1 : 1) * (exp
      ? exp === 0x1f ? (frac ? NaN : Infinity) : 2 ** (exp - 15) * (1 + frac / 0x400)
      : 6.103515625e-5 * (frac / 0x400));
  }
  return lut;
})();

/** Content sniff: zip magic + a positions payload name in the central directory tail. */
export function isTrxLike(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  return new TextDecoder().decode(bytes.slice(Math.max(0, bytes.length - 65558))).includes('positions.3.');
}

function baseName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1]!;
}

function readU64le(dv: DataView, off: number): number {
  const lo = dv.getUint32(off, true);
  const hi = dv.getUint32(off + 4, true);
  if (hi !== 0) throw new TrxError('offset exceeds 2^32 (JavaScript has no int64)');
  return lo;
}

/**
 * Full TRX reader -> concatenated points + fence-post offsets.
 * Throws TrxError on bad zips, missing/inconsistent arrays, or empty content.
 */
export function parseTrx(buf: ArrayBuffer): TrxData {
  const bytes = new Uint8Array(buf);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    throw new TrxError(`not a zip: ${(e as Error).message}`);
  }
  let offsetsRaw: Uint8Array | null = null;
  let positionsRaw: Uint8Array | null = null;
  let positionsDtype = '';
  let header: Record<string, unknown> | null = null;
  // data_per_vertex (dps) + data_per_streamline sidecars: float32 arrays
  // keyed by name — tractProfile consumes per-point scalars directly
  const dpsRaw = new Map<string, Uint8Array>();
  const dpvRaw = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const base = baseName(name);
    if (base === 'header.json') {
      try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
        header = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
      } catch {
        throw new TrxError('header.json is not valid JSON');
      }
    } else if (base.startsWith('offsets.') && offsetsRaw === null) {
      if (base !== 'offsets.uint64' && base !== 'offsets.int64') {
        throw new TrxError(`offsets dtype ${base} unsupported (need uint64)`);
      }
      offsetsRaw = data;
    } else if (base.startsWith('positions.3.') && positionsRaw === null) {
      positionsDtype = base.slice('positions.3.'.length);
      if (positionsDtype !== 'float16' && positionsDtype !== 'float32') {
        throw new TrxError(`positions dtype ${positionsDtype} unsupported (need float16/32)`);
      }
      positionsRaw = data;
    } else if (name.includes('/dps/') || base.startsWith('dps.')) {
      dpsRaw.set(base, data);
    } else if (name.includes('/data_per_streamline/') || base.startsWith('dps_streamline.')) {
      dpvRaw.set(base, data);
    }
    // dpg/groups sidecars: still skipped (no consumer yet).
  }
  if (!offsetsRaw) throw new TrxError('missing offsets array');
  if (!positionsRaw) throw new TrxError('missing positions array');
  if (offsetsRaw.length % 8 !== 0) throw new TrxError('offsets size not a multiple of 8');
  const offDv = new DataView(offsetsRaw.buffer, offsetsRaw.byteOffset, offsetsRaw.byteLength);
  const offs: number[] = [];
  const nOff = offsetsRaw.length / 8;
  for (let i = 0; i < nOff; i++) offs.push(readU64le(offDv, i * 8));
  if (nOff === 0) throw new TrxError('no streamlines');
  if (offs[0] !== 0) throw new TrxError('first offset must be 0');
  for (let i = 1; i < offs.length; i++) {
    if (offs[i]! < offs[i - 1]!) throw new TrxError('offsets not monotonic');
  }
  let pts: Float32Array;
  if (positionsDtype === 'float32') {
    if (positionsRaw.length % 12 !== 0) throw new TrxError('float32 positions size not triples');
    const copy = new Uint8Array(positionsRaw.length);
    copy.set(positionsRaw);
    pts = new Float32Array(copy.buffer);
  } else {
    if (positionsRaw.length % 6 !== 0) throw new TrxError('float16 positions size not triples');
    const u16 = new Uint16Array(positionsRaw.buffer, positionsRaw.byteOffset, positionsRaw.length / 2);
    pts = new Float32Array(u16.length);
    for (let i = 0; i < u16.length; i++) pts[i] = F16_LUT[u16[i]!]!;
  }
  if (pts.length % 3 !== 0) throw new TrxError('positions not xyz triples');
  const npt = pts.length / 3;
  if (offs[offs.length - 1]! > npt) throw new TrxError('last offset past end of positions');
  offs.push(npt); // fence post closes the final streamline
  // sidecar decode: raw float32 LE (TRX stores native float32 arrays);
  // length-checked against points / streamlines, junk rejected loudly
  const dps = new Map<string, Float32Array>();
  for (const [base, raw] of dpsRaw) {
    if (raw.length % 4 !== 0 || raw.length / 4 !== npt) {
      throw new TrxError(`dps ${base}: ${raw.length} bytes vs ${npt} points`);
    }
    const copy = new Uint8Array(raw.length);
    copy.set(raw);
    dps.set(base, new Float32Array(copy.buffer));
  }
  const dpsStreamline = new Map<string, Float32Array>();
  for (const [base, raw] of dpvRaw) {
    if (raw.length % 4 !== 0 || raw.length / 4 !== offs.length - 1) {
      throw new TrxError(`dps_streamline ${base}: ${raw.length} bytes vs ${offs.length - 1} streamlines`);
    }
    const copy = new Uint8Array(raw.length);
    copy.set(raw);
    dpsStreamline.set(base, new Float32Array(copy.buffer));
  }
  return { pts, offsetPt0: Uint32Array.from(offs), header, dps, dpsStreamline };
}

/** Test-only float32 -> float16 (round to nearest, infinities preserved). */
export function f32ToF16(v: number): number {
  if (!Number.isFinite(v)) return v > 0 ? 0x7c00 : 0xfc00;
  const f32 = new Float32Array([v]);
  const u32 = new Uint32Array(f32.buffer)[0]!;
  const sign = (u32 >> 16) & 0x8000;
  const exp = ((u32 >> 23) & 0xff) - 112;
  const mant = u32 & 0x7fffff;
  if (exp >= 31) return sign | 0x7c00;
  if (exp <= 0) {
    if (exp < -10) return sign;
    const m = (mant | 0x800000) >> (1 - exp);
    return sign | (m >> 13);
  }
  return sign | (exp << 10) | (mant >> 13);
}

/** Test-only builder: zip with header.json + offsets + positions. */
export function makeTrx(
  streamlines: number[][],
  opts: {
    positionsDtype?: 'float16' | 'float32'; header?: Record<string, unknown>;
    dps?: Record<string, number[]>; dpsStreamline?: Record<string, number[]>;
  } = {},
): ArrayBuffer {
  const dtype = opts.positionsDtype ?? 'float32';
  const flat: number[] = [];
  const offs: number[] = [0];
  for (const s of streamlines) {
    if (s.length % 3 !== 0) throw new TrxError('builder streamline length not triples');
    flat.push(...s);
    offs.push(offs[offs.length - 1]! + s.length / 3);
  }
  // Stored offsets are streamline starts INCLUDING 0, EXCLUDING the final
  // fence (the reader restores it from the positions length).
  const offBytes = new Uint8Array((offs.length - 1) * 8);
  const offDv = new DataView(offBytes.buffer);
  offs.slice(0, -1).forEach((v, i) => { offDv.setUint32(i * 8, v, true); offDv.setUint32(i * 8 + 4, 0, true); });
  let posBytes: Uint8Array;
  if (dtype === 'float32') {
    posBytes = new Uint8Array(flat.length * 4);
    const dv = new DataView(posBytes.buffer);
    flat.forEach((v, i) => dv.setFloat32(i * 4, v, true));
  } else {
    posBytes = new Uint8Array(flat.length * 2);
    const dv = new DataView(posBytes.buffer);
    flat.forEach((v, i) => dv.setUint16(i * 2, f32ToF16(v), true));
  }
  const files: Record<string, Uint8Array> = {
    't/offsets.uint64': offBytes,
    [`t/positions.3.${dtype}`]: posBytes,
  };
  const f32arr = (vs: number[]): Uint8Array => {
    const b = new Uint8Array(vs.length * 4);
    const dv = new DataView(b.buffer);
    vs.forEach((v, i) => dv.setFloat32(i * 4, v, true));
    return b;
  };
  for (const [name, vs] of Object.entries(opts.dps ?? {})) {
    files[`t/dps/${name}.float32`] = f32arr(vs);
  }
  for (const [name, vs] of Object.entries(opts.dpsStreamline ?? {})) {
    files[`t/data_per_streamline/${name}.float32`] = f32arr(vs);
  }
  if (opts.header) {
    files['t/header.json'] = new TextEncoder().encode(JSON.stringify(opts.header));
  }
  const zipped = zipSync(files);
  const out = new ArrayBuffer(zipped.length);
  new Uint8Array(out).set(zipped);
  return out;
}
