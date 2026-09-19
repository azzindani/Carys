// JPEG Lossless (SOF3) frame decoder — ITU-T T.81 Annex H predictor path.
// Own compact marker loop; shares only the bit-reader + Huffman builder in
// jpeg-scan.js (the baseline IDCT/file assembly in jpeg-baseline.js does not
// apply: lossless has no DCT blocks). Scope: single component, predictors
// 1-7, point transform 0, precision 8 (→8-bit) or 9-16 (→16-bit LE).
// Multi-scan, 12... anything else is a named error, stated.

import { JpegError, HuffTree, JpegBitReader, buildHuffmanTable } from './jpeg-scan.js';

export interface DecodedLossless {
  width: number;
  height: number;
  bits: 8 | 16;
  bytes: Uint8Array; // LE pixels (2 bytes/sample when bits === 16)
}

/** T.81 Table H.2 predictors from left/above/above-left neighbours. */
function predict(sel: number, a: number, b: number, c: number): number {
  switch (sel) {
    case 1: return a;
    case 2: return b;
    case 3: return c;
    case 4: return a + b - c;
    case 5: return a + ((b - c) >> 1);
    case 6: return b + ((a - c) >> 1);
    case 7: return (a + b) >> 1;
    default: throw new JpegError('bad-predictor', `selection ${sel}`);
  }
}

export function decodeJpegLossless(jpg: Uint8Array): DecodedLossless {
  let off = 0;
  const u16 = (): number => {
    if (off + 2 > jpg.length) throw new JpegError('truncated', 'marker header');
    const v = ((jpg[off]! << 8) | jpg[off + 1]!);
    off += 2;
    return v;
  };
  const block = (): Uint8Array => {
    const len = u16();
    if (len < 2 || off + len - 2 > jpg.length) throw new JpegError('truncated', 'marker block');
    const b = jpg.subarray(off, off + len - 2);
    off += len - 2;
    return b;
  };
  if (u16() !== 0xffd8) throw new JpegError('no-soi', 'not a JPEG stream');

  const huffDC: (HuffTree | undefined)[] = [];
  let resetInterval = 0;
  let width = 0, height = 0, precision = 0;
  let compId = -1;
  let seenSOF = false;
  let decoded: ScanOut | null = null;

  let marker = u16();
  for (;;) {
    if (marker === 0xffd9) break; // EOI
    switch (marker) {
      case 0xffe0: case 0xffe1: case 0xffe2: case 0xffe3:
      case 0xffe4: case 0xffe5: case 0xffe6: case 0xffe7:
      case 0xffe8: case 0xffe9: case 0xffea: case 0xffeb:
      case 0xffec: case 0xffed: case 0xffee: case 0xffef:
      case 0xfffe:
        block(); // APPn + COM skipped
        break;
      case 0xffdb:
        block(); // DQT never used by lossless; tolerated
        break;
      case 0xffc3: {
        if (seenSOF) throw new JpegError('multi-frame', 'only single-frame JPEGs');
        const b = block();
        if (b.length < 6) throw new JpegError('truncated', 'SOF3');
        precision = b[0]!;
        if (precision < 8 || precision > 16) throw new JpegError('bad-precision', `${precision}-bit`);
        height = ((b[1]! << 8) | b[2]!);
        width = ((b[3]! << 8) | b[4]!);
        if (width === 0 || height === 0) throw new JpegError('bad-frame', `${width}x${height}`);
        if (b[5] !== 1) throw new JpegError('bad-components', `${b[5]} (lossless is single-component here)`);
        if (b.length < 9) throw new JpegError('truncated', 'SOF3 component');
        const h = b[7]! >> 4;
        const v = b[7]! & 15;
        if (h !== 1 || v !== 1) throw new JpegError('bad-sampling', `${h}x${v}`);
        compId = b[6]!;
        seenSOF = true;
        break;
      }
      case 0xffc0: case 0xffc1: case 0xffc2:
      case 0xffc5: case 0xffc6: case 0xffc7:
      case 0xffc9: case 0xffcb: case 0xffcd: case 0xffcf:
        throw new JpegError('not-lossless', `SOF marker FF${marker.toString(16)} in lossless path`);
      case 0xffc4: {
        const b = block();
        let p = 0;
        while (p < b.length) {
          const spec = b[p++]!;
          const lens = b.subarray(p, p + 16);
          if (lens.length < 16) throw new JpegError('truncated', 'DHT');
          p += 16;
          let sum = 0;
          for (const l of lens) sum += l;
          if (p + sum > b.length) throw new JpegError('truncated', 'DHT values');
          const table = buildHuffmanTable(lens, b.subarray(p, p + sum));
          p += sum;
          if ((spec >> 4) === 0) huffDC[spec & 15] = table;
          // AC nibble unused by lossless scans; ignored, not rejected
        }
        break;
      }
      case 0xffdd: {
        const b = block();
        if (b.length < 2) throw new JpegError('truncated', 'DRI');
        resetInterval = ((b[0]! << 8) | b[1]!);
        break;
      }
      case 0xffda: {
        if (!seenSOF) throw new JpegError('sos-before-sof', 'scan without frame');
        if (decoded) throw new JpegError('multi-scan', 'one scan per lossless frame here');
        const b = block();
        if (b.length < 6 || b[0] !== 1) throw new JpegError('bad-scan', 'lossless scans select one component');
        if (b[1] !== compId) throw new JpegError('bad-scan', `component ${b[1]} ≠ SOF ${compId}`);
        const dc = huffDC[b[2]! >> 4];
        if (!dc) throw new JpegError('missing-table', `Huffman DC ${(b[2]! >> 4).toString(16)}`);
        const predictor = b[3]!;
        if (predictor < 1 || predictor > 7) throw new JpegError('bad-predictor', `selection ${predictor}`);
        if (b[4] !== 0) throw new JpegError('bad-scan', `Se=${b[4]} (must be 0)`);
        if ((b[5]! & 15) !== 0) throw new JpegError('point-transform', `Pt=${b[5]! & 15}`);
        if (resetInterval !== 0) {
          // Restart semantics for lossless prediction are encoder-defined
          // (T.81 leaves the reset state implementation-specific); guessing
          // wrong silently corrupts. DRI+lossless is vanishingly rare — loud.
          throw new JpegError('restart-unsupported', `DRI=${resetInterval}`);
        }
        decoded = decodeLosslessScan(jpg, off, dc, predictor, precision, width, height);
        off += decoded.consumed;
        break;
      }
      default:
        if (off >= 3 && jpg[off - 3] === 0xff && jpg[off - 2]! >= 0xc0 && jpg[off - 2]! <= 0xfe) {
          // reference fallback: previous block ate the marker's FF byte
          off -= 3;
          break;
        }
        throw new JpegError('bad-marker', `FF${marker.toString(16)}`);
    }
    marker = u16();
  }
  if (!decoded) throw new JpegError('no-frame', 'no lossless scan before EOI');
  return decoded;
}

