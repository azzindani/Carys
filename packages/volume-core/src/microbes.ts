// H8 microbiology library: a card per virus family and per bacterium —
// structure, genome, morphology, Gram stain, examples — each linked to its
// PDB structures (the H7 capsids, the M1 pathogen entries, or the bacterial
// entries of the microbe-library digest) and to the Learn bundles that
// teach it.
//
// Every card names where its text comes from and under what licence. The
// virus-family cards are summaries of the family's ICTV Virus Taxonomy
// Profile (Journal of General Virology, CC BY 4.0, adapted; its licence
// is checked against Crossref by scripts/build-microbes.mjs). The
// bacterium cards and the hepadnavirus card are written here (this
// repository, MIT): the Hepadnaviridae profile is CC BY-NC and textbooks
// such as OpenStax Microbiology are CC BY-NC-SA, which the library does
// not take text from. Their structures cite the PDB (CC0). Teaching
// labels, not reviewed by an expert yet (reviewed_by null); never
// diagnosis.
//
// Dependency-free by design (mirrors pathogens.ts/bundles.ts): study
// validates the knowledge entries, the app renders the cards.

import type { PathogenKnowledge } from './pathogens.js';

export const MICROBE_DIGEST_ID = 'microbe-library';

/** Where a card's structure opens: an M1 pathogen entry or a microbe-
 *  library entry in the Protein route's Model mode, or an H7 capsid in
 *  its Capsid mode. */
export type StructureLink =
  | { kind: 'pathogen'; id: string; pdbId: string; label: string }
  | { kind: 'capsid'; key: string; pdbId: string; label: string }
  | { kind: 'microbe'; pdbId: string; label: string };

/** A reference a card was written from, with its licence (SPDX). */
export interface MicrobeReference {
  label: string;
  /** DOI (checked against Crossref at build time) or a PDB id */
  doi?: string;
  pdbId?: string;
  licence: 'CC-BY-4.0' | 'CC0-1.0';
}

export type MicrobeKind = 'virus-family' | 'bacterium';

export interface MicrobeCard {
  /** Short key used by the UI and the wire leg. */
  id: string;
  kind: MicrobeKind;
  /** Family or species name, as written in italics in print. */
  name: string;
  /** Virion or cell structure. */
  structure: string;
  genome: string;
  morphology: string;
  /** Gram stain (bacteria); for a virus, why it does not apply. */
  gram: string;
  examples: string[];
  structures: StructureLink[];
  /** Learn bundle ids (bundles.ts) that teach this microbe. */
  bundles: string[];
  /** Where the card's text comes from, and its licence (SPDX). */
  text: { source: string; licence: 'CC-BY-4.0' | 'MIT' };
  references: MicrobeReference[];
  entry: PathogenKnowledge;
}

const NO_GRAM = 'Not applicable: a virus has no cell wall to stain.';
const WRITTEN_HERE = { source: 'Written for Carys (this repository)', licence: 'MIT' } as const;
const K = (term: string, source: string, source_version: string): PathogenKnowledge =>
  ({ term, source, source_version, reviewed_by: null });
const ICTV = (family: string, authors: string, year: number, cite: string, doi: string): MicrobeReference =>
  ({ label: `ICTV Virus Taxonomy Profile: ${family} — ${authors} (${year}) ${cite}`, doi, licence: 'CC-BY-4.0' });
const PDB = (pdbId: string, what: string): MicrobeReference =>
  ({ label: `PDB ${pdbId}: ${what}`, pdbId, licence: 'CC0-1.0' });
const adapted = (family: string, authors: string, year: number) =>
  ({ source: `Adapted from the ICTV Virus Taxonomy Profile: ${family} (${authors}, ${year})`, licence: 'CC-BY-4.0' as const });

