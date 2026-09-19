// E2+M4 mechanism bundles: one teaching unit = structure (M1/M4) +
// pathway note + quiz (K4 pattern) with a provenance card per piece.
// E2 shipped the viral three (ace2/antibody/capsid); M4 adds the
// mechanism collections (celiac tripartite + birch allergen).
// Hand-authored from the M1 digest's own chain roles + contacts (not
// invented): each bundle names the pathogen entry, the teaching story in
// plain language, and quiz questions whose answers are checkable against
// vendored bytes (chain ids, contact counts, residue numbers).
//
// Ledger: no new digest bytes (M1 pins cover the structures); this lane
// ships the bundle index + quiz engine + audit logging. Prototype scope:
// teaching labels, never diagnosis; variant notes are positional
// highlights, never phenotype calls.
//
// Dependency-free by design (mirrors atlas.ts/pathogens.ts): entries are
// plain objects; study validates the audit action, app renders the cards.

/** One quiz question with checkable answers (no free text to grade). */
export interface BundleQuestion {
  /** Stable key, e.g. 'spike-ace2-q1'. */
  id: string;
  /** The question text. */
  prompt: string;
  /** Answer options in display order. */
  options: string[];
  /** Index into options. */
  answer: number;
  /** Why this is right, in one teaching sentence. */
  rationale: string;
}

/** One mechanism-of-disease teaching bundle. */
export interface DiseaseBundle {
  /** Short key used by the UI + wire leg (e.g. 'ace2-entry'). */
  id: string;
  /** Display title. */
  title: string;
  /** Pathogen entry id in PATHOGEN_STRUCTURES. */
  pathogenId: string;
  /** Plain-language mechanism story (2–4 sentences, no clinical claims). */
  story: string;
  /** Pathway steps in order (what happens first → last). */
  pathway: string[];
  /** Quiz questions (answers checkable against vendored bytes). */
  quiz: BundleQuestion[];
  /** Provenance card lines (digest pins + attribution). */
  provenance: string[];
}