interface ScanOut extends DecodedLossless {
  consumed: number;
}

function decodeLosslessScan(
  data: Uint8Array,
  offset: number,
  tableDC: HuffTree,
  predictor: number,
  precision: number,
  width: number,
  height: number,
): ScanOut {
  const startOffset = offset;
  const br = new JpegBitReader(data, offset);
  const mask = precision >= 16 ? 0xffff : (1 << precision) - 1;
  const bits: 8 | 16 = precision <= 8 ? 8 : 16;
  const out = new Uint8Array(width * height * (bits === 16 ? 2 : 1));
  const put = (i: number, v: number): void => {
    if (bits === 16) {
      out[i * 2] = v & 0xff;
      out[i * 2 + 1] = (v >> 8) & 0xff;
    } else {
      out[i] = v;
    }
  };
  const row = new Uint16Array(width);
  let prevRow = new Uint16Array(width); // all-zero top edge; only (0,0) is special-cased
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let p: number;
      if (x === 0 && y === 0) p = 1 << (precision - 1);
      else if (y === 0) p = row[x - 1]!;
      else if (x === 0) p = prevRow[0]!;
      else p = predict(predictor, row[x - 1]!, prevRow[x]!, prevRow[x - 1]!);
      const ssss = br.decodeHuffman(tableDC);
      const diff = ssss === 0 ? 0 : br.receiveAndExtend(ssss);
      const v = (p + diff) & 0xffff & mask;
      row[x] = v;
      put(y * width + x, v);
    }
    prevRow = row.slice();
  }
  br.align();
  return { width, height, bits, bytes: out, consumed: br.offset - startOffset };
}
