// MRtrix .tck streamline reader (header layout + NaN/Inf fencing ported
// from NiiVue nvmesh-loaders.ts readTCK, BSD-2-Clause). ASCII header
// ('mrtrix tracks' ... 'END', mandatory 'file:' data offset), Float32LE
// triplets; a NaN-x triplet ends the streamline, an infinite-x triplet ends
// the file. Output matches the fiber fence-post convention (offsetPt0).
// CPU-only cuts: only Float32LE datatypes (rejects BE/other by name);
// per-streamline/per-vertex data tables (TSF/TXT sidecars) not read.
// Fiber *rendering* is still open — this is the reader half.
export class TckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TckError';
  }
}

export interface TckData {
  /** xyz triplets, all streamlines concatenated */
  pts: Float32Array;
  /** fence-posted streamline starts; streamlines = length - 1 */
  offsetPt0: Uint32Array;
}

/** Content sniff: MRtrix signature on the first line. */
export function isTckLike(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 64)));
  return head.split('\n')[0]!.includes('mrtrix tracks');
}

/**
 * Full TCK reader -> concatenated points + fence-post offsets.
 * Throws TckError on bad signatures, missing offsets, wrong datatypes,
 * truncation, or empty contenu.
 */
export function parseTck(buf: ArrayBuffer): TckData {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 20) throw new TckError(`too small (${bytes.length} bytes)`);
  let pos = 0;
  const readLine = (): string => {
    while (pos < bytes.length && bytes[pos] === 0x0a) pos++; // skip blank lines
    const start = pos;
    while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
    pos++; // skip EOLN
    return new TextDecoder().decode(bytes.slice(start, Math.min(pos - 1, bytes.length)));
  };
  if (!readLine().includes('mrtrix tracks')) throw new TckError('missing mrtrix tracks signature');
  let offset = -1;
  let line = '';
  for (;;) {
    line = readLine();
    if (pos > bytes.length) throw new TckError('header runs past EOF (no END)');
    if (line.toLowerCase().startsWith('file:')) {
      const n = parseInt(line.split(' ').pop()!, 10);
      if (Number.isFinite(n)) offset = n;
    }
    if (line.toLowerCase().startsWith('datatype:') && !line.endsWith('Float32LE')) {
      throw new TckError(`only Float32LE supported (${line})`);
    }
    if (line.includes('END')) break;
  }
  if (offset < 0 || offset >= bytes.length) throw new TckError('missing/invalid file offset');
  const dv = new DataView(buf);
  // Over-provision (NiiVue sizing): trim to fit at the end.
  let pts = new Float32Array(Math.floor(bytes.length / 4));
  let off = new Uint32Array(Math.floor(bytes.length / 16) + 1);
  let npt = 0, npt3 = 0, noff = 0;
  off[0] = 0;
  pos = offset;
  for (;;) {
    if (pos + 12 > bytes.length) throw new TckError('truncated streamline data');
    const x = dv.getFloat32(pos, true); pos += 4;
    const y = dv.getFloat32(pos, true); pos += 4;
    const z = dv.getFloat32(pos, true); pos += 4;
    if (!Number.isFinite(x)) {
      off[++noff] = npt;
      if (Number.isNaN(x)) continue; // next streamline
      break; // +-Inf terminates the file
    }
    pts[npt3++] = x; pts[npt3++] = y; pts[npt3++] = z;
    npt++;
  }
  if (noff === 0) throw new TckError('no streamlines (no NaN delimiter found)');
  pts = pts.slice(0, npt3);
  off = off.slice(0, noff + 1);
  return { pts, offsetPt0: off };
}

/** Test-only builder: NaN fences between streamlines, Inf terminates. */
export function makeTck(streamlines: number[][]): ArrayBuffer {
  // Fixed data offset with dot padding ('file: ... 64': pop() takes 64).
  const offset = 64;
  const dots = offset - 46 - String(offset).length;
  if (dots < 1) throw new TckError('builder offset too small');
  const head = `mrtrix tracks\ndatatype: Float32LE\nfile: ${'.'.repeat(dots)} ${offset}\nEND\n`;
  const hb = new TextEncoder().encode(head);
  if (hb.length !== offset) throw new TckError(`builder header ${hb.length} != ${offset}`);
  const nPts = streamlines.reduce((n, s) => n + s.length / 3, 0);
  const nTriplets = nPts + (streamlines.length - 1) + 1; // NaN between, Inf ends
  const out = new ArrayBuffer(offset + nTriplets * 12);
  new Uint8Array(out).set(hb, 0);
  const dv = new DataView(out);
  let o = offset;
  streamlines.forEach((s, si) => {
    for (const v of s) { dv.setFloat32(o, v, true); o += 4; }
    if (si < streamlines.length - 1) {
      dv.setFloat32(o, NaN, true); dv.setFloat32(o + 4, 0, true); dv.setFloat32(o + 8, 0, true); o += 12;
    }
  });
  dv.setFloat32(o, Infinity, true); dv.setFloat32(o + 4, 0, true); dv.setFloat32(o + 8, 0, true);
  return out;
}
