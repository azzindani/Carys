// DICOM RLE Lossless frame decoder — ported from Daikon src/rle.js (MIT),
// shape trimmed for samplesPerPixel=1 (8-bit: 1 segment, 16-bit: 2 segments).
// Header: u32 LE segment count + count u32 LE absolute segment offsets inside
// a 64-byte header; each segment is PackBits rows for one byte-plane. Daikon's
// console.warn paths are named errors here.

export class RleError extends Error {
  constructor(public kind: string, detail: string) {
    super(`RLE ${kind}: ${detail}`);
  }
}

/**
 * Decode one RLE frame to raw LE pixel bytes.
 * @param frame frame bytes (BOT item excluded, fragments concatenated)
 * @param numPixels rows*cols of the frame
 * @param bytesPerPixel 1 (8-bit) or 2 (16-bit)
 */
export function decodeRLEFrame(
  frame: Uint8Array,
  numPixels: number,
  bytesPerPixel: 1 | 2,
): Uint8Array {
  if (frame.length < 64) throw new RleError('short-header', `length ${frame.length}`);
  const dv = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const numSegments = dv.getUint32(0, true);
  if (numSegments !== bytesPerPixel) {
    throw new RleError('segment-count', `expected ${bytesPerPixel}, got ${numSegments}`);
  }
  const offsets: number[] = [];
  for (let i = 0; i < numSegments; i++) offsets.push(dv.getUint32(4 + i * 4, true));
  for (let i = 0; i < numSegments; i++) {
    const o = offsets[i]!;
    if (o < 64 || o > frame.length || (i > 0 && o < offsets[i - 1]!)) {
      throw new RleError('bad-offset', `segment ${i} at ${o}`);
    }
  }
  // PackBits-decode each segment into its byte-plane.
  const planes = new Uint8Array(numSegments * numPixels);
  for (let s = 0; s < numSegments; s++) {
    let rp = offsets[s]!;
    let wp = s * numPixels;
    const wend = wp + numPixels;
    for (;;) {
      if (wp >= wend) break;
      if (rp >= frame.length) throw new RleError('truncated', `segment ${s}`);
      const code = frame[rp++]! >= 128 ? frame[rp - 1]! - 256 : frame[rp - 1]!;
      if (code >= 0 && code < 128) {
        const len = code + 1;
        if (rp + len > frame.length || wp + len > wend) {
          throw new RleError('literal-overrun', `segment ${s}`);
        }
        planes.set(frame.subarray(rp, rp + len), wp);
        rp += len;
        wp += len;
      } else if (code <= -1 && code > -128) {
        const len = 1 - code;
        if (rp >= frame.length || wp + len > wend) {
          throw new RleError('run-overrun', `segment ${s}`);
        }
        planes.fill(frame[rp++]!, wp, wp + len);
        wp += len;
      } else {
        throw new RleError('bad-code', `NOP -128 in segment ${s}`);
      }
    }
  }
  if (numSegments === 1) return planes;
  // 16-bit: plane 0 = MSB, plane 1 = LSB → LE bytes (Daikon processData).
  const out = new Uint8Array(numPixels * 2);
  for (let i = 0; i < numPixels; i++) {
    out[i * 2] = planes[numPixels + i]!;
    out[i * 2 + 1] = planes[i]!;
  }
  return out;
}
