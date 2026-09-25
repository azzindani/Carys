// Minimal mmCIF reader: tokens (volume-core cif-tokens) → first
// loop_ carrying _atom_site.Cartn_x → ProteinModel. Row mapping mirrors
// parsePdb exactly (ATOM only, xyz-guarded, auth→label fallbacks, same
// residue keys) so the CIF/PDB equivalence test holds field-for-field.
// Scope: single data block; multi-model files keep every model (parsePdb
// keeps every MODEL too); save_ frames end row runs. Loud CifError.

import { CifError, cifLoops, cifTokens } from '@carys/volume-core';
import type { ResidueRef } from '@carys/volume-core';
import type { ProteinModel } from './pdb.js';

export { CifError };

/** Content sniff for the open dialog (mirrors isStlLike). */
export function isCifLike(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('data_') && text.includes('_atom_site.');
}

/** First atom_site loop → model. Throws CifError when absent/unusable. */
export function parseCif(text: string): ProteinModel {
  const loops = cifLoops(cifTokens(text));
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
