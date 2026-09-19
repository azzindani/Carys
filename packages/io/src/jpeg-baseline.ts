// JPEG Baseline DCT (SOF0, 8-bit) frame decoder — marker/frame/IDCT stages
// ported from Daikon lib/jpeg-baseline.js (Apache-2.0, pdf.js JpegImage
// lineage), trimmed: single scan, no Adobe/CMYK paths, output is grayscale
// (1 comp direct; 3 comp YCbCr→RGB→Rec.601 luma). Scan bits in jpeg-scan.js.

import {
  JpegError, HuffTree, ScanComponent, buildHuffmanTable,
  decodeBaselineScan, ZIGZAG,
} from './jpeg-scan.js';

// Loeffler/Ligtenberg/Moschytz scaled-integer IDCT constants (reference).
const COS1 = 4017, SIN1 = 799, COS3 = 3406, SIN3 = 2276;
const COS6 = 1567, SIN6 = 3784, SQRT2 = 5793, SQRT1D2 = 2896;

interface FrameComp extends ScanComponent {
  quantizationTable: Int32Array;
  bitConversion: number;
  scaleX: number;
  scaleY: number;
}

/** Dequantize + AAN IDCT one 8x8 block into blockData (reference port). */
function inverseBlock(c: FrameComp, off: number, p: Int32Array): void {
  const qt = c.quantizationTable;
  const bd = c.blockData;
  let v0, v1, v2, v3, v4, v5, v6, v7, t, i;
  for (i = 0; i < 64; i++) p[i] = bd[off + i]! * qt[i]!;
  for (i = 0; i < 8; ++i) {
    const row = 8 * i;
    if (p[1 + row] === 0 && p[2 + row] === 0 && p[3 + row] === 0 &&
        p[4 + row] === 0 && p[5 + row] === 0 && p[6 + row] === 0 &&
        p[7 + row] === 0) {
      t = (SQRT2 * p[row]! + 512) >> 10;
      for (let k = 0; k < 8; k++) p[row + k] = t;
      continue;
    }
    v0 = (SQRT2 * p[row]! + 128) >> 8;
    v1 = (SQRT2 * p[4 + row]! + 128) >> 8;
    v2 = p[2 + row]!;
    v3 = p[6 + row]!;
    v4 = (SQRT1D2 * (p[1 + row]! - p[7 + row]!) + 128) >> 8;
    v7 = (SQRT1D2 * (p[1 + row]! + p[7 + row]!) + 128) >> 8;
    v5 = p[3 + row]! << 4;
    v6 = p[5 + row]! << 4;
    t = (v0 - v1 + 1) >> 1; v0 = (v0 + v1 + 1) >> 1; v1 = t;
    t = (v2 * SIN6 + v3 * COS6 + 128) >> 8;
    v2 = (v2 * COS6 - v3 * SIN6 + 128) >> 8; v3 = t;
    t = (v4 - v6 + 1) >> 1; v4 = (v4 + v6 + 1) >> 1; v6 = t;
    t = (v7 + v5 + 1) >> 1; v5 = (v7 - v5 + 1) >> 1; v7 = t;
    t = (v0 - v3 + 1) >> 1; v0 = (v0 + v3 + 1) >> 1; v3 = t;
    t = (v1 - v2 + 1) >> 1; v1 = (v1 + v2 + 1) >> 1; v2 = t;
    t = (v4 * SIN3 + v7 * COS3 + 2048) >> 12;
    v4 = (v4 * COS3 - v7 * SIN3 + 2048) >> 12; v7 = t;
    t = (v5 * SIN1 + v6 * COS1 + 2048) >> 12;
    v5 = (v5 * COS1 - v6 * SIN1 + 2048) >> 12; v6 = t;
    p[row] = v0 + v7; p[7 + row] = v0 - v7;
    p[1 + row] = v1 + v6; p[6 + row] = v1 - v6;
    p[2 + row] = v2 + v5; p[5 + row] = v2 - v5;
    p[3 + row] = v3 + v4; p[4 + row] = v3 - v4;
  }
  for (i = 0; i < 8; ++i) {
    const col = i;
    if (p[8 + col] === 0 && p[16 + col] === 0 && p[24 + col] === 0 &&
        p[32 + col] === 0 && p[40 + col] === 0 && p[48 + col] === 0 &&
        p[56 + col] === 0) {
      t = (SQRT2 * p[col]! + 8192) >> 14;
      for (let k = 0; k < 8; k++) p[k * 8 + col] = t;
      continue;
    }
    v0 = (SQRT2 * p[col]! + 2048) >> 12;
    v1 = (SQRT2 * p[32 + col]! + 2048) >> 12;
    v2 = p[16 + col]!;
    v3 = p[48 + col]!;
    v4 = (SQRT1D2 * (p[8 + col]! - p[56 + col]!) + 2048) >> 12;
    v7 = (SQRT1D2 * (p[8 + col]! + p[56 + col]!) + 2048) >> 12;
    v5 = p[24 + col]!;
    v6 = p[40 + col]!;
    t = (v0 - v1 + 1) >> 1; v0 = (v0 + v1 + 1) >> 1; v1 = t;
    t = (v2 * SIN6 + v3 * COS6 + 2048) >> 12;
    v2 = (v2 * COS6 - v3 * SIN6 + 2048) >> 12; v3 = t;
    t = (v4 - v6 + 1) >> 1; v4 = (v4 + v6 + 1) >> 1; v6 = t;
    t = (v7 + v5 + 1) >> 1; v5 = (v7 - v5 + 1) >> 1; v7 = t;
    t = (v0 - v3 + 1) >> 1; v0 = (v0 + v3 + 1) >> 1; v3 = t;
    t = (v1 - v2 + 1) >> 1; v1 = (v1 + v2 + 1) >> 1; v2 = t;
    t = (v4 * SIN3 + v7 * COS3 + 2048) >> 12;
    v4 = (v4 * COS3 - v7 * SIN3 + 2048) >> 12; v7 = t;
    t = (v5 * SIN1 + v6 * COS1 + 2048) >> 12;
    v5 = (v5 * COS1 - v6 * SIN1 + 2048) >> 12; v6 = t;
    p[col] = v0 + v7; p[56 + col] = v0 - v7;
    p[8 + col] = v1 + v6; p[48 + col] = v1 - v6;
    p[16 + col] = v2 + v5; p[40 + col] = v2 - v5;
    p[24 + col] = v3 + v4; p[32 + col] = v3 - v4;
  }
  // level-shift to 8-bit (reference scaling; bitConversion folds precision)
  for (i = 0; i < 64; ++i) {
    const q = p[i]!;
    const bc = c.bitConversion;
    bd[off + i] = q <= -2056 / bc ? 0
      : q >= 2024 / bc ? Math.round(255 / bc)
      : (q + 2056 / bc) >> 4;
  }
}

