// Port of Mol* CIF parser + residue index (minimal PDB subset).
// ATOM records -> atoms+residues; mmCIF lives in cif.ts (same model).
import type { Atom } from '@carys/volume-core';
import type { ResidueBundle, ResidueRef } from '@carys/volume-core';

export interface ProteinModel {
  atoms: Atom[];
  residues: ResidueRef[];
}

/** Minimal PDB ATOM parser (fixed columns). Skips HETATM/altlocs. */
export function parsePdb(text: string): ProteinModel {
  const atoms: Atom[] = [];
  const resMap = new Map<string, ResidueRef>();
  for (const line of text.split('\n')) {
    if (!line.startsWith('ATOM')) continue;
    const x = parseFloat(line.slice(30, 38));
    const y = parseFloat(line.slice(38, 46));
    const z = parseFloat(line.slice(46, 54));
    const resName = line.slice(17, 20).trim();
    const chain = line.slice(21, 22) || 'A';
    const resSeq = parseInt(line.slice(22, 26).trim(), 10);
    const element = line.slice(76, 78).trim() || 'C';
    const atomName = line.slice(12, 16).trim();
    const bfactor = parseFloat(line.slice(60, 66));
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;
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

/**
 * Sequence track -> 3D highlight: atoms belonging to the bundled residue
 * indices (Mol* loci -> bundle -> selection, CPU cut).
 */
export function selectResidueAtoms(model: ProteinModel, bundle: ResidueBundle): Atom[] {
  const wanted = new Set(bundle.residues);
  const byKey = new Map(model.residues.map((r) => [`${r.chain}:${r.seqId}`, r.index]));
  return model.atoms.filter((a) => {
    const idx = byKey.get(`${a.chain}:${a.resSeq}`);
    return idx !== undefined && wanted.has(idx);
  });
}
