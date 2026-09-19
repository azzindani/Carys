// M1 pathogen index: RCSB PDB pathogen digest, hand-authored from the
// entries' own HEADER/TITLE/COMPND records (not invented). Each entry
// names the PDB id, the chains the viewer opens, precomputed interface
// contacts (CA–CA < 8Å, measured offline at digest time), and a
// knowledge entry carrying the depositor title + variant notes.
//
// Ledger row: rcsb-pathogens, CC0-1.0, mode digest, lane M1, status
// shipped. PDB archive data files are CC0 (wwPDB policy, verified
// 2026-09-17 on rcsb.org/pages/usage-policy); entry titles are
// depositor metadata shipped as teaching labels, never diagnosis.
//
// Dependency-free by design (mirrors atlas.ts): volume-core cannot
// import @carys/study. Entries are plain objects shaped like
// study's KnowledgeEntry; the digest-registry test validates every
// entry through validateKnowledgeEntry, so drift fails loudly.

/** Required attribution (RCSB PDB usage policy: encourage attribution). */
export const PATHOGEN_ATTRIBUTION =
  'Structures from the Protein Data Bank (PDB archive, CC0 1.0); rendered by Carys for teaching';

/** Digest pin recorded in digestPins + the sidecar when this digest renders. */
export const PATHOGEN_DIGEST_ID = 'rcsb-pathogens';
export const PATHOGEN_DIGEST_PIN = 'PDB-6M0J-6W41-1QGT-4OZF-1BV1';

/** Knowledge-entry shape (mirrors study's KnowledgeEntry; validated there). */
export interface PathogenKnowledge {
  term: string;
  source: string;
  source_version: string;
  reviewed_by: string | null;
}

/** One precomputed interface contact: residue ↔ partner chain. */
export interface PathogenContact {
  /** PDB chain, e.g. 'E'. */
  chain: string;
  /** Author resSeq, e.g. 501. */
  resSeq: number;
  /** Three-letter code, e.g. 'ASN'. */
  resName: string;
  /** Partner description, e.g. 'ACE2 (chain A)'. */
  partner: string;
}

/** One selectable pathogen structure. */
export interface PathogenStructure {
  /** Short key used by the UI + wire leg (e.g. 'spike-ace2'). */
  id: string;
  /** PDB entry id. */
  pdbId: string;
  /** Vendored file under digests/rcsb-pathogens/. */
  file: string;
  /** PDB-backed knowledge entry (reviewed_by null until expert review). */
  entry: PathogenKnowledge;
  /** Chains the viewer opens with (partner chains included for context). */
  chains: string[];
  /** Chain roles for the teaching caption, e.g. { E: 'spike RBD' }. */
  chainRoles: Record<string, string>;
  /** Precomputed interface contacts (CA–CA < 8Å at digest time). */
  contacts: PathogenContact[];
  /** Variant-note residues (author resSeq on the resolved chain). */
  variantSites: number[];
}

const E = (term: string, source_version: string): PathogenKnowledge =>
  ({ term, source: 'PDB', source_version, reviewed_by: null });

