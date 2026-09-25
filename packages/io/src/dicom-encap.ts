// Encapsulated (compressed) pixel-data framing — item-tag walk ported from
// Daikon Parser.parseEncapsulated + Image.getJpegs/getRLE (BSD-3-Clause). Layout after
// the (7FE0,0010) header with undefined length: item (FFFE,E000) + u32 length
// repeated — first item is the Basic Offset Table, the rest are fragments —
// closed by a sequence delimiter (FFFE,E0DD). All LE (no BE encapsulated TS).

export class EncapError extends Error {
  constructor(public kind: string, detail: string) {
    super(`encapsulated ${kind}: ${detail}`);
  }
}

export interface EncapFrames {
  /** u32 LE byte offsets of each frame inside the concatenated fragments. */
  bot: number[];
  fragments: Uint8Array[];
  /** Offset just past the sequence delimiter (resume point for the walker). */
  endOffset: number;
}

const ITEM = 0xe000;
const SEQ_DELIM = 0xe0dd;
const GROUP = 0xfffe;

export function readEncapsulated(
  bytes: Uint8Array,
  view: DataView,
  off: number,
): EncapFrames {
  const end = bytes.length;
  const items: Uint8Array[] = [];
  let p = off;
  for (;;) {
    if (p + 8 > end) throw new EncapError('truncated', 'missing sequence delimiter');
    const g = view.getUint16(p, true);
    const e = view.getUint16(p + 2, true);
    const l = view.getUint32(p + 4, true);
    if (g === GROUP && e === SEQ_DELIM) {
      if (l !== 0) throw new EncapError('bad-delimiter', `length ${l}`);
      p += 8;
      break;
    }
    if (g !== GROUP || e !== ITEM) {
      throw new EncapError('bad-item-tag', `(${g.toString(16)},${e.toString(16)})`);
    }
    if (p + 8 + l > end) throw new EncapError('truncated', 'fragment overruns buffer');
    items.push(bytes.subarray(p + 8, p + 8 + l));
    p += 8 + l;
  }
  if (items.length === 0) throw new EncapError('empty', 'no BOT item');
  const botBytes = items[0]!;
  const bot: number[] = [];
  const bv = new DataView(botBytes.buffer, botBytes.byteOffset, botBytes.byteLength);
  for (let i = 0; i + 4 <= botBytes.length; i += 4) bot.push(bv.getUint32(i, true));
  return { bot, fragments: items.slice(1), endOffset: p };
}

/** Concatenate fragments into one byte stream (single-frame fast path). */
export function concatFragments(fragments: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const f of fragments) n += f.length;
  const out = new Uint8Array(n);
  let p = 0;
  for (const f of fragments) { out.set(f, p); p += f.length; }
  return out;
}

const SOI0 = 0xff;
const SOI1 = 0xd8;

/**
 * Group fragments into per-frame JPEGs the way Daikon getJpegs does: a new
 * frame starts at every fragment whose first two bytes are SOI; continuation
 * fragments are concatenated. Lets one frame span many fragments.
 */
export function groupJpegFrames(fragments: Uint8Array[]): Uint8Array[] {
  const frames: Uint8Array[][] = [];
  let cur: Uint8Array[] | null = null;
  for (const f of fragments) {
    if (f.length >= 2 && f[0] === SOI0 && f[1] === SOI1) {
      cur = [];
      frames.push(cur);
    }
    if (!cur) throw new EncapError('missing-soi', 'first fragment is not a JPEG start');
    cur.push(f);
  }
  return frames.map((parts) =>
    parts.length === 1 ? parts[0]! : concatFragments(parts),
  );
}