export const DISEASE_BUNDLES: DiseaseBundle[] = [
  {
    // M2 infection-screen pairing: structure (6M0J) + host-cell context
    // (idr0083 organoids). Screen pixels stay remote + blosc-gated (the
    // catalog owns that honesty); this bundle teaches the pairing and
    // the screen's pinned facts (image ids, sizes, pixel size, store
    // URLs), never a phenotype claim about infected vs control fields.
    id: 'organoid-context',
    title: 'Where spike meets cells: SARS-CoV-2 organoid screen context',
    pathogenId: 'spike-ace2',
    story:
      'The spike–ACE2 dock (6M0J, 15 contacts) happens on cell surfaces — ' +
      'the host side lives in screen idr0083: SARS-CoV-2 infected human ' +
      'intestinal organoids, fields hSIOs-1 (image 9822151) and hSIOs-2 ' +
      '(image 9822152). Both fields are single-channel EM-scale tiles at ' +
      '~1nm/px; hSIOs-2 ships a v0.4 zarr mirror, hSIOs-1 a v0.1 mirror ' +
      'only. Open the structure, then open the screen from the Cells view.',
    pathway: [
      'Spike RBD (chain E) docks ACE2 (chain A) — 15 contacts, the ace2-entry bundle',
      'idr0083 fields show the host tissue that dock happens on (organoid tile context)',
      'Screen pixels stay remote + blosc-gated: the catalog names the codec, never fakes pixels',
    ],
    quiz: [
      {
        id: 'organoid-context-q1',
        prompt: 'Which IDR study holds the SARS-CoV-2 organoid fields?',
        options: ['idr0048A', 'idr0083-lamers-sarscov2', 'idr0013A'],
        answer: 1,
        rationale: 'idr0083-lamers-sarscov2 (project 1051): infected intestinal organoids.',
      },
      {
        id: 'organoid-context-q2',
        prompt: 'Field hSIOs-2 (image 9822152) is…',
        options: [
          '3-channel fluorescence',
          'Single-channel, 144384×93184 at ~1nm/px',
          'A 96-well plate',
        ],
        answer: 1,
        rationale: 'Single channel, 144384×93184, 0.996747nm/px (hSIOs-1 is 79360×167424).',
      },
      {
        id: 'organoid-context-q3',
        prompt: 'Opening the organoid store today…',
        options: [
          'Paints pixels immediately',
          'Fails loud: blosc/lz4 chunks need the P0 toolchain',
          'Requires a login',
        ],
        answer: 1,
        rationale: 'Both mirrors use blosc/lz4 chunks the CPU reader rejects by name.',
      },
    ],
    provenance: [
      'idr-screens · IDR-API-2026-09-17-idr0083 (CC-BY-4.0)',
      'rcsb-pathogens · PDB-6M0J-6W41-1QGT-4OZF-1BV1 (CC0-1.0)',
      'Fields + sizes read from the live IDR JSON API 2026-09-17; zarr mirror probed on the EBI bucket',
    ],
  },
  {
    id: 'ace2-entry',
    title: 'How SARS-CoV-2 enters cells: spike meets ACE2',
    pathogenId: 'spike-ace2',
    story:
      'The spike protein’s receptor-binding domain (RBD) docks onto the ' +
      'human ACE2 receptor. Entry 6M0J captures that docked moment in a ' +
      'crystal: chain E is the viral RBD, chain A is ACE2. Fifteen RBD ' +
      'residues sit within 8Å (CA–CA) of ACE2 — open the entry, press ' +
      'Contacts, and they select.',
    pathway: [
      'Spike RBD (chain E) approaches human ACE2 (chain A)',
      '15 RBD residues pack against ACE2 (the Contacts selection)',
      'Widely monitored positions (417, 484, 501, …) sit on or near that interface — press Variants to see where',
    ],
    quiz: [
      {
        id: 'ace2-entry-q1',
        prompt: 'In 6M0J, which chain is the viral spike RBD?',
        options: ['Chain A', 'Chain E', 'Both chains are viral'],
        answer: 1,
        rationale: 'Chain E is the spike RBD (residues 333–526); chain A is human ACE2 context.',
      },
      {
        id: 'ace2-entry-q2',
        prompt: 'How many RBD residues contact ACE2 (CA–CA < 8Å) in this digest?',
        options: ['9', '15', '22'],
        answer: 1,
        rationale: 'The digest measures 15 contacts; 22 is the antibody entry’s count.',
      },
      {
        id: 'ace2-entry-q3',
        prompt: 'Residue E:501 is…',
        options: [
          'An ACE2 contact that is also a monitored position',
          'Absent from the resolved RBD',
          'On the antibody entry, not this one',
        ],
        answer: 0,
        rationale: 'ASN501 is both in the 15-contact list and in the 9 monitored positions.',
      },
    ],
    provenance: [
      'rcsb-pathogens · PDB-6M0J-6W41-1QGT (CC0-1.0)',
      'Contacts measured offline 2026-09-17, CA–CA < 8Å',
    ],
  },
  {
    id: 'antibody-block',
    title: 'How antibodies block the RBD: CR3022’s grip',
    pathogenId: 'rbd-antibody',
    story:
      'Antibody CR3022 grips the RBD at a site away from the ACE2 ' +
      'interface — a cryptic epitope. Entry 6W41 shows chain C (RBD) held ' +
      'by chains H and L (heavy + light). Twenty-two RBD residues contact ' +
      'the antibody; compare with the 15 ACE2 contacts to see the two ' +
      'footprints differ.',
    pathway: [
      'RBD (chain C) presents the cryptic epitope',
      'CR3022 heavy (H) + light (L) chains close around it — 22 contacts',
      'The epitope barely overlaps the ACE2 footprint: different grip, different escape routes',
    ],
    quiz: [
      {
        id: 'antibody-block-q1',
        prompt: 'In 6W41, which chains form the antibody?',
        options: ['E + A', 'H + L', 'C + H'],
        answer: 1,
        rationale: 'H is the heavy chain, L the light chain; C is the RBD.',
      },
      {
        id: 'antibody-block-q2',
        prompt: 'How many RBD residues contact CR3022 in this digest?',
        options: ['15', '22', '4'],
        answer: 1,
        rationale: 'The digest measures 22 contacts; 15 is the ACE2 entry, 4 the capsid.',
      },
    ],
    provenance: [
      'rcsb-pathogens · PDB-6M0J-6W41-1QGT (CC0-1.0)',
      'Contacts measured offline 2026-09-17, CA–CA < 8Å',
    ],
  },
  {
    id: 'celiac-tcr',
    title: 'Why gluten triggers celiac disease: HLA-DQ8 presents, T cells see',
    pathogenId: 'celiac-tcr',
    story:
      'In celiac disease, the immune protein HLA-DQ8 presents a fragment ' +
      'of gluten (deamidated gliadin peptide) and a T-cell receptor reads ' +
      'it — a three-part complex. Entry 4OZF captures all three: chains ' +
      'A/B are HLA-DQ8, chain J is the 14-residue peptide lying in the ' +
      'groove (13 residues contact it), chains G/H are the JR5.1 TCR ' +
      'reaching in (12 contact residues). Open the entry, press Contacts.',
    pathway: [
      'HLA-DQ8 (chains A/B) holds the deamidated gliadin peptide (chain J) in its groove — 13 groove contacts',
      'JR5.1 TCR alpha (G) + beta (H) dock onto HLA + peptide — 12 contact residues',
      'Three parts, one complex: presentation + recognition in a single crystal',
    ],
    quiz: [
      {
        id: 'celiac-tcr-q1',
        prompt: 'In 4OZF, which chain is the gluten peptide?',
        options: ['Chain B', 'Chain H', 'Chain J'],
        answer: 2,
        rationale: 'Chain J is the 14-residue deamidated gliadin-alpha2 peptide; B is HLA beta, H is TCR beta.',
      },
      {
        id: 'celiac-tcr-q2',
        prompt: 'How many peptide residues contact the HLA groove (CA–CA < 8Å)?',
        options: ['4', '13', '25'],
        answer: 1,
        rationale: 'The digest measures 13 of 14 peptide residues in groove contact; 25 is the whole contact list.',
      },
      {
        id: 'celiac-tcr-q3',
        prompt: 'The TCR in this complex is…',
        options: [
          'A single chain',
          'Alpha (G) + beta (H) chains',
          'The same molecule as the peptide',
        ],
        answer: 1,
        rationale: 'JR5.1 TCR alpha (G) + beta (H) dock onto HLA + peptide together.',
      },
    ],
    provenance: [
      'rcsb-pathogens · PDB-6M0J-6W41-1QGT-4OZF-1BV1 (CC0-1.0)',
      'Contacts measured offline 2026-09-17, CA–CA < 8Å (4GG6 probed: peptide undocked, stays out)',
    ],
  },
  {
    id: 'birch-pollen',
    title: 'What makes birch pollen allergenic: Bet v 1 up close',
    pathogenId: 'birch-allergen',
    story:
      'Bet v 1 is the major birch-pollen allergen: a small single-chain ' +
      'protein (159 residues) that sensitized immune systems mistake for ' +
      'danger. Entry 1BV1 resolves the whole chain alone — no complex, no ' +
      'epitope mapped here. The Contacts selection marks three backbone ' +
      'landmarks (N terminus, mid-chain, C terminus) for orientation, ' +
      'never epitopes: epitope mapping needs IgE data the digest omits.',
    pathway: [
      'Single Bet v 1 chain (A, 159 residues) folds into the allergen scaffold',
      'Backbone landmarks orient the view (1, 80, 159) — not epitopes',
      'Real epitope maps come from IgE-binding studies, a future digest',
    ],
    quiz: [
      {
        id: 'birch-pollen-q1',
        prompt: 'How many chains does 1BV1 resolve?',
        options: ['One', 'Four', 'Ten'],
        answer: 0,
        rationale: 'Single chain A, 159 residues; four is the capsid, ten the rejected 4GG6 copy count.',
      },
      {
        id: 'birch-pollen-q2',
        prompt: 'The Contacts selection on Bet v 1 marks…',
        options: [
          'Three IgE epitopes',
          'Three backbone landmarks for orientation',
          'The HLA groove',
        ],
        answer: 1,
        rationale: 'Landmarks only — epitope mapping needs IgE data the digest does not carry.',
      },
    ],
    provenance: [
      'rcsb-pathogens · PDB-6M0J-6W41-1QGT-4OZF-1BV1 (CC0-1.0)',
      'Residue ranges read from parsed residues 2026-09-17',
    ],
  },
  {
    // D5 NIH 3D mechanism pairing: the capsid shell (1QGT) is the NIH 3D
    // printable-model archetype (classroom HBV capsid prints exist); this
    // bundle teaches the assembly a print shows: four monomers, spike-tip
    // landmarks, no ligand interface to misread. Per-model license recorded
    // at ingest per the D5 contract (NIH 3D portal terms: CC0-1.0 PDB
    // geometry, same pin as the M1 digest — no new bytes vendored).
    id: 'capsid-assembly',
    title: 'How HBV builds its shell: four monomers, one capsid',
    pathogenId: 'hbv-capsid',
    story:
      'Hepatitis B capsid protein (HBcAg) assembles into a shell from ' +
      'repeated monomers — the same assembly NIH 3D ships as a classroom ' +
      'print. Entry 1QGT shows four quasi-equivalent monomers ' +
      '(chains A–D, residues 1–142/143). There is no single ligand ' +
      'interface here — the Contacts selection marks the spike-tip ASP78 ' +
      'on each monomer, the landmark of the assembled spikes.',
    pathway: [
      'Four HBcAg monomers (chains A–D) pack quasi-equivalently (the print shows this shell)',
      'Each monomer contributes a spike; ASP78 marks every spike tip',
      'Repeated spikes tile into the closed capsid shell',
    ],
    quiz: [
      {
        id: 'capsid-assembly-q1',
        prompt: 'How many monomers does 1QGT resolve?',
        options: ['Two', 'Four', 'Sixty'],
        answer: 1,
        rationale: 'Chains A–D: four quasi-equivalent monomers in the asymmetric unit.',
      },
      {
        id: 'capsid-assembly-q2',
        prompt: 'What does the Contacts selection mark on the capsid?',
        options: [
          'A ligand-binding pocket',
          'Spike-tip ASP78 on each monomer',
          'Variant-note positions',
        ],
        answer: 1,
        rationale: 'No ligand interface exists; contacts mark ASP78 on all four monomers.',
      },
      {
        id: 'capsid-assembly-q3',
        prompt: 'Pressing Variants on the capsid entry…',
        options: [
          'Highlights 9 positions',
          'Reports no variant-note sites, loudly',
          'Selects chain A only',
        ],
        answer: 1,
        rationale: 'The capsid entry carries no variant sites by design; the UI says so.',
      },
    ],
    provenance: [
      'rcsb-pathogens · PDB-6M0J-6W41-1QGT (CC0-1.0)',
      'Monomer ranges read from parsed residues 2026-09-17',
      'D5 NIH 3D pairing: assembly facts = M1 digest bytes (CC0-1.0, no new bytes); print pairing per NIH 3D portal terms',
    ],
  },
  {
    // D5 second bundle: the allergen scaffold (1BV1) is the NIH 3D
    // allergy-collection archetype (Bet v 1 classroom models exist); this
    // bundle teaches what a print of a single-chain allergen can and
    // cannot show: fold landmarks yes, IgE epitopes never.
    id: 'allergen-scaffold',
    title: 'What an allergen print shows (and hides): Bet v 1 scaffold',
    pathogenId: 'birch-allergen',
    story:
      'Bet v 1 prints ship in NIH 3D allergy collections as single-chain ' +
      'scaffolds. Entry 1BV1 resolves that scaffold alone (chain A, 159 ' +
      'residues) — the Contacts selection marks three backbone landmarks ' +
      'for orientation, never epitopes. A print shows the fold; epitope ' +
      'maps need IgE-binding studies the digest omits by design.',
    pathway: [
      'Single Bet v 1 chain folds into the allergen scaffold (the print shows this fold)',
      'Backbone landmarks orient the view (1, 80, 159) — not epitopes',
      'Real epitope maps come from IgE-binding studies, a future digest',
    ],
    quiz: [
      {
        id: 'allergen-scaffold-q1',
        prompt: 'A 3D print of Bet v 1 (1BV1) shows…',
        options: ['The fold scaffold', 'Three IgE epitopes', 'The HLA groove'],
        answer: 0,
        rationale: 'The print shows the single-chain fold; epitopes need IgE data the digest omits.',
      },
      {
        id: 'allergen-scaffold-q2',
        prompt: 'How many chains does 1BV1 resolve?',
        options: ['One', 'Four', 'Ten'],
        answer: 0,
        rationale: 'Single chain A, 159 residues — the scaffold is one chain.',
      },
    ],
    provenance: [
      'rcsb-pathogens · PDB-6M0J-6W41-1QGT-4OZF-1BV1 (CC0-1.0)',
      'Residue ranges read from parsed residues 2026-09-17',
      'D5 NIH 3D pairing: scaffold facts = M1 digest bytes (CC0-1.0, no new bytes); print pairing per NIH 3D portal terms',
    ],
  },
];

/** Look up a bundle by UI id. Null on unknown (caller stays loud). */
export function bundleById(id: string): DiseaseBundle | null {
  return DISEASE_BUNDLES.find((b) => b.id === id) ?? null;
}

/** Quiz audit detail line (stable, greppable): bundle + question + verdict. */
export function quizAuditDetail(bundleId: string, questionId: string, correct: boolean, picked: number): string {
  return `quiz ${bundleId}/${questionId} picked=${picked} ${correct ? 'correct' : 'wrong'}`;
}
