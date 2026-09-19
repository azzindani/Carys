// Deflated Explicit VR Little Endian transfer syntax (1.2.840.10008.1.2.1.99).
// The file meta (group 0002) is never deflated; the dataset after it is one
// deflate stream (PS3.5 A.5). Inflate it pre-walk so both dataset readers see
// plain explicit-LE bytes. fflate was already a dependency (omezarr,
// nifti-gzip); no new weight. Preamble scan is duplicated from Walker on
// purpose: this module must not import dicom-parse (which imports this one).

import { inflateSync, unzlibSync } from 'fflate';
import { TS_DEFLATED } from './dicom-tags.js';
import { isLength32VR } from './dicom-vr.js';

export class DeflateError extends Error {
  constructor(public kind: string, detail: string) {
    super(`deflated ${kind}: ${detail}`);
  }
}

function metaStartOf(bytes: Uint8Array): number {
  if (bytes.length > 132 && bytes[128] === 68 && bytes[129] === 73 && bytes[130] === 67 && bytes[131] === 77) {
    return 132;
  }
  for (let i = 0; i < Math.min(640, bytes.length - 4); i++) {
    if (bytes[i] === 68 && bytes[i + 1] === 73 && bytes[i + 2] === 67 && bytes[i + 3] === 77) return i + 4;
  }
  return 0;
}

/**
 * Return a walkable buffer: inflated fresh Part-10 when the meta declares
 * the deflated syntax, otherwise the input buffer untouched (same object).
 * Throws DeflateError on corrupt meta or a failing inflate — never returns
 * half-inflated bytes.
 */
export function inflateDeflatedDataset(buffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let off = metaStartOf(bytes);
  const end = bytes.length;
  let ts: string | null = null;
  let groupLength: number | null = null;
  let afterGroupLength = -1;
  while (off + 8 <= end) {
    const group = view.getUint16(off, true);
    if (group !== 0x0002) break;
    if (off + 8 > end) break;
    const vr = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!);
    let hlen: number;
    let len: number;
    if (isLength32VR(vr)) {
      if (off + 12 > end) throw new DeflateError('bad-meta', 'truncated long-form header');
      hlen = 12;
      len = view.getUint32(off + 8, true);
    } else {
      hlen = 8;
      len = view.getUint16(off + 6, true);
    }
    if (len === 0xffffffff) throw new DeflateError('bad-meta', 'undefined length in file meta');
    const voff = off + hlen;
    if (voff + len > end) throw new DeflateError('bad-meta', 'meta element overruns buffer');
    const element = view.getUint16(off + 2, true);
    if (element === 0x0000 && len === 4) {
      groupLength = view.getUint32(voff, true);
      afterGroupLength = voff + 4;
    } else if (element === 0x0010) {
      let s = '';
      for (let i = 0; i < len; i++) {
        const c = bytes[voff + i]!;
        if (c !== 0) s += String.fromCharCode(c);
      }
      ts = s.trim();
    }
    off = voff + len;
  }
  if (ts !== TS_DEFLATED) return buffer;
  // Authoritative split: (0002,0000) + its value when sane, else the scan.
  const datasetStart = groupLength != null && afterGroupLength >= 0 &&
    afterGroupLength + groupLength <= end
    ? afterGroupLength + groupLength
    : off;
  if (datasetStart > end) throw new DeflateError('bad-meta', 'dataset start past end');
  // PS3.5 A.5 says zlib (RFC 1950); real writers (pydicom 3.x verified)
  // emit raw deflate (RFC 1951). Try wrapped first, fall back to raw —
  // both shapes decode to identical bytes, and anything else stays loud.
  let inflated: Uint8Array;
  try {
    inflated = unzlibSync(bytes.subarray(datasetStart));
  } catch {
    try {
      inflated = inflateSync(bytes.subarray(datasetStart));
    } catch (e) {
      throw new DeflateError('inflate-failed', e instanceof Error ? e.message : String(e));
    }
  }
  const out = new Uint8Array(datasetStart + inflated.length);
  out.set(bytes.subarray(0, datasetStart), 0);
  out.set(inflated, datasetStart);
  return out.buffer as ArrayBuffer;
}
