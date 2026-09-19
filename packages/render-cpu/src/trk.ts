// TrackVis .trk streamline reader (header layout + fencing ported from
// NiiVue nvmesh-loaders.ts readTRK, BSD-2-Clause). 1000B LE header (magic
// 'TRAC', vox_to_ras at 440, version/size at 992/996), then per streamline:
// int32 point count + xyz float32 triplets. Points are stored in voxel
// space; vox_to_ras maps them to world (identity when unset). Per-vertex
// (n_scalars) and per-streamline (n_properties) scalars are skipped over,
// not stored — no consumer yet. gzip-wrapped files inflate via fflate;
// zstd is a named error (same boundary as the reference).
import { gunzipSync } from 'fflate';

export class TrkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrkError';
  }
}

export interface TrkData {
  /** world-space xyz triplets, all streamlines concatenated */
  pts: Float32Array;
  /** fence-posted streamline starts; streamlines = length - 1 */
  offsetPt0: Uint32Array;
  /** per-vertex scalars (nScalars × points, row-major), null when nScalars = 0 */
  scalars: Float32Array | null;
  /** scalar count per vertex (header n_scalars) */
  nScalars: number;
  /** per-streamline properties, null when nProps = 0 */
  properties: Float32Array | null;
}

const TRAC_MAGIC = 1128354388; // 'TRAC' LE
const ZSTD_MAGIC = 4247762216;
const HDR_SIZE = 1000;

function gunzipTrk(bytes: Uint8Array): Uint8Array {
  try {
    return gunzipSync(bytes);
  } catch (e) {
    throw new TrkError(`gzip payload corrupt: ${(e as Error).message}`);
  }
}

/** Content sniff: TRAC magic (or gzip wrapping, resolved on parse). */
export function isTrkLike(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 4);
  const magic = dv.getUint32(0, true);
  return magic === TRAC_MAGIC || (bytes[0] === 0x1f && bytes[1] === 0x8b);
}

/**
 * Full TRK reader -> world-space points + fence-post offsets.
 * Throws TrkError on bad magic/version/size, truncation, or empty content.
 */