export const MICROBE_CARDS: MicrobeCard[] = [
  {
    id: 'picornaviridae',
    kind: 'virus-family',
    name: 'Picornaviridae',
    structure: 'Non-enveloped icosahedral capsid of 60 protomers, each of capsid proteins 1A–1D (VP4, VP2, VP3, VP1): T=1 with pseudo T=3 symmetry. The larger capsid proteins fold as eight-stranded "jelly roll" β-barrels.',
    genome: 'Positive-sense, non-segmented RNA of 6.7–10.1 kb with a poly(A) tail, one large open reading frame translated as a polyprotein from an internal ribosome entry site (IRES).',
    morphology: 'Small round virions, 30–32 nm across.',
    gram: NO_GRAM,
    examples: ['poliovirus (Enterovirus C)', 'rhinoviruses (common cold)', 'foot-and-mouth disease virus', 'hepatitis A virus'],
    structures: [
      { kind: 'capsid', key: 'polio', pdbId: '2PLV', label: 'poliovirus type 1 capsid' },
      { kind: 'capsid', key: 'rhino', pdbId: '4RHV', label: 'human rhinovirus 14 capsid' },
    ],
    bundles: [],
    text: adapted('Picornaviridae', 'Zell et al.', 2017),
    references: [
      ICTV('Picornaviridae', 'Zell R, Delwart E, et al.', 2017, 'J Gen Virol 98:2421–2422', '10.1099/jgv.0.000911'),
      PDB('2PLV', 'poliovirus type 1 Mahoney (Filman et al. 1989)'),
      PDB('4RHV', 'human rhinovirus 14 (Arnold et al. 1988)'),
    ],
    entry: K('Picornaviridae (virus family)', 'ICTV Virus Taxonomy Profile (J Gen Virol 2017)', 'doi:10.1099/jgv.0.000911'),
  },
  {
    id: 'caliciviridae',
    kind: 'virus-family',
    name: 'Caliciviridae',
    structure: 'Non-enveloped icosahedral capsid of 90 dimers of the major capsid protein VP1 on a T=3 lattice, with 32 cup-shaped depressions (calyx: cup).',
    genome: 'Single-stranded, positive-sense RNA of 7.4–8.3 kb, a protein (VPg) at its 5′ end and a poly(A) tail; the capsid protein is made from a subgenomic RNA.',
    morphology: 'Round virions 27–40 nm across; stable in the environment, enteric ones acid-stable.',
    gram: NO_GRAM,
    examples: ['human noroviruses (a leading cause of acute gastroenteritis)', 'sapoviruses', 'rabbit haemorrhagic disease virus (Lagovirus)', 'feline calicivirus (Vesivirus)'],
    structures: [{ kind: 'capsid', key: 'norwalk', pdbId: '1IHM', label: 'Norwalk virus capsid' }],
    bundles: [],
    text: adapted('Caliciviridae', 'Vinjé et al.', 2019),
    references: [
      ICTV('Caliciviridae', 'Vinjé J, Estes MK, et al.', 2019, 'J Gen Virol 100:1469–1470', '10.1099/jgv.0.001332'),
      PDB('1IHM', 'Norwalk virus capsid (Prasad et al. 1999)'),
    ],
    entry: K('Caliciviridae (virus family)', 'ICTV Virus Taxonomy Profile (J Gen Virol 2019)', 'doi:10.1099/jgv.0.001332'),
  },
  {
    id: 'polyomaviridae',
    kind: 'virus-family',
    name: 'Polyomaviridae',
    structure: 'Non-enveloped icosahedral capsid of 72 capsomers, each five molecules of the major capsid protein VP1, tied together by VP1\'s extended C-terminal arms (T=7d); minor capsid proteins line the inside.',
    genome: 'Circular double-stranded DNA of about 5 kbp, packed with the host cell\'s histones: an early region (regulatory proteins, large and small T antigen), a late region (capsid proteins) and a control region.',
    morphology: 'Round virions 40–45 nm across.',
    gram: NO_GRAM,
    examples: ['simian virus 40 (SV40)', 'JC polyomavirus', 'BK polyomavirus', 'Merkel cell polyomavirus (linked to Merkel cell carcinoma)'],
    structures: [{ kind: 'capsid', key: 'sv40', pdbId: '1SVA', label: 'SV40 capsid (958,980 atoms)' }],
    bundles: [],
    text: adapted('Polyomaviridae', 'Moens et al.', 2017),
    references: [
      ICTV('Polyomaviridae', 'Moens U, Calvignac-Spencer S, et al.', 2017, 'J Gen Virol 98:1159–1160', '10.1099/jgv.0.000839'),
      PDB('1SVA', 'simian virus 40 (Stehle et al. 1996)'),
    ],
    entry: K('Polyomaviridae (virus family)', 'ICTV Virus Taxonomy Profile (J Gen Virol 2017)', 'doi:10.1099/jgv.0.000839'),
  },
  {
    id: 'coronaviridae',
    kind: 'virus-family',
    name: 'Coronaviridae',
    structure: 'Enveloped, pleomorphic, roughly spherical virions studded with spike (S) protein — the "corona" of electron micrographs — with membrane (M) and envelope (E) proteins; inside, a loosely wound helical nucleocapsid of N protein and RNA.',
    genome: 'Positive-sense, monopartite RNA of 22–36 kb, capped and polyadenylated, among the largest RNA genomes; genes after the replicase are expressed from a nested set of subgenomic mRNAs.',
    morphology: 'Orthocoronavirus virions 80–160 nm across.',
    gram: NO_GRAM,
    examples: ['SARS-CoV-2 (COVID-19)', 'SARS coronavirus', 'MERS coronavirus', 'murine hepatitis virus'],
    structures: [
      { kind: 'pathogen', id: 'spike-ace2', pdbId: '6M0J', label: 'SARS-CoV-2 spike RBD bound to ACE2' },
      { kind: 'pathogen', id: 'rbd-antibody', pdbId: '6W41', label: 'SARS-CoV-2 RBD with antibody CR3022' },
    ],
    bundles: ['ace2-entry', 'antibody-block', 'organoid-context'],
    text: adapted('Coronaviridae 2023', 'Woo et al.', 2023),
    references: [
      ICTV('Coronaviridae 2023', 'Woo PCY, de Groot RJ, et al.', 2023, 'J Gen Virol 104:001843', '10.1099/jgv.0.001843'),
      PDB('6M0J', 'SARS-CoV-2 spike RBD with ACE2 (Lan et al. 2020)'),
      PDB('6W41', 'SARS-CoV-2 RBD with CR3022 (Yuan et al. 2020)'),
    ],
    entry: K('Coronaviridae (virus family)', 'ICTV Virus Taxonomy Profile (J Gen Virol 2023)', 'doi:10.1099/jgv.0.001843'),
  },
  {
    id: 'hepadnaviridae',
    kind: 'virus-family',
    name: 'Hepadnaviridae',
    structure: 'Enveloped virion: a lipid envelope carrying the surface antigen (HBsAg) around an icosahedral nucleocapsid of core protein (HBcAg), mostly 240 copies on a T=4 lattice (a smaller T=3 form has 180).',
    genome: 'Partially double-stranded, relaxed-circular DNA of about 3.2 kb, copied through an RNA intermediate by the viral reverse transcriptase.',
    morphology: 'Round virions about 42 nm across; infected cells also shed smaller empty spheres and filaments of surface antigen.',
    gram: NO_GRAM,
    examples: ['hepatitis B virus (humans)', 'duck hepatitis B virus', 'woodchuck hepatitis virus'],
    structures: [
      { kind: 'capsid', key: 'hbv', pdbId: '1QGT', label: 'hepatitis B virus core, whole T=4 capsid' },
      { kind: 'pathogen', id: 'hbv-capsid', pdbId: '1QGT', label: 'the same entry: its four quasi-equivalent monomers' },
    ],
    bundles: ['capsid-assembly'],
    text: WRITTEN_HERE,
    references: [PDB('1QGT', 'hepatitis B virus capsid (Wynne, Crowther & Leslie 1999)')],
    entry: K('Hepadnaviridae (virus family)', 'Carys (written here)', 'H8 2026-09-25'),
  },
  {
    id: 'escherichia-coli',
    kind: 'bacterium',
    name: 'Escherichia coli',
    structure: 'Gram-negative cell envelope: inner membrane, a thin peptidoglycan layer, and an outer membrane of lipopolysaccharide whose porins (such as OmpF, shown) let small molecules through.',
    genome: 'One circular chromosome of about 4.6 Mb (strain K-12), often with plasmids.',
    morphology: 'Straight rod about 0.5 × 2 µm; many strains motile by flagella all over the cell; facultative anaerobe.',
    gram: 'Gram-negative (pink): the thin peptidoglycan does not hold the crystal violet.',
    examples: ['part of the normal gut flora', 'urinary tract infections', 'diarrhoea (enterotoxigenic and Shiga-toxin-producing strains such as O157:H7)', 'neonatal meningitis'],
    structures: [{ kind: 'microbe', pdbId: '2OMF', label: 'OmpF porin of the outer membrane' }],
    bundles: [],
    text: WRITTEN_HERE,
    references: [PDB('2OMF', 'OmpF porin, E. coli K-12 (Cowan et al.)')],
    entry: K('Escherichia coli (bacterium)', 'Carys (written here)', 'H8 2026-09-25'),
  },
  {
    id: 'staphylococcus-aureus',
    kind: 'bacterium',
    name: 'Staphylococcus aureus',
    structure: 'Gram-positive wall: a thick peptidoglycan layer threaded with teichoic acids. Its toxin α-hemolysin (shown) assembles into a seven-subunit pore that punches host cell membranes.',
    genome: 'One circular chromosome of about 2.8 Mb, with plasmids and mobile elements (methicillin resistance travels on the SCCmec element).',
    morphology: 'Cocci about 1 µm across in grape-like clusters; non-motile; facultative anaerobe.',
    gram: 'Gram-positive (purple): the thick peptidoglycan holds the crystal violet.',
    examples: ['skin and soft-tissue infections, abscesses', 'pneumonia and bloodstream infection', 'food poisoning (enterotoxins)', 'MRSA (methicillin-resistant strains)'],
    structures: [{ kind: 'microbe', pdbId: '7AHL', label: 'α-hemolysin heptameric pore' }],
    bundles: [],
    text: WRITTEN_HERE,
    references: [PDB('7AHL', 'α-hemolysin pore (Song et al. 1996)')],
    entry: K('Staphylococcus aureus (bacterium)', 'Carys (written here)', 'H8 2026-09-25'),
  },
  {
    id: 'vibrio-cholerae',
    kind: 'bacterium',
    name: 'Vibrio cholerae',
    structure: 'Gram-negative envelope. Cholera toxin (shown) is an AB5 toxin: a ring of five B subunits binds ganglioside GM1 on gut cells and delivers the A subunit, which switches on adenylate cyclase so the cells pour out water and salt.',
    genome: 'Two circular chromosomes, about 3.0 Mb and 1.1 Mb; the toxin genes ride on a phage (CTXφ) in the chromosome.',
    morphology: 'Curved, comma-shaped rod with a single polar flagellum, fast-swimming; facultative anaerobe of brackish and salt water.',
    gram: 'Gram-negative (pink).',
    examples: ['cholera (serogroups O1 and O139): profuse watery diarrhoea'],
    structures: [{ kind: 'microbe', pdbId: '1XTC', label: 'cholera toxin, A and B subunits' }],
    bundles: [],
    text: WRITTEN_HERE,
    references: [PDB('1XTC', 'cholera toxin (Zhang et al. 1995)')],
    entry: K('Vibrio cholerae (bacterium)', 'Carys (written here)', 'H8 2026-09-25'),
  },
  {
    id: 'clostridium-botulinum',
    kind: 'bacterium',
    name: 'Clostridium botulinum',
    structure: 'Gram-positive wall; forms heat-resistant endospores. Botulinum neurotoxin A (shown) is made as one chain and cut in two: the heavy chain binds nerve endings and carries the light chain inside, a zinc protease that cuts SNAP-25 and stops acetylcholine release.',
    genome: 'One circular chromosome of about 3.9 Mb (strain ATCC 3502) and a small plasmid.',
    morphology: 'Rod with subterminal spores; obligate anaerobe.',
    gram: 'Gram-positive (purple).',
    examples: ['foodborne botulism', 'infant botulism', 'wound botulism', 'the toxin in medicine, in tiny doses'],
    structures: [{ kind: 'microbe', pdbId: '3BTA', label: 'botulinum neurotoxin serotype A' }],
    bundles: [],
    text: WRITTEN_HERE,
    references: [PDB('3BTA', 'botulinum neurotoxin serotype A (Lacy et al. 1998)')],
    entry: K('Clostridium botulinum (bacterium)', 'Carys (written here)', 'H8 2026-09-25'),
  },
  {
    id: 'bacillus-anthracis',
    kind: 'bacterium',
    name: 'Bacillus anthracis',
    structure: 'Gram-positive wall under a capsule of poly-γ-D-glutamic acid; forms endospores. Protective antigen (shown) binds host cells, forms a pore and carries lethal factor and edema factor inside.',
    genome: 'One circular chromosome of about 5.2 Mb and two plasmids: pXO1 (about 182 kb, the toxin genes) and pXO2 (about 96 kb, the capsule genes).',
    morphology: 'Large rods about 1 × 3–5 µm, in chains; non-motile; spores in soil.',
    gram: 'Gram-positive (purple).',
    examples: ['cutaneous anthrax', 'inhalational anthrax', 'gastrointestinal anthrax'],
    structures: [{ kind: 'microbe', pdbId: '1ACC', label: 'anthrax protective antigen' }],
    bundles: [],
    text: WRITTEN_HERE,
    references: [PDB('1ACC', 'anthrax protective antigen (Petosa et al. 1997)')],
    entry: K('Bacillus anthracis (bacterium)', 'Carys (written here)', 'H8 2026-09-25'),
  },
  {
    id: 'mycobacterium-tuberculosis',
    kind: 'bacterium',
    name: 'Mycobacterium tuberculosis',
    structure: 'A waxy wall of long mycolic acids over arabinogalactan and peptidoglycan. InhA (shown), an enzyme that builds mycolic acids, is the target of the drug isoniazid.',
    genome: 'One circular chromosome of about 4.4 Mb, rich in G and C (about 65%).',
    morphology: 'Slender rod about 2–4 µm; non-motile; obligate aerobe, dividing only about once a day.',
    gram: 'Acid-fast (Ziehl–Neelsen): the waxy wall keeps carbol fuchsin through acid alcohol; with the Gram stain it stains weakly or not at all.',
    examples: ['pulmonary tuberculosis', 'tuberculosis outside the lungs (lymph nodes, bone, meninges)', 'latent infection'],
    structures: [{ kind: 'microbe', pdbId: '1ENY', label: 'InhA, the isoniazid target' }],
    bundles: [],
    text: WRITTEN_HERE,
    references: [PDB('1ENY', 'InhA, enoyl-ACP reductase (Dessen et al. 1995)')],
    entry: K('Mycobacterium tuberculosis (bacterium)', 'Carys (written here)', 'H8 2026-09-25'),
  },
];

/** Look up a card by id. Null on unknown (caller loud). */
export function microbeById(id: string): MicrobeCard | null {
  return MICROBE_CARDS.find((c) => c.id === id) ?? null;
}

/** The bacterial PDB entries the microbe-library digest vendors, in card
 *  order. */
export function microbePdbIds(): string[] {
  return [...new Set(MICROBE_CARDS.flatMap((c) => c.structures)
    .filter((s) => s.kind === 'microbe').map((s) => s.pdbId))];
}