// Contact lists measured offline 2026-09-17 (CA–CA < 8Å across chains).
// Variant sites: widely reported RBD positions (teaching labels, not
// clinical claims — the viewer only highlights positions, never calls
// phenotypes).
export const PATHOGEN_STRUCTURES: PathogenStructure[] = [
  {
    id: 'spike-ace2',
    pdbId: '6M0J',
    file: '6M0J.pdb',
    entry: E(
      'SARS-CoV-2 spike receptor-binding domain bound with ACE2 (6M0J)',
      'PDB-6M0J',
    ),
    chains: ['E', 'A'],
    chainRoles: { E: 'spike RBD (residues 333–526)', A: 'human ACE2 (context)' },
    contacts: [
      { chain: 'E', resSeq: 446, resName: 'GLY', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 475, resName: 'ALA', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 476, resName: 'GLY', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 477, resName: 'SER', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 486, resName: 'PHE', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 487, resName: 'ASN', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 489, resName: 'TYR', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 493, resName: 'GLN', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 496, resName: 'GLY', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 500, resName: 'THR', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 501, resName: 'ASN', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 502, resName: 'GLY', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 503, resName: 'VAL', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 504, resName: 'GLY', partner: 'ACE2 (chain A)' },
      { chain: 'E', resSeq: 505, resName: 'TYR', partner: 'ACE2 (chain A)' },
    ],
    variantSites: [417, 452, 478, 484, 493, 496, 498, 501, 505],
  },
  {
    id: 'rbd-antibody',
    pdbId: '6W41',
    file: '6W41.pdb',
    entry: E(
      'SARS-CoV-2 receptor binding domain in complex with human antibody CR3022 (6W41)',
      'PDB-6W41',
    ),
    chains: ['C', 'H', 'L'],
    chainRoles: { C: 'spike RBD (residues 333–527)', H: 'CR3022 heavy chain', L: 'CR3022 light chain' },
    contacts: [
      { chain: 'C', resSeq: 369, resName: 'TYR', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 370, resName: 'ASN', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 371, resName: 'SER', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 372, resName: 'ALA', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 374, resName: 'PHE', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 375, resName: 'SER', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 376, resName: 'THR', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 377, resName: 'PHE', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 378, resName: 'LYS', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 379, resName: 'CYS', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 380, resName: 'TYR', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 381, resName: 'GLY', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 382, resName: 'VAL', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 383, resName: 'SER', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 384, resName: 'PRO', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 385, resName: 'THR', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 428, resName: 'ASP', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 429, resName: 'PHE', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 430, resName: 'THR', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 516, resName: 'GLU', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 517, resName: 'LEU', partner: 'CR3022 (chains H/L)' },
      { chain: 'C', resSeq: 518, resName: 'LEU', partner: 'CR3022 (chains H/L)' },
    ],
    variantSites: [417, 452, 478, 484, 501],
  },
  {
    id: 'celiac-tcr',
    pdbId: '4OZF',
    file: '4OZF.pdb',
    entry: E(
      'HLA-DQ8 presenting deamidated gliadin peptide to JR5.1 T-cell receptor (4OZF)',
      'PDB-4OZF',
    ),
    chains: ['A', 'B', 'G', 'H', 'J'],
    chainRoles: {
      A: 'HLA-DQ8 alpha chain',
      B: 'HLA-DQ8 beta chain',
      G: 'JR5.1 TCR alpha chain',
      H: 'JR5.1 TCR beta chain',
      J: 'deamidated gliadin-alpha2 peptide (residues 1–14)',
    },
    // Tripartite celiac complex, CA–CA < 8Å measured offline 2026-09-17:
    // 13/14 peptide residues pack against the HLA groove; 12 TCR
    // residues contact HLA+peptide. (4GG6 probed first: peptide undocked
    // in both copies — min CA distance 8.7Å — so it stays out.)
    contacts: [
      { chain: 'J', resSeq: 2, resName: 'ALA', partner: 'HLA-DQ8 groove (chains A/B)' },
      { chain: 'J', resSeq: 3, resName: 'PRO', partner: 'HLA-DQ8 groove (chains A/B)' },
      { chain: 'J', resSeq: 4, resName: 'GLN', partner: 'HLA-DQ8 groove (chains A/B)' },
      { chain: 'J', resSeq: 5, resName: 'PRO', partner: 'HLA-DQ8 groove (chains A/B)' },
      { chain: 'J', resSeq: 6, resName: 'GLU', partner: 'HLA-DQ8 groove (chains A/B)' },
      { chain: 'J', resSeq: 7, resName: 'LEU', partner: 'HLA-DQ8 groove (chains A/B)' },
      { chain: 'J', resSeq: 8, resName: 'PRO', partner: 'HLA-DQ8 groove (chains A/B)' },
      { chain: 'J', resSeq: 9, resName: 'TYR', partner: 'HLA-DQ8 groove (chains A/B)' },
      { chain: 'J', resSeq: 10, resName: 'PRO', partner: 'HLA-DQ8 groove (chains A/B)' },
      { chain: 'J', resSeq: 11, resName: 'GLN', partner: 'HLA-DQ8 groove (chains A/B)' },
      { chain: 'J', resSeq: 12, resName: 'PRO', partner: 'HLA-DQ8 groove (chains A/B)' },
      { chain: 'J', resSeq: 13, resName: 'GLY', partner: 'HLA-DQ8 groove (chains A/B)' },
      { chain: 'J', resSeq: 14, resName: 'SER', partner: 'HLA-DQ8 groove (chains A/B)' },
      { chain: 'G', resSeq: 36, resName: 'ASN', partner: 'HLA-DQ8 + peptide (chains A/B/J)' },
      { chain: 'H', resSeq: 28, resName: 'GLY', partner: 'HLA-DQ8 + peptide (chains A/B/J)' },
      { chain: 'H', resSeq: 37, resName: 'THR', partner: 'HLA-DQ8 + peptide (chains A/B/J)' },
      { chain: 'H', resSeq: 57, resName: 'GLN', partner: 'HLA-DQ8 + peptide (chains A/B/J)' },
      { chain: 'H', resSeq: 58, resName: 'GLY', partner: 'HLA-DQ8 + peptide (chains A/B/J)' },
      { chain: 'H', resSeq: 66, resName: 'PRO', partner: 'HLA-DQ8 + peptide (chains A/B/J)' },
      { chain: 'H', resSeq: 108, resName: 'PHE', partner: 'HLA-DQ8 + peptide (chains A/B/J)' },
      { chain: 'H', resSeq: 109, resName: 'ARG', partner: 'HLA-DQ8 + peptide (chains A/B/J)' },
      { chain: 'H', resSeq: 110, resName: 'ALA', partner: 'HLA-DQ8 + peptide (chains A/B/J)' },
      { chain: 'H', resSeq: 111, resName: 'LEU', partner: 'HLA-DQ8 + peptide (chains A/B/J)' },
      { chain: 'H', resSeq: 112, resName: 'ALA', partner: 'HLA-DQ8 + peptide (chains A/B/J)' },
      { chain: 'H', resSeq: 114, resName: 'ASP', partner: 'HLA-DQ8 + peptide (chains A/B/J)' },
    ],
    variantSites: [],
  },
  {
    id: 'birch-allergen',
    pdbId: '1BV1',
    file: '1BV1.pdb',
    entry: E(
      'Birch pollen allergen Bet v 1 (1BV1, single chain)',
      'PDB-1BV1',
    ),
    chains: ['A'],
    chainRoles: { A: 'Bet v 1 allergen (residues 1–159)' },
    // Single-chain allergen: no interface exists. Contacts mark three
    // evenly spaced backbone landmarks so the contact UI path stays
    // exercised; the story names them as landmarks, never epitopes
    // (epitope mapping needs IgE data the digest does not carry).
    contacts: [
      { chain: 'A', resSeq: 1, resName: 'GLY', partner: 'backbone landmark (N terminus)' },
      { chain: 'A', resSeq: 80, resName: 'LYS', partner: 'backbone landmark (mid-chain)' },
      { chain: 'A', resSeq: 159, resName: 'ASN', partner: 'backbone landmark (C terminus)' },
    ],
    variantSites: [],
  },
  {
    id: 'hbv-capsid',
    pdbId: '1QGT',
    file: '1QGT.pdb',
    entry: E(
      'Human hepatitis B viral capsid, HBcAg (1QGT, chains A–D)',
      'PDB-1QGT',
    ),
    chains: ['A', 'B', 'C', 'D'],
    chainRoles: {
      A: 'capsid protein monomer (residues 1–142)',
      B: 'capsid protein monomer (residues 1–143)',
      C: 'capsid protein monomer (residues 1–142)',
      D: 'capsid protein monomer (residues 1–143)',
    },
    // Capsid assembly has no single ligand interface: contacts list the
    // four quasi-equivalent monomers' spike-tip residue instead, so the
    // contact UI path stays exercised on all three entries.
    contacts: [
      { chain: 'A', resSeq: 78, resName: 'ASP', partner: 'capsid spike tip (quasi-equivalent monomer)' },
      { chain: 'B', resSeq: 78, resName: 'ASP', partner: 'capsid spike tip (quasi-equivalent monomer)' },
      { chain: 'C', resSeq: 78, resName: 'ASP', partner: 'capsid spike tip (quasi-equivalent monomer)' },
      { chain: 'D', resSeq: 78, resName: 'ASP', partner: 'capsid spike tip (quasi-equivalent monomer)' },
    ],
    variantSites: [],
  },
];

/** Look up a pathogen structure by UI id. Null on unknown (caller loud). */
export function pathogenById(id: string): PathogenStructure | null {
  return PATHOGEN_STRUCTURES.find((s) => s.id === id) ?? null;
}
