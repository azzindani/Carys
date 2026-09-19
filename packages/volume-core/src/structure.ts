// Ported from Mol* structure/model (hierarchy.ts, model.ts) + structure.ts.
// Columnar, index-based: field names (label_/auth_) kept 1:1 for mmCIF
// compat. Skips: bonds/rings, symmetry assemblies, lookup3d, coarse beads.

export interface AtomRow {
  type_symbol: string;
  label_atom_id: string;
  label_comp_id: string;
  label_asym_id: string;
  auth_asym_id: string;
  label_seq_id: number;
  auth_seq_id: number;
  x: number; y: number; z: number;
  occupancy: number;
  b_iso: number;
  plddt?: number;
}

export interface ResidueRow {
  group_PDB: string;
  label_seq_id: number;
  auth_seq_id: number;
  label_comp_id: string;
  chainLabel: string;
}

export interface ChainRow {
  label_asym_id: string;
  auth_asym_id: string;
  label_entity_id: string;
}

export interface AtomicHierarchy {
  atoms: AtomRow[];
  residues: ResidueRow[];
  chains: ChainRow[];
  /** residue k spans atoms residueOffsets[k]..residueOffsets[k+1] */
  residueOffsets: number[];
  chainOffsets: number[];
}

export interface StructureUnit {
  id: number;
  chainLabel: string;
  elements: number[];
}

export interface StructureModel {
  hierarchy: AtomicHierarchy;
  units: StructureUnit[];
  entities: { id: string; type: string }[];
}
