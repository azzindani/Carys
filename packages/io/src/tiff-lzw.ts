// TIFF LZW codec (MSB-first codes, CLEAR 256 / EOI 257, 9-bit start with
// early-change growth at next==511/1023/2047 — validated byte-exact against
// Pillow, including a 200x200 file crossing the 9->10->11 bit widths).
// Decoder tolerates EOI cut with pad bits; the test-only encoder mirrors
// the same growth points.

export class OmeTiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmeTiffError';
  }
}

// ---- TIFF LZW (MSB-first, CLEAR 256 / EOI 257, 9→12 bit) ----

const LZW_CLEAR = 256;
const LZW_EOI = 257;

export function lzwDecodeTiff(input: Uint8Array, expected: number): Uint8Array {
  let pos = 0, bitBuf = 0, bitCount = 0;
  const readCode = (width: number): number | null => {
    while (bitCount < width) {
      if (pos >= input.length) return null;
      bitBuf = (bitBuf << 8) | input[pos++]!;
      bitCount += 8;
    }
    bitCount -= width;
    return (bitBuf >> bitCount) & ((1 << width) - 1);
  };
  const table: number[][] = [];
  let width = 9, next = 258;
  const reset = (): void => {
    table.length = 0;
    for (let i = 0; i < 256; i++) table.push([i]);
    table.push([], []); // 256/257 are CLEAR/EOI: reserved, never table refs
    width = 9;
    next = 258;
  };
  reset();
  const out: number[] = [];
  let prev: number[] | null = null;
  for (;;) {
    const code = readCode(width);
    if (code === null) break; // exhausted: EOI may be cut with pad bits
    if (code === LZW_CLEAR) { reset(); prev = null; continue; }
    if (code === LZW_EOI) break;
    let entry: number[] | undefined;
    if (code < 256) entry = table[code];
    else if (code < next) entry = table[code]; // 258..next-1 (256/257 caught above)
    else if (code === next && prev) entry = [...prev, prev[0]!]; // KwKwK
    else throw new OmeTiffError(`LZW bad code ${code} (table ${table.length})`);
    for (const b of entry) {
      out.push(b);
      if (out.length > expected + 16) throw new OmeTiffError('LZW output overruns expected size');
    }
    if (prev) {
      table.push([...prev, entry[0]!]);
      next++;
      // Early change (what real writers emit): widen BEFORE the boundary
      // index is ever read — index 511 first appears at 10 bits, etc.
      if (next === 511) width = 10;
      else if (next === 1023) width = 11;
      else if (next === 2047) width = 12;
      else if (next > 4096) throw new OmeTiffError('LZW table overflow (missing CLEAR?)');
    }
    prev = entry;
  }
  if (out.length < expected) throw new OmeTiffError(`LZW short: ${out.length} < ${expected} bytes`);
  return Uint8Array.from(out.slice(0, expected));
}

/** Test-only LZW encoder mirroring the decoder (same growth points). */
export function lzwEncodeTiff(input: Uint8Array): Uint8Array {
  const dict = new Map<string, number>();
  const reset = (): void => {
    dict.clear();
    for (let i = 0; i < 256; i++) dict.set(String(i), i);
  };
  reset();
  const words: number[] = [];
  let width = 9, next = 258, bits = 0, nbits = 0;
  const emit = (code: number): void => {
    bits = (bits << width) | code;
    nbits += width;
    while (nbits >= 8) {
      nbits -= 8;
      words.push((bits >> nbits) & 0xff);
    }
  };
  const grow = (): void => {
    next++;
    if (next === 511) width = 10;
    else if (next === 1023) width = 11;
    else if (next === 2047) width = 12;
  };
  emit(LZW_CLEAR);
  if (input.length === 0) { emit(LZW_EOI); }
  else {
    let cur = [input[0]!];
    for (let i = 1; i < input.length; i++) {
      const cand = [...cur, input[i]!];
      if (dict.has(cand.join(','))) { cur = cand; continue; }
      emit(dict.get(cur.join(','))!);
      dict.set(cand.join(','), next);
      grow();
      cur = [input[i]!];
    }
    emit(dict.get(cur.join(','))!);
    emit(LZW_EOI);
  }
  if (nbits > 0) words.push((bits << (8 - nbits)) & 0xff);
  return Uint8Array.from(words);
}

