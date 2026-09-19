// Port of Mol* selection model (CPU cut, no WebGL).
// Mol*: mmCIF/PDB parsing, sequence<->3D selection, loci -> bundle
// (serializable), MolQL queries, superposition. We steal: residue index +
// sequence<->3D highlight + serializable bundle. No superposition solver yet.

export interface ResidueRef {
  chain: string;
  seqId: number; // author seq id
  index: number; // 0-based into residues array
  label: string; // e.g. "ALA12"
}

/** Serializable selection bundle (cf. Mol* bundle of loci). */
export interface ResidueBundle {
  residues: number[]; // 0-based residue indices
}

export function bundleRange(from: number, to: number): ResidueBundle {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return { residues: out };
}

/** Map a sequence-track hit to a 3D highlight (same Selection model). */
export function residuesToSelection(bundle: ResidueBundle): {
  kind: 'residue';
  ids: number[];
} {
  return { kind: 'residue', ids: bundle.residues };
}