function blockOffset(blocksPerLine: number, row: number, col: number): number {
  return 64 * ((blocksPerLine + 1) * row + col);
}

/** Nearest-sampled full-resolution plane for one component. */
function componentPlane(
  c: FrameComp, width: number, height: number,
): Uint8Array {
  const tmp = new Int32Array(64);
  for (let r = 0; r < c.blocksPerColumn; r++) {
    for (let col = 0; col < c.blocksPerLine; col++) {
      inverseBlock(c, blockOffset(c.blocksPerLine, r, col), tmp);
    }
  }
  const stride = c.blocksPerLine << 3;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(c.blocksPerColumn * 8 - 1, (y * c.scaleY) | 0);
    const brow = (sy >> 3) * (c.blocksPerLine + 1);
    for (let x = 0; x < width; x++) {
      const sx = Math.min(stride - 1, (x * c.scaleX) | 0);
      out[y * width + x] = c.blockData[(brow + (sx >> 3)) * 64 + ((sy & 7) << 3) + (sx & 7)]!;
    }
  }
  return out;
}

const clamp8 = (a: number): number => (a <= 0 ? 0 : a >= 255 ? 255 : a | 0);

export interface DecodedJpeg {
  width: number;
  height: number;
  /** 1 (mono) or 3 (YCbCr folded to luma); SOF rejects anything else. */
  components: number;
  gray: Uint8Array;
}

/**
 * Decode one baseline JPEG frame to grayscale. Accepts SOF0 (+SOF1 extended
 * DCT, same decoder); rejects SOF2 progressive, other SOFs, precision != 8,
 * 2/4-component images. Throws JpegError.
 */
