// JPEG-LS frame decoder (ITU-T T.87 / ISO 14495-1, regular mode only).
// Own compact marker loop; shares only buildHuffmanTable in jpeg-scan.js
// for the (unused-by-CharLS) DHT tolerance path. Bit-exact against the
// CharLS reference encoder (imagecodecs), verified by round-trip tests.
//
// CharLS ground truths baked in (NOT the textbook simplifications):
// - run trigger is qs==0 (all quantized gradients zero), not Ra==Rb
// - context index is |qs| = |(Q1*9+Q2)*9+Q3| (365 contexts, sign folds)
// - error map: even MErrval -> E>=0 (m>>1), odd -> E<0 (-((m+1)>>1)),
//   then E' = apply_sign(E, sign) and Rx = correct(Px + apply_sign(C,sign), E')
// - Golomb LIMIT = 2*(bpp+max(8,bpp)) (32 at 8-bit); escape reads qbpp+1
// - k==0 symbols XOR bit_wise_sign(2*B+N-1) into the error value
// - B/C carry rule (A.13) with C clamped to [-128,127], applied ALWAYS
// Scope: SOF55, single component, 8/16-bit, NEAR=0 lossless only,
// ILV 0/1 accepted at parse (single-component => moot). Multi-component,
// NEAR>0, mapping tables, and restart intervals stay named errors.

import { JpegError, type HuffTree } from './jpeg-scan.js';

export interface DecodedJpegLs {
  width: number;
  height: number;
  bits: 8 | 16;
  bytes: Uint8Array; // LE pixels (2 bytes/sample when bits === 16)
  near: number; // always 0 here (lossless); kept so callers can assert it
}

/**
 * MSB-first bit reader WITH T.87 A.1 byte-stuffing handling: after an
 * 0xFF data byte the encoder inserts a single 0 stuff bit (CharLS
 * fill_read_cache decrements valid_bits after every FF byte), so the
 * next bit read must skip exactly one bit. Without this, any stream
 * whose scan contains 0xFF (e.g. smooth ramps) desynchronizes from the
 * first stuffed byte on — usually surfacing as a scan overrun much
 * later. Stuffed 0 bits are NOT data; a real FFD9 marker ends the scan
 * before the reader (the SOS consumer stops there).
 */
class LsBitReader {
  bitsData = 0;
  bitsCount = 0;
  afterFF = false;
  constructor(public data: Uint8Array, public offset: number) {}

  readBit(): number {
    if (this.bitsCount > 0) {
      this.bitsCount--;
      return (this.bitsData >> this.bitsCount) & 1;
    }
    if (this.offset >= this.data.length) throw new JpegError('truncated', 'scan overruns buffer');
    const b = this.data[this.offset++]!;
    if (this.afterFF) {
      // T.87 A.1: the MSB of the byte following 0xFF is the stuffed 0
      // bit — drop it, the remaining 7 bits are data. Keep the byte
      // unshifted with the normal counter convention (head = bit6,
      // 6 remaining): shifting instead would invent a garbage zero bit
      // at the LSB and eat a real data bit a byte later.
      this.afterFF = false;
      if ((b & 0x80) !== 0) throw new JpegError('bad-stuffing', 'stuffed bit is not zero');
      this.bitsData = b & 0x7f;
      this.bitsCount = 6;
      return (this.bitsData >>> 6) & 1;
    }
    this.bitsData = b;
    if (b === 0xff) this.afterFF = true;
    this.bitsCount = 7;
    return this.bitsData >>> 7;
  }

