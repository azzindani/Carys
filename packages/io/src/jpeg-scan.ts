// JPEG baseline scan decoder — Huffman + MCU walk ported from Daikon
// lib/jpeg-baseline.js (Apache-2.0, pdf.js JpegImage lineage), trimmed to
// sequential baseline: progressive DC/AC refinement passes are dropped (SOF2
// is rejected at parse). Throws JpegError (named) instead of raw strings.

export class JpegError extends Error {
  constructor(public kind: string, detail: string) {
    super(`JPEG ${kind}: ${detail}`);
  }
}

export interface HuffTree extends Array<HuffTree | number> {}

/** Canonical-code Huffman tree builder (reference algorithm, typed). */
export function buildHuffmanTable(codeLengths: Uint8Array, values: Uint8Array): HuffTree {
  let length = 16;
  while (length > 0 && !codeLengths[length - 1]) length--;
  interface Frame { tree: HuffTree; index: number }
  const code: Frame[] = [{ tree: [], index: 0 }];
  let k = 0;
  let p = code[0]!;
  for (let i = 0; i < length; i++) {
    for (let j = 0; j < codeLengths[i]!; j++) {
      p = code.pop()!;
      p.tree[p.index] = values[k]!;
      while (p.index > 0) p = code.pop()!;
      p.index++;
      code.push(p);
      while (code.length <= i) {
        const child: HuffTree = [];
        p.tree[p.index] = child;
        p = { tree: child, index: 0 };
        code.push(p);
      }
      k++;
    }
    if (i + 1 < length) {
      const child: HuffTree = [];
      p.tree[p.index] = child;
      p = { tree: child, index: 0 };
      code.push(p);
    }
  }
  return code[0]!.tree;
}

export const ZIGZAG = new Int32Array([
  0,
  1, 8,
  16, 9, 2,
  3, 10, 17, 24,
  32, 25, 18, 11, 4,
  5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6,
  7, 14, 21, 28, 35, 42, 49, 56,
  57, 50, 43, 36, 29, 22, 15,
  23, 30, 37, 44, 51, 58,
  59, 52, 45, 38, 31,
  39, 46, 53, 60,
  61, 54, 47,
  55, 62,
  63,
]);

export interface ScanComponent {
  h: number;
  v: number;
  blocksPerLine: number;
  blocksPerColumn: number;
  blockData: Int16Array;
  huffmanTableDC: HuffTree;
  huffmanTableAC: HuffTree;
  pred: number;
}

export interface ScanFrame {
  mcusPerLine: number;
  mcusPerColumn: number;
  maxH: number;
  maxV: number;
}

/**
 * Shared scan bit-reader: byte-stuffing aware, throws JpegError instead of
 * returning null at EOF (loud > silent). Extracted from the baseline path;
 * the lossless decoder reuses it.
 */
export class JpegBitReader {
  bitsData = 0;
  bitsCount = 0;
  constructor(public data: Uint8Array, public offset: number) {}

  readBit(): number {
    if (this.bitsCount > 0) {
      this.bitsCount--;
      return (this.bitsData >> this.bitsCount) & 1;
    }
    if (this.offset >= this.data.length) throw new JpegError('truncated', 'scan overruns buffer');
    this.bitsData = this.data[this.offset++]!;
    if (this.bitsData === 0xff) {
      if (this.offset >= this.data.length) throw new JpegError('truncated', 'marker overruns buffer');
      const next = this.data[this.offset++]!;
      if (next !== 0) throw new JpegError('bad-marker', `FF${next.toString(16)} in scan`);
    }
    this.bitsCount = 7;
    return this.bitsData >>> 7;
  }

  decodeHuffman(tree: HuffTree): number {
    let node: HuffTree | number = tree;
    for (;;) {
      const bit = this.readBit();
      const next: HuffTree | number | undefined =
        typeof node === 'number' ? undefined : node[bit];
      if (typeof next === 'number') return next;
      if (typeof next !== 'object') throw new JpegError('bad-huffman', 'invalid sequence');
      node = next;
    }
  }

