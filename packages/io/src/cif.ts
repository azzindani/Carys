// Minimal mmCIF reader: tokenize (quotes + semicolon text blocks) → first
// loop_ carrying _atom_site.Cartn_x → ProteinModel. Row mapping mirrors
// parsePdb exactly (ATOM only, xyz-guarded, auth→label fallbacks, same
// residue keys) so the CIF/PDB equivalence test holds field-for-field.
// Scope: single data block; multi-model files keep every model (parsePdb
// keeps every MODEL too); save_ frames end row runs. Loud CifError.

export class CifError extends Error {
  constructor(public kind: string, detail: string) {
    super(`CIF ${kind}: ${detail}`);
  }
}

/** Content sniff for the open dialog (mirrors isStlLike). */
export function isCifLike(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('data_') && text.includes('_atom_site.');
}

/** CIF 1.1 tokenize: whitespace split + '...'/\"...\" quotes + ;blocks. */
function tokenize(text: string): string[] {
  const toks: string[] = [];
  const n = text.length;
  let p = 0;
  const atLineStart = (): boolean => p === 0 || text[p - 1] === '\n' || text[p - 1] === '\r';
  const atTokenStart = (): boolean => p === 0 || ' \t\r\n'.includes(text[p - 1]!);
  while (p < n) {
    const c = text[p]!;
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { p++; continue; }
    if (c === '#' && atTokenStart()) {
      while (p < n && text[p] !== '\n') p++;
      continue;
    }
    if ((c === "'" || c === '"') && atTokenStart()) {
      const end = text.indexOf(c, p + 1);
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
    while (q < n && !' \t\r\n'.includes(text[q]!)) q++;
    toks.push(text.slice(p, q));
    p = q;
  }
  return toks;
}

const isTag = (t: string): boolean => t.startsWith('_');
const isStruct = (t: string): boolean =>
  t === 'loop_' || t.startsWith('data_') || t.startsWith('save_');

/** Split tokens into loop_ blocks: {tags, rows}. Values stop a row run. */
function loopsOf(toks: string[]): { tags: string[]; rows: string[][] }[] {
  const out: { tags: string[]; rows: string[][] }[] = [];
  let i = 0;
  while (i < toks.length) {
    if (toks[i] !== 'loop_') { i++; continue; }
    i++;
    const tags: string[] = [];
    while (i < toks.length && isTag(toks[i]!)) tags.push(toks[i++]!);
    const rows: string[][] = [];
    while (i + tags.length <= toks.length) {
      const head = toks[i]!;
      if (isTag(head) || isStruct(head) || head === 'loop_' || head === 'stop_') break;
      rows.push(toks.slice(i, i + tags.length));
      i += tags.length;
    }
    out.push({ tags, rows });
  }
  return out;
}

import type { ProteinModel } from './pdb.js';
import type { ResidueRef } from '@carys/volume-core';

/** First atom_site loop → model. Throws CifError when absent/unusable. */
export function parseCif(text: string): ProteinModel {
  const loops = loopsOf(tokenize(text));
  const loop = loops.find((l) => l.tags.includes('_atom_site.Cartn_x'));
  if (!loop) throw new CifError('no-atom-site', 'no loop_ with _atom_site.Cartn_x');
  const col = (names: string[]): number => {
    for (const name of names) {
      const i = loop.tags.indexOf(name);
      if (i >= 0) return i;
    }
    return -1;
  };
  const cGroup = col(['_atom_site.group_PDB']);
  const cX = col(['_atom_site.Cartn_x']);
  const cY = col(['_atom_site.Cartn_y']);
  const cZ = col(['_atom_site.Cartn_z']);
  const cComp = col(['_atom_site.label_comp_id']);
  const cAsym = col(['_atom_site.auth_asym_id', '_atom_site.label_asym_id']);
  const cSeq = col(['_atom_site.auth_seq_id', '_atom_site.label_seq_id']);
  const cElem = col(['_atom_site.type_symbol']);
  const cAtom = col(['_atom_site.label_atom_id', '_atom_site.auth_atom_id']);
  const cB = col(['_atom_site.B_iso_or_equiv']);
  if (cX < 0 || cY < 0 || cZ < 0) throw new CifError('missing-coords', 'atom_site lacks Cartn_*');
  if (cComp < 0 || cAsym < 0 || cSeq < 0) {
    throw new CifError('missing-ids', 'atom_site lacks comp/asym/seq columns');
  }
  const atoms: ProteinModel['atoms'] = [];
  const resMap = new Map<string, ResidueRef>();
  for (const r of loop.rows) {
    if (cGroup >= 0 && r[cGroup] !== 'ATOM') continue;
    const x = parseFloat(r[cX]!);
    const y = parseFloat(r[cY]!);
    const z = parseFloat(r[cZ]!);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;
    const resName = (r[cComp] ?? '').trim();
    const chain = (r[cAsym] ?? '').trim() || 'A';
    const resSeq = parseInt(r[cSeq] ?? '', 10);
    const element = (cElem >= 0 ? (r[cElem] ?? '').trim() : '') || 'C';
    const atomName = cAtom >= 0 ? (r[cAtom] ?? '').trim() : '';
    const bfactor = cB >= 0 ? parseFloat(r[cB]!) : NaN;
    atoms.push({
      x, y, z, element, chain, resSeq, resName,
      ...(atomName ? { atomName } : {}),
      ...(Number.isFinite(bfactor) ? { bfactor } : {}),
    });
    const key = `${chain}:${resSeq}`;
    if (!resMap.has(key)) {
      resMap.set(key, {
        chain, seqId: resSeq, index: resMap.size, label: `${resName}${resSeq}`,
      });
    }
  }
  return { atoms, residues: [...resMap.values()] };
}