export function decodeJpegBaseline(jpg: Uint8Array): DecodedJpeg {
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

  const quantTables: (Int32Array | undefined)[] = [];
  const huffDC: (HuffTree | undefined)[] = [];
  const huffAC: (HuffTree | undefined)[] = [];
  let resetInterval = 0;
  let frameW = 0, frameH = 0, maxH = 0, maxV = 0;
  let comps: FrameComp[] = [];
  let compIds: number[] = [];
  let seenSOF = false;

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
      case 0xffdb: {
        const b = block();
        let p = 0;
        while (p < b.length) {
          const spec = b[p++]!;
          const tq = new Int32Array(64);
          if ((spec >> 4) === 0) {
            if (p + 64 > b.length) throw new JpegError('truncated', 'DQT-8');
            for (let j = 0; j < 64; j++) tq[ZIGZAG[j]!] = b[p++]!;
          } else if ((spec >> 4) === 1) {
            if (p + 128 > b.length) throw new JpegError('truncated', 'DQT-16');
            for (let j = 0; j < 64; j++) {
              tq[ZIGZAG[j]!] = ((b[p]! << 8) | b[p + 1]!);
              p += 2;
            }
          } else throw new JpegError('bad-dqt', `spec ${spec.toString(16)}`);
          quantTables[spec & 15] = tq;
        }
        break;
      }
      case 0xffc0:
      case 0xffc1: {
        if (seenSOF) throw new JpegError('multi-frame', 'only single-frame JPEGs');
        const b = block();
        if (b.length < 6) throw new JpegError('truncated', 'SOF');
        const precision = b[0]!;
        if (precision !== 8) throw new JpegError('bad-precision', `${precision}-bit`);
        frameH = ((b[1]! << 8) | b[2]!);
        frameW = ((b[3]! << 8) | b[4]!);
        const n = b[5]!;
        if (n !== 1 && n !== 3) throw new JpegError('bad-components', `${n}`);
        if (b.length < 6 + n * 3) throw new JpegError('truncated', 'SOF components');
        maxH = 0; maxV = 0;
        compIds = [];
        const hv: number[] = [];
        const qids: number[] = [];
        for (let i = 0; i < n; i++) {
          compIds.push(b[6 + i * 3]!);
          hv.push(b[7 + i * 3]!);
          qids.push(b[8 + i * 3]!);
          maxH = Math.max(maxH, b[7 + i * 3]! >> 4);
          maxV = Math.max(maxV, b[7 + i * 3]! & 15);
        }
        const mcusPerLine = Math.ceil(frameW / 8 / maxH);
        const mcusPerColumn = Math.ceil(frameH / 8 / maxV);
        comps = hv.map((hvByte, i) => {
          const h = hvByte >> 4;
          const v = hvByte & 15;
          const bpl = Math.ceil(Math.ceil(frameW / 8) * h / maxH);
          const bpc = Math.ceil(Math.ceil(frameH / 8) * v / maxV);
          const size = 64 * (mcusPerColumn * v) * (mcusPerLine * h + 1);
          const qt = quantTables[qids[i]!];
          if (!qt) throw new JpegError('missing-table', `DQT ${qids[i]}`);
          return {
            h, v, blocksPerLine: bpl, blocksPerColumn: bpc,
            blockData: new Int16Array(size),
            huffmanTableDC: undefined as unknown as HuffTree,
            huffmanTableAC: undefined as unknown as HuffTree,
            pred: 0, quantizationTable: qt, bitConversion: 255 / ((1 << precision) - 1),
            scaleX: h / maxH, scaleY: v / maxV,
          };
        });
        seenSOF = true;
        break;
      }
      case 0xffc2:
        throw new JpegError('progressive', 'SOF2 needs a progressive decoder');
      case 0xffc3: case 0xffc5: case 0xffc6: case 0xffc7:
      case 0xffc9: case 0xffcb: case 0xffcd: case 0xffcf:
        throw new JpegError('unsupported-sof', `marker FF${marker.toString(16)}`);
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
          else huffAC[spec & 15] = table;
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
        const b = block();
        const nsel = b[0]!;
        if (b.length < 1 + nsel * 2 + 3) throw new JpegError('truncated', 'SOS');
        const scan: ScanComponent[] = [];
        for (let i = 0; i < nsel; i++) {
          const idx = compIds.indexOf(b[1 + i * 2]!);
          if (idx < 0) throw new JpegError('bad-scan', `unknown component ${b[1 + i * 2]}`);
          const c = comps[idx]!;
          const spec = b[2 + i * 2]!;
          const dc = huffDC[spec >> 4];
          const ac = huffAC[spec & 15];
          if (!dc || !ac) throw new JpegError('missing-table', `Huffman ${spec.toString(16)}`);
          c.huffmanTableDC = dc;
          c.huffmanTableAC = ac;
          scan.push(c);
        }
        const mcusPerLine = Math.ceil(frameW / 8 / maxH);
        const mcusPerColumn = Math.ceil(frameH / 8 / maxV);
        const consumed = decodeBaselineScan(
          jpg, off,
          { mcusPerLine, mcusPerColumn, maxH, maxV },
          scan, resetInterval,
        );
        off += consumed;
        break;
      }
      default:
        throw new JpegError('bad-marker', `FF${marker.toString(16)}`);
    }
    marker = u16();
  }
  if (!seenSOF) throw new JpegError('no-frame', 'no SOF before EOI');

  const planes = comps.map((c) => componentPlane(c, frameW, frameH));
  let gray: Uint8Array;
  if (planes.length === 1) {
    gray = planes[0]!;
  } else {
    const [Y, Cb, Cr] = planes as [Uint8Array, Uint8Array, Uint8Array];
    gray = new Uint8Array(frameW * frameH);
    for (let i = 0; i < gray.length; i++) {
      const y = Y[i]!, cb = Cb[i]!, cr = Cr[i]!;
      const r = clamp8(y - 179.456 + 1.402 * cr);
      const g = clamp8(y + 135.459 - 0.344 * cb - 0.714 * cr);
      const bl = clamp8(y - 226.816 + 1.772 * cb);
      gray[i] = ((0.299 * r + 0.587 * g + 0.114 * bl) | 0);
    }
  }
  return { width: frameW, height: frameH, components: comps.length, gray };
}