  receive(length: number): number {
    let n = 0;
    for (let i = 0; i < length; i++) n = (n << 1) | this.readBit();
    return n;
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
}

/**
 * CharLS compute_default (Table C.3 BASIC_T1/T2/T3 = 3/7/21, scaled):
 * 8-bit gives (3,7,21) — NOT the Table-A.5 row the textbooks quote.
 * Verified bit-exact against the reference encoder (T=(2,7,12) provably
 * fails round-trip: px(2,0) of the ramp4 fixture cannot decode).
 */
export function defaultThresholds(maxval: number, near = 0): [number, number, number] {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
  if (maxval >= 128) {
    const factor = Math.floor((Math.min(maxval, 4095) + 128) / 256);
    const t1 = clamp(factor * (3 - 2) + 2 + 3 * near, near + 1, maxval);
    const t2 = clamp(factor * (7 - 3) + 3 + 5 * near, t1, maxval);
    const t3 = clamp(factor * (21 - 4) + 4 + 7 * near, t2, maxval);
    return [t1, t2, t3];
  }
  const factor = Math.floor(256 / (maxval + 1));
  const t1 = clamp(Math.max(2, Math.floor(3 / factor) + 3 * near), near + 1, maxval);
  const t2 = clamp(Math.max(3, Math.floor(7 / factor) + 5 * near), t1, maxval);
  const t3 = clamp(Math.max(4, Math.floor(21 / factor) + 7 * near), t2, maxval);
  return [t1, t2, t3];
}

/** T.87 A.3.3 gradient quantization (NEAR=0), verbatim from CharLS
 *  quantize_gradient_org: `<=` on the negative rungs, strict `<` on the
 *  positive rungs (the asymmetry is real — checked against source). */
export function quantizeGradient(d: number, t1: number, t2: number, t3: number): number {
  if (d <= -t3) return -4;
  if (d <= -t2) return -3;
  if (d <= -t1) return -2;
  if (d < 0) return -1;
  if (d === 0) return 0;
  if (d < t1) return 1;
  if (d < t2) return 2;
  if (d < t3) return 3;
  return 4;
}

/**
 * T.87 signed context id: qs = (Q1*9+Q2)*9+Q3 (-364..364). Run mode
 * triggers on qs==0 (all gradients zero). Regular contexts index by
 * |qs| (sign folds via apply_sign_for_index); sign = qs<0 ? -1 : 0.
 */
export function contextId(q1: number, q2: number, q3: number): number {
  return (q1 * 9 + q2) * 9 + q3;
}

/** apply_sign(i, sign) with sign in {0, -1}: identity or negate. */
export function applySign(i: number, sign: number): number {
  return sign === 0 ? i : -i;
}

/**
 * CharLS unmap_error_value: even MErrval -> E = m>>1 (>=0),
 * odd -> E = -((m+1)>>1) (<0). NOTE the parity is the OPPOSITE of the
 * textbook guess — verified against the reference encoder.
 */
export function unmapError(mapped: number): number {
  return (mapped & 1) ? -((mapped + 1) >> 1) : mapped >> 1;
}

/** T.87 A.4.1 Golomb variable length: high bits are unary (MSB-first). */
export function golombHighBits(br: LsBitReader, limit: number): number {
  let q = 0;
  while (br.readBit() === 0) {
    q++;
    if (q > limit) throw new JpegError('bad-golomb', `unary run ${q} past limit ${limit}`);
  }
  return q;
}

/**
 * CharLS decode_mapped_error_value: unary q, then Golomb low bits, with
 * the escape (reads MErrval - 1 as raw qbpp bits, then adds one).
 */
export function golombDecode(
  br: LsBitReader, table: HuffTree | null, k: number, limit: number, qbpp: number,
): number {
  const q = golombHighBits(br, limit);
  if (q < limit - qbpp - 1) {
    if (k === 0) return 0;
    return (q << k) | br.receive(k);
  }
  // escape: raw qbpp bits are (MErrval - 1)
  return br.receive(qbpp) + 1;
}

interface LsParams {
  maxval: number;
  t1: number; t2: number; t3: number;
  reset: number;
}

function readLseParams(b: Uint8Array): Partial<LsParams> & { preset: number } {
  // LSE preset (T.87 C.2.4.1.1): [ID, MAXVAL(2B), T1(2B), T2(2B), T3(2B),
  // RESET(2B)] — every field is 2 bytes big-endian (NOT T1/T3-wide +
  // T2-narrow; that misparse silently corrupts 16-bit thresholds).
  const id = b[0]!;
  if (id === 1) {
    if (b.length < 11) throw new JpegError('truncated', 'LSE preset');
    return {
      preset: 1,
      maxval: ((b[1]! << 8) | b[2]!),
      t1: ((b[3]! << 8) | b[4]!),
      t2: ((b[5]! << 8) | b[6]!),
      t3: ((b[7]! << 8) | b[8]!),
      reset: ((b[9]! << 8) | b[10]!),
    };
  }
  if (id >= 2 && id <= 4) {
    // palette / mapping tables: single-component lossless never uses them
    throw new JpegError('mapping-table', `LSE ID ${id} unsupported here`);
  }
  throw new JpegError('bad-lse', `LSE ID ${id}`);
}

export function decodeJpegLs(jpg: Uint8Array): DecodedJpegLs {
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

  // CharLS (imagecodecs) emits a SPIFF directory entry AFTER the SPIFF
  // header: FFE8 len=8 body=00000001, then a SECOND SOI that opens the
  // real SOF55/SOS frame. Tolerate exactly that (any other content after
  // the header stays a loud bad-marker).
  const spiffEntry = [0xff, 0xe8, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0xff, 0xd8];
  if (
    jpg.length >= off + spiffEntry.length &&
    spiffEntry.every((v, i) => jpg[off + i] === v)
  ) {
    off += spiffEntry.length;
  }

  let width = 0, height = 0, precision = 0;
  let params: LsParams = { maxval: 0, t1: 0, t2: 0, t3: 0, reset: 64 };
  let paramsSet = false;
  let scanBytes: Uint8Array | null = null;
  let seenSOF = false;
  let near = 0;

  let marker = u16();
  for (;;) {
    if (marker === 0xffd9) break; // EOI
    switch (marker) {
      case 0xffe0: case 0xffe1: case 0xffe2: case 0xffe3:
      case 0xffe4: case 0xffe5: case 0xffe6: case 0xffe7:
      case 0xffe8: case 0xffe9: case 0xffea: case 0xffeb:
      case 0xffec: case 0xffed: case 0xffee: case 0xffef:
      case 0xfffe:
        block(); // APPn + COM (SPIFF header lives here) skipped
        break;
      case 0xffc4: {
        // CharLS writes an empty DHT in lossless streams; tables only
        // exist for k>1 paths, which we don't take. Tolerate, don't parse.
        block();
        break;
      }
      case 0xfff7: {
        // SOF55: P, Y, X, Nf, then per component (Ci, HiVi, Tqi) —
        // DCT-legacy sampling factors, NOT (Ci, Ti, NEAR). NEAR and ILV
        // live in SOS. HiVi must be 0x11, Tqi 0 (mapping tables unsupported).
        if (seenSOF) throw new JpegError('multi-frame', 'only single-frame JPEG-LS');
        const b = block();
        if (b.length < 6) throw new JpegError('truncated', 'SOF55');
        precision = b[0]!;
        if (precision < 2 || precision > 16) throw new JpegError('bad-precision', `${precision}-bit`);
        height = ((b[1]! << 8) | b[2]!);
        width = ((b[3]! << 8) | b[4]!);
        if (width === 0 || height === 0) throw new JpegError('bad-frame', `${width}x${height}`);
        const nComp = b[5]!;
        if (nComp !== 1) throw new JpegError('bad-components', `${nComp} (single-component only)`);
        if (b.length < 6 + nComp * 3) throw new JpegError('truncated', 'SOF55 components');
        if (b[7]! !== 0x11) throw new JpegError('bad-sampling', `HiVi=${b[7]!.toString(16)} (want 11)`);
        if (b[8]! !== 0) throw new JpegError('mapping-table', `Tqi=${b[8]!} unsupported here`);
        seenSOF = true;
        break;
      }
      case 0xfff8: {
        // LSE preset parameters
        const b = block();
        const p = readLseParams(b);
        if (p.preset === 1) {
          params = {
            maxval: p.maxval!, t1: p.t1!, t2: p.t2!, t3: p.t3!,
            reset: 64,
          };
          paramsSet = true;
        }
        break;
      }
      case 0xffda: {
        if (!seenSOF) throw new JpegError('sos-before-sof', 'scan without frame');
        // SOS: Ns, Cs, Tq, then NEAR, ILV, transformation (T.87 Table C.3
        // as written by CharLS: Ns, Cs, mapping-table-selector, NEAR,
        // ILV, transformation).
        const b = block();
        if (b.length < 6) throw new JpegError('truncated', 'SOS');
        if (b[2]! !== 0) throw new JpegError('mapping-table', `SOS Tq=${b[2]!} unsupported here`);
        near = b[3]!;
        if (near !== 0) throw new JpegError('near-lossless', `NEAR=${near} needs the quantization path`);
        const ilv = b[4]!;
        if (ilv !== 0 && ilv !== 1) throw new JpegError('bad-interleave', `ILV=${ilv}`);
        // scan body runs to EOI (single scan; multi-scan stays an error)
        if (scanBytes !== null) throw new JpegError('multi-scan', 'one scan per frame here');
        // consume to EOI: scan ends at FFD9 (byte-stuffed FF00 excluded)
        let end = off;
        while (end + 1 < jpg.length) {
          if (jpg[end] === 0xff && jpg[end + 1] === 0xd9) break;
          end++;
        }
        if (end + 1 >= jpg.length) throw new JpegError('truncated', 'scan without EOI');
        scanBytes = jpg.subarray(off, end);
        off = end;
        break;
      }
      case 0xffc0: case 0xffc1: case 0xffc2: case 0xffc3:
      case 0xffc5: case 0xffc6: case 0xffc7:
      case 0xffc9: case 0xffcb: case 0xffcd: case 0xffcf:
        throw new JpegError('not-jpegls', `SOF marker FF${marker.toString(16)} in JPEG-LS path`);
      default:
        throw new JpegError('bad-marker', `FF${marker.toString(16)}`);
    }
    marker = u16();
  }
  if (!seenSOF) throw new JpegError('no-frame', 'no SOF55 before EOI');
  if (scanBytes === null) throw new JpegError('no-frame', 'no scan before EOI');

  const range = 1 << precision;
  const maxval = paramsSet ? params.maxval : range - 1;
  if (maxval <= 0 || maxval >= range * 2) throw new JpegError('bad-maxval', `${maxval}`);
  const [t1, t2, t3] = paramsSet ? [params.t1, params.t2, params.t3] : defaultThresholds(maxval);
  const RESET = params.reset;
  const qbpp = Math.ceil(Math.log2(maxval + 1));
  // CharLS LIMIT: 2*(bpp+max(8,bpp)) — 32 at 8-bit, 64 at 16-bit.
  const bpp = precision;
  const limit = 2 * (bpp + Math.max(8, bpp));
  // CharLS k cap: min(k, max(0, ...))? No cap in decoder loop besides the
  // LUT path (k>... falls to slow path, same result). Keep uncapped.

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

  // CharLS state: N[365], A[365] (init max(2,(RANGE+32)/64)), B[365]=0,
  // C[365]=0; run contexts Nn[2] (init 1), A (init max(2,(RANGE+32)/64)).
  // Regular contexts index by |qs| (0..364); run-interruption contexts
  // are separate (RIT 0/1).
  const NN = new Int32Array(365).fill(1);
  const AA = new Int32Array(365);
  const BB = new Int32Array(365);
  const CC = new Int32Array(365);
  const aInit = Math.max(2, Math.floor((maxval + 1 + 32) / 64));
  for (let q = 0; q < 365; q++) AA[q] = aInit;
  // T.87 A.8: Nn[0]=Nn[1]=1? No: run-interruption N init... CharLS
  // run_mode_context(): n_ default 1? a_ = init value. RIT from ctor arg.
  const runN = [1, 1];
  const runA = [aInit, aInit];
  const runNN = [0, 0]; // nn_ counts negative errors; init 0
  let runIndex = 0;
  // T.87 Table A.2 run-length code table (CharLS scan_codec::j).
  const J = [
    0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    4, 4, 5, 5, 6, 6, 7, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  ];
  const br = new LsBitReader(scanBytes, 0);

  /** CharLS compute_golomb_coding_parameter (regular): N<<k < A. */
  const golombK = (q: number): number => {
    let k = 0;
    const n = NN[q]!, a = AA[q]!;
    while ((n << k) < a && k < 32) k++;
    return k;
  };

  /** CharLS run-context k: temp = A + (N>>1)*RIT; N<<k < temp. */
  const runK = (ctx: number): number => {
    const rit = ctx; // context[0] RIT=0, context[1] RIT=1
    const temp = runA[ctx]! + ((runN[ctx]! >> 1) * rit);
    let nTest = runN[ctx]!;
    let k = 0;
    for (; nTest < temp; ++k) {
      nTest <<= 1;
      if (k > 32) throw new JpegError('bad-golomb', 'run k overflow');
    }
    return k;
  };

  /**
   * CharLS compute_error_value (run interruption): the decoder adds the
   * context's run_interruption_type BEFORE unmapping (the encoder's
   * ASSERT closes the loop: decode(encode(E)+RIT) == E). Forgets this
   * and every interruption pixel flips sign.
   */
  const runErrValue = (ctx: number, mapped: number, k: number): number => {
    const temp = mapped + ctx; // +RIT
    const map = temp & 1;
    const abs = (temp + map) / 2;
    if ((k !== 0 || 2 * runNN[ctx]! >= runN[ctx]!) === (map === 1)) return -abs;
    return abs;
  };

  /** CharLS run update_variables: nn++ iff E<0; A += (mapped+1-RIT)>>1. */
  const runUpdate = (ctx: number, err: number, mapped: number): void => {
    if (err < 0) runNN[ctx]++;
    runA[ctx]! += (mapped + 1 - ctx) >> 1;
    if (runN[ctx]! === RESET) {
      runA[ctx]! >>= 1;
      runN[ctx]! >>= 1;
      runNN[ctx]! >>= 1;
    }
    runN[ctx]++;
  };

  /**
   * CharLS run-length decode: while read_bit()==1: index += 1<<J[runindex];
   * increment on full count; then incomplete run reads J[runindex] bits.
   * NOTE the polarity: 1-bits EXTEND the run (opposite of my first guess).
   */
  const decodeRunLen = (rmax: number): number => {
    let index = 0;
    while (br.readBit() === 1) {
      const count = Math.min(1 << J[runIndex]!, rmax - index);
      index += count;
      if (count === 1 << J[runIndex]!) {
        if (runIndex < 31) runIndex++;
      }
      if (index === rmax) break;
    }
    if (index !== rmax) {
      index += J[runIndex]! > 0 ? br.receive(J[runIndex]!) : 0;
    }
    if (index > rmax) throw new JpegError('bad-run', `run ${index} past ${rmax}`);
    return index;
  };

  const traceOn = (globalThis as { __LS_TRACE?: boolean }).__LS_TRACE === true;
  const trace = (...a: unknown[]): void => {
    if (traceOn) console.error('[ls]', ...a);
  };
  const writePx = new Uint16Array(width * height);
  // CharLS line buffers, emulated exactly: two (width+2) arrays used
  // 1-based (pixels at [1..W], sentinels at [0] and [W+1]), swapped each
  // row, with initialize_edge_pixels per row (prev[W+1] = prev[W],
  // cur[0] = prev[1]). The [0] sentinel is NEVER written by decode — it
  // holds a stale value (0 for the first two rows, row y-2's first pixel
  // after), and Rc at x=0 reads exactly that stale sentinel. Hand-rolled
  // edge rules ("Rc = prev[0]") fail from row 2 on; this doesn't.
  let prev = new Uint16Array(width + 2); // zeros
  let cur = new Uint16Array(width + 2); // zeros
  for (let y = 0; y < height; y++) {
    if (y > 0) {
      const t = prev;
      prev = cur;
      cur = t;
    }
    prev[width + 1] = prev[width]!;
    cur[0] = prev[1]!;
    let x = 0;
    while (x < width) {
      const Ra = cur[x]!; // cur is 1-based: cur[x] = left neighbor of pixel x
      const Rb = prev[x + 1]!;
      const Rc = prev[x]!;
      const Rd = prev[x + 2]!;
      const D1 = Rd - Rb, D2 = Rb - Rc, D3 = Rc - Ra;
      const Q1 = quantizeGradient(D1, t1, t2, t3);
      const Q2 = quantizeGradient(D2, t1, t2, t3);
      const Q3 = quantizeGradient(D3, t1, t2, t3);
      const qs = contextId(Q1, Q2, Q3);
      const pos0 = br.offset * 8 - br.bitsCount;
      if (qs !== 0) {
        // regular mode
        const sign = qs < 0 ? -1 : 0; // bit_wise_sign
        const qi = sign === 0 ? qs : -qs; // |qs|
        // T.87 A.2.4 edge-detecting predictor Px
        let px: number;
        if (Rc >= Math.max(Ra, Rb)) px = Math.min(Ra, Rb);
        else if (Rc <= Math.min(Ra, Rb)) px = Math.max(Ra, Rb);
        else px = Ra + Rb - Rc;
        // correct_prediction clamps into [0, MAXVAL]
        const corr = px + (sign === 0 ? CC[qi]! : -CC[qi]!);
        const pxc = corr < 0 ? 0 : corr > maxval ? maxval : corr;
        const k = golombK(qi);
        const pos1 = br.offset * 8 - br.bitsCount;
        const mappedDbg = golombDecode(br, null, k, limit, qbpp);
        let err = unmapError(mappedDbg);
        trace(`REG (${x},${y}) D=(${D1},${D2},${D3}) t=(${t1},${t2},${t3}) nb=(${Ra},${Rb},${Rc},${Rd}) Q=(${Q1},${Q2},${Q3}) qs=${qs} qi=${qi} N=${NN[qi]} A=${AA[qi]} B=${BB[qi]} C=${CC[qi]} k=${k} px=${px} corr=${pxc} mapped=${mappedDbg} E=${err} pos=${pos0}->${pos1}->${br.offset * 8 - br.bitsCount}`);
        if (k === 0) {
          // get_error_correction(0) = bit_wise_sign(2*B+N-1): XOR the
          // SIGN (-1 or 0), not a 0/1 bit (CharLS error_value ^
          // correction — flipping with 1 corrupts every k==0 symbol
          // once B goes nonzero).
          const corr = (2 * BB[qi]! + NN[qi]! - 1) >> 31;
          err ^= corr;
        }
        // update_variables_and_bias (A.12) + bias carry (A.13)
        AA[qi]! += Math.abs(err);
        BB[qi]! += err * 1; // NEAR=0: err*(2*NEAR+1) = err
        if (AA[qi]! >= 65536 * 256 || Math.abs(BB[qi]!) >= 65536 * 256) {
          throw new JpegError('bad-stats', 'A/B overflow');
        }
        if (NN[qi]! === RESET) {
          AA[qi]! >>= 1;
          BB[qi]! >>= 1;
          NN[qi]! >>= 1;
        }
        NN[qi]++;
        // A.13 bias carry
        if (BB[qi]! + NN[qi]! <= 0) {
          BB[qi]! += NN[qi]!;
          if (BB[qi]! <= -NN[qi]!) BB[qi]! = -NN[qi]! + 1;
          if (CC[qi]! > -128) CC[qi]!--;
        } else if (BB[qi]! > 0) {
          BB[qi]! -= NN[qi]!;
          if (BB[qi]! > 0) BB[qi]! = 0;
          if (CC[qi]! < 127) CC[qi]!++;
        }
        const errS = sign === 0 ? err : -err;
        const Rx = maxval & (pxc + errS);
        cur[x + 1] = Rx;
        writePx[y * width + x] = Rx;
        x++;
      } else {
        // run mode: decode run length, fill Ra, then interruption pixel
        const rmax = width - x;
        const runPos0 = br.offset * 8 - br.bitsCount;
        const runlen = decodeRunLen(rmax);
        trace(`RUN (${x},${y}) Ra=${Ra} rmax=${rmax} len=${runlen} ri=${runIndex} pos=${runPos0}->${br.offset * 8 - br.bitsCount}`);
        for (let i = 0; i < runlen; i++) {
          cur[x + 1 + i] = Ra;
          writePx[y * width + x + i] = Ra;
        }
        x += runlen;
        if (x >= width) break;
        // run interruption pixel
        const Rb2 = prev[x + 1]!;
        const nearZero = Math.abs(Ra - Rb2) <= 0;
        const ctx = nearZero ? 1 : 0;
        const kk = runK(ctx);
        const lim = limit - J[runIndex]! - 1;
        const mapped = golombDecode(br, null, kk, lim, qbpp);
        const err = runErrValue(ctx, mapped, kk);
        runUpdate(ctx, err, mapped);
        let v: number;
        if (nearZero) {
          v = maxval & (Ra + err);
        } else {
          const s = Rb2 - Ra < 0 ? -1 : 0; // sign(rb-ra): -1 or 0
          v = maxval & (Rb2 + (s === 0 ? err : -err));
        }
        cur[x + 1] = v;
        writePx[y * width + x] = v;
        if (runIndex > 0) runIndex--;
        x++;
      }
    }
  }
  for (let i = 0; i < width * height; i++) put(i, writePx[i]!);
  return { width, height, bits, bytes: out, near: 0 };
}