  receive(length: number): number {
    let n = 0;
    for (let i = 0; i < length; i++) n = (n << 1) | this.readBit();
    return n;
  }

  receiveAndExtend(length: number): number {
    const n = this.receive(length);
    if (length === 0 || n >= 1 << (length - 1)) return n;
    return n + (-1 << length) + 1;
  }

  /** Drop buffered bits so the offset points at the next marker. */
  align(): void {
    this.bitsCount = 0;
  }
}

function blockOffset(c: ScanComponent, row: number, col: number): number {
  // NOTE the +1 stride quirk from the reference: buffer rows are
  // (blocksPerLine+1) wide and the allocator sizes for it. Keep in sync.
  return 64 * ((c.blocksPerLine + 1) * row + col);
}

/**
 * Decode one baseline scan. Returns bytes consumed from `data` at `offset`.
 * RSTx markers + restart intervals honored; DNL/other markers end the scan.
 */
export function decodeBaselineScan(
  data: Uint8Array,
  offset: number,
  frame: ScanFrame,
  components: ScanComponent[],
  resetInterval: number,
): number {
  const startOffset = offset;
  const br = new JpegBitReader(data, offset);
  const decodeHuffman = (tree: HuffTree): number => br.decodeHuffman(tree);
  const receiveAndExtend = (length: number): number => br.receiveAndExtend(length);
  const decodeBaseline = (c: ScanComponent, off: number): void => {
    const t = decodeHuffman(c.huffmanTableDC);
    const diff = t === 0 ? 0 : receiveAndExtend(t);
    c.blockData[off] = (c.pred += diff);
    let k = 1;
    while (k < 64) {
      const rs = decodeHuffman(c.huffmanTableAC);
      const s = rs & 15;
      const r = rs >> 4;
      if (s === 0) {
        if (r < 15) break;
        k += 16;
        continue;
      }
      k += r;
      if (k >= 64) throw new JpegError('bad-block', 'run past EOB');
      c.blockData[off + ZIGZAG[k]!] = receiveAndExtend(s);
      k++;
    }
  };
  const decodeMcu = (c: ScanComponent, mcu: number, row: number, col: number): void => {
    const mcuRow = (mcu / frame.mcusPerLine) | 0;
    const mcuCol = mcu % frame.mcusPerLine;
    decodeBaseline(c, blockOffset(c, mcuRow * c.v + row, mcuCol * c.h + col));
  };
  const decodeBlock = (c: ScanComponent, mcu: number): void => {
    const blockRow = (mcu / c.blocksPerLine) | 0;
    decodeBaseline(c, blockOffset(c, blockRow, mcu % c.blocksPerLine));
  };

  const nComp = components.length;
  const mcuExpected = nComp === 1
    ? components[0]!.blocksPerLine * components[0]!.blocksPerColumn
    : frame.mcusPerLine * frame.mcusPerColumn;
  if (!resetInterval) resetInterval = mcuExpected;

  let mcu = 0;
  while (mcu < mcuExpected) {
    for (const c of components) c.pred = 0;
    if (nComp === 1) {
      const c = components[0]!;
      for (let n = 0; n < resetInterval && mcu < mcuExpected; n++) decodeBlock(c, mcu++);
    } else {
      for (let n = 0; n < resetInterval && mcu < mcuExpected; n++) {
        for (const c of components) {
          for (let j = 0; j < c.v; j++) {
            for (let k = 0; k < c.h; k++) decodeMcu(c, mcu, j, k);
          }
        }
        mcu++;
      }
    }
    br.align();
    offset = br.offset;
    if (offset + 1 >= data.length) break;
    const marker = ((data[offset]! << 8) | data[offset + 1]!);
    if (marker < 0xff00) throw new JpegError('marker-missing', 'scan end without marker');
    if (marker >= 0xffd0 && marker <= 0xffd7) {
      offset += 2;
      br.offset = offset;
    } else break;
  }
  return br.offset - startOffset;
}
