// CIF 1.1 lexing shared by the model reader (io/cif.ts) and the assembly
// reader (assembly-cif.ts): tokens, loop_ blocks, and whole categories
// whether written as a loop or as single `_cat.item value` pairs (mmCIF
// writes a one-row category without loop_, so an entry with a single
// operator has no loop to find). Single data block. Loud CifError.

export class CifError extends Error {
  constructor(public kind: string, detail: string) {
    super(`CIF ${kind}: ${detail}`);
  }
}

const WS = ' \t\r\n';

/** Tokenize: whitespace split, '...'/"..." quotes, ;text blocks. A quote
 *  closes only where whitespace (or the end) follows it, so O5' and
 *  'VIRUS'S COAT' stay one token each, as CIF 1.1 says. */
export function cifTokens(text: string): string[] {
  const toks: string[] = [];
  const n = text.length;
  let p = 0;
  const atLineStart = (): boolean => p === 0 || text[p - 1] === '\n' || text[p - 1] === '\r';
  const atTokenStart = (): boolean => p === 0 || WS.includes(text[p - 1]!);
  while (p < n) {
    const c = text[p]!;
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { p++; continue; }
    if (c === '#' && atTokenStart()) {
      while (p < n && text[p] !== '\n') p++;
      continue;
    }
    if ((c === "'" || c === '"') && atTokenStart()) {
      let end = text.indexOf(c, p + 1);
      while (end >= 0 && end + 1 < n && !WS.includes(text[end + 1]!)) end = text.indexOf(c, end + 1);
      if (end < 0) throw new CifError('bad-quote', `unterminated ${c} at ${p}`);
      toks.push(text.slice(p + 1, end));
      p = end + 1;
      continue;
    }
    if (c === ';' && atLineStart()) {
      const end = text.indexOf('\n;', p + 1);
      if (end < 0) throw new CifError('bad-quote', `unterminated ;block at ${p}`);
      toks.push(text.slice(p + 1, end + 1));
      p = end + 2;
      continue;
    }
    let q = p;
    while (q < n && !WS.includes(text[q]!)) q++;
    toks.push(text.slice(p, q));
    p = q;
  }
  return toks;
}

const isTag = (t: string): boolean => t.startsWith('_');
const isStruct = (t: string): boolean =>
  t === 'loop_' || t === 'stop_' || t.startsWith('data_') || t.startsWith('save_');

export interface CifLoop {
  tags: string[];
  rows: string[][];
}

/** Split tokens into loop_ blocks: {tags, rows}. Values stop a row run. */
export function cifLoops(toks: string[]): CifLoop[] {
  const out: CifLoop[] = [];
  let i = 0;
  while (i < toks.length) {
    if (toks[i] !== 'loop_') { i++; continue; }
    i++;
    const tags: string[] = [];
    while (i < toks.length && isTag(toks[i]!)) tags.push(toks[i++]!);
    const rows: string[][] = [];
    while (i + tags.length <= toks.length) {
      const head = toks[i]!;
      if (isTag(head) || isStruct(head)) break;
      rows.push(toks.slice(i, i + tags.length));
      i += tags.length;
    }
    out.push({ tags, rows });
  }
  return out;
}

/** Category name of a tag: `_atom_site.Cartn_x` → `atom_site`. */
function categoryOf(tag: string): string {
  const dot = tag.indexOf('.');
  return dot < 0 ? tag.slice(1) : tag.slice(1, dot);
}

/** The named categories as rows of item → value (item without the
 *  category prefix), from loops and from single item/value pairs alike.
 *  A category the text lacks maps to []. */
export function cifCategories(toks: string[], names: string[]): Map<string, Record<string, string>[]> {
  const want = new Set(names);
  const out = new Map<string, Record<string, string>[]>(names.map((nm) => [nm, []]));
  let i = 0;
  while (i < toks.length) {
    const t = toks[i]!;
    if (t === 'loop_') {
      i++;
      const tags: string[] = [];
      while (i < toks.length && isTag(toks[i]!)) tags.push(toks[i++]!);
      const cat = tags.length > 0 ? categoryOf(tags[0]!) : '';
      const rows = out.get(cat);
      const keys = tags.map((tag) => tag.slice(cat.length + 2));
      while (i + tags.length <= toks.length) {
        const head = toks[i]!;
        if (isTag(head) || isStruct(head)) break;
        if (rows && want.has(cat)) {
          const row: Record<string, string> = {};
          for (let k = 0; k < keys.length; k++) row[keys[k]!] = toks[i + k]!;
          rows.push(row);
        }
        i += tags.length;
      }
      continue;
    }
    if (isTag(t)) {
      const cat = categoryOf(t);
      const value = toks[i + 1];
      if (value === undefined || isTag(value) || isStruct(value)) {
        throw new CifError('bad-item', `${t} has no value`);
      }
      const rows = out.get(cat);
      if (rows) {
        if (rows.length === 0) rows.push({});
        rows[0]![t.slice(cat.length + 2)] = value;
      }
      i += 2;
      continue;
    }
    i++;
  }
  return out;
}