export function parseTrk(buf: ArrayBuffer): TrkData {
  let bytes = new Uint8Array(buf);
  if (bytes.length >= 4) {
    const dv0 = new DataView(buf);
    const magic0 = dv0.getUint32(0, true);
    if (magic0 === ZSTD_MAGIC) throw new TrkError('zstd TRK decompression is not supported');
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const raw = gunzipTrk(bytes);
      buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
      bytes = new Uint8Array(buf);
    }
  }
  if (bytes.length < HDR_SIZE) throw new TrkError(`too small (${bytes.length} bytes)`);
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== TRAC_MAGIC) throw new TrkError('missing TRAC magic');
  const vers = dv.getUint32(992, true);
  const hdrSize = dv.getUint32(996, true);
  if (vers > 3 || hdrSize !== HDR_SIZE) {
    throw new TrkError(`unsupported version ${vers} / header size ${hdrSize}`);
  }
  const nScalars = dv.getInt16(36, true);
  const nProps = dv.getInt16(238, true);
  if (nScalars < 0 || nProps < 0 || nScalars > 1024 || nProps > 1024) {
    throw new TrkError(`implausible scalar counts ${nScalars}/${nProps}`);
  }
  const mat = new Float32Array(16);
  for (let i = 0; i < 16; i++) mat[i] = dv.getFloat32(440 + i * 4, true);
  const hasMatrix = mat[15] !== 0;
  const xform = (x: number, y: number, z: number): [number, number, number] => {
    if (!hasMatrix) return [x, y, z];
    return [
      mat[0]! * x + mat[1]! * y + mat[2]! * z + mat[3]!,
      mat[4]! * x + mat[5]! * y + mat[6]! * z + mat[7]!,
      mat[8]! * x + mat[9]! * y + mat[10]! * z + mat[11]!,
    ];
  };
  // Growable point buffer (doubling): corrupt counts throw in need()
  // before anything large is committed, so no giant upfront alloc.
  let pts = new Float32Array(1 << 20);
  let npt3 = 0;
  const pushPt = (x: number, y: number, z: number): void => {
    if (npt3 + 3 > pts.length) {
      const grown = new Float32Array(pts.length * 2);
      grown.set(pts);
      pts = grown;
    }
    pts[npt3++] = x; pts[npt3++] = y; pts[npt3++] = z;
  };
  // per-vertex scalars + per-streamline properties: stored, not skipped —
  // tractProfile consumes per-point scalars, the report prints properties
  let scal = new Float32Array(1 << 18);
  let nscal = 0;
  const pushScal = (v: number): void => {
    if (nscal + 1 > scal.length) {
      const grown = new Float32Array(scal.length * 2);
      grown.set(scal);
      scal = grown;
    }
    scal[nscal++] = v;
  };
  const props: number[] = [];
  const off: number[] = [0];
  let npt = 0;
  let pos = HDR_SIZE;
  const need = (n: number, what: string): void => {
    if (pos + n > bytes.length) throw new TrkError(`truncated ${what}`);
  };
  for (;;) {
    if (pos >= bytes.length) break;
    need(4, 'streamline point count');
    const nPts = dv.getInt32(pos, true);
    pos += 4;
    if (nPts < 0 || nPts > 100_000_000) throw new TrkError(`implausible point count ${nPts}`);
    for (let j = 0; j < nPts; j++) {
      need(12 + nScalars * 4, 'vertex');
      const x = dv.getFloat32(pos, true), y = dv.getFloat32(pos + 4, true), z = dv.getFloat32(pos + 8, true);
      pos += 12;
      for (let s = 0; s < nScalars; s++) {
        pushScal(dv.getFloat32(pos, true));
        pos += 4;
      }
      const [wx, wy, wz] = xform(x, y, z);
      pushPt(wx, wy, wz);
      npt++;
    }
    off.push(npt); // fence post closes this streamline
    need(nProps * 4, 'properties');
    for (let p = 0; p < nProps; p++) {
      props.push(dv.getFloat32(pos, true));
      pos += 4;
    }
  }
  if (off.length < 2) throw new TrkError('no streamlines');
  return {
    pts: pts.slice(0, npt3), offsetPt0: Uint32Array.from(off),
    scalars: nScalars > 0 ? scal.slice(0, nscal) : null, nScalars,
    properties: nProps > 0 ? Float32Array.from(props) : null,
  };
}

export interface TrkBuildOpts {
  scalarsPerVertex?: number;
  propertiesPerStreamline?: number;
  /** row-major 4x4 world matrix (mat[15] must be nonzero to count as set) */
  matrix?: number[];
}

/** Test-only builder: header + streamlines (optional scalars/properties). */
export function makeTrk(streamlines: number[][], opts: TrkBuildOpts = {}): ArrayBuffer {
  const nScal = opts.scalarsPerVertex ?? 0;
  const nProp = opts.propertiesPerStreamline ?? 0;
  const out = new ArrayBuffer(HDR_SIZE + streamlines.reduce((n, s) => n + 4 + (s.length / 3) * (12 + nScal * 4) + nProp * 4, 0));
  const dv = new DataView(out);
  const enc = new TextEncoder();
  const bytes = new Uint8Array(out);
  bytes.set(enc.encode('TRAC'), 0);
  dv.setInt16(36, nScal, true);
  dv.setInt16(238, nProp, true);
  const mat = opts.matrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  mat.forEach((v, i) => dv.setFloat32(440 + i * 4, v, true));
  dv.setUint32(992, 2, true);
  dv.setUint32(996, HDR_SIZE, true);
  let pos = HDR_SIZE;
  for (const s of streamlines) {
    const nPts = s.length / 3;
    if (!Number.isInteger(nPts)) throw new TrkError('builder streamline length not triples');
    dv.setInt32(pos, nPts, true);
    pos += 4;
    for (let i = 0; i < s.length; i += 3) {
      dv.setFloat32(pos, s[i]!, true);
      dv.setFloat32(pos + 4, s[i + 1]!, true);
      dv.setFloat32(pos + 8, s[i + 2]!, true);
      pos += 12 + nScal * 4;
    }
    pos += nProp * 4;
  }
  return out;
}
