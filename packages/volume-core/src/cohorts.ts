// K3 teaching cohorts + E3 case-based cohorts + X3 worklist cohorts:
// curated case lists over data the app already
// holds (catalog series + M1 pathogen entries + E2 bundles) as
// education worklist entries. Reuses the existing read-status flow
// (readState/markReading/markRead/signRead) and the audit trail —
// the education PACS without a server.
//
// Ledger: no new digest bytes (catalog + M1 + E2 pins cover the cases);
// this lane ships the cohort index + progress helpers. Prototype scope:
// teaching cases, never diagnosis; cohort completion is a study aid,
// never a credential.
//
// Dependency-free by design (mirrors bundles.ts): plain objects; study
// owns status, app renders rows. E3/X3 add difficulty ordering: each case
// carries a 1-3 difficulty (1 = identify, 2 = compare, 3 = reason) and
// cohorts stay sorted easy-first; cohortDifficultyRange() exposes the
// span so the worklist can label it without reading every case.

/** Where a cohort case opens. */
export type CohortTarget =
  | { kind: 'series'; key: string }
  | { kind: 'pathogen'; id: string }
  | { kind: 'bundle'; id: string };

/** One teaching case inside a cohort. */
export interface CohortCase {
  /** Stable key, e.g. 'lung-nodule'. */
  id: string;
  /** Display title. */
  title: string;
  /** What to look at / do, in one teaching sentence. */
  task: string;
  /** Open target (series, pathogen entry, or bundle). */
  target: CohortTarget;
  /** Difficulty 1 (identify) → 2 (compare) → 3 (reason). Cohorts sort easy-first. */
  difficulty: 1 | 2 | 3;
}

/** One teaching cohort: ordered cases + provenance. */
export interface TeachingCohort {
  /** Short key used by the UI + wire leg (e.g. 'chest-basics'). */
  id: string;
  /** Display title. */
  title: string;
  /** Cohort blurb (who it's for, one sentence). */
  blurb: string;
  /** Cases in study order (easy first). */
  cases: CohortCase[];
  /** Provenance card lines. */
  provenance: string[];
}

export const TEACHING_COHORTS: TeachingCohort[] = [
  {
    id: 'chest-basics',
    title: 'Chest reading basics',
    blurb: 'First-week chest cases: nodule, infection, and a normal cardiac series.',
    cases: [
      {
        id: 'cardiac-cine',
        title: 'Cardiac cine loop',
        task: 'Scrub the 4D cardiac series and watch one full cycle.',
        target: { kind: 'series', key: 'cardiac-4d-cine' },
        difficulty: 1 as 1 | 2 | 3,
      },
      {
        id: 'lung-nodule',
        title: 'Lung nodule on CT',
        task: 'Open the lung CT, window it, and measure the nodule’s long axis.',
        target: { kind: 'series', key: 'lung-ct-dicom' },
        difficulty: 2 as 1 | 2 | 3,
      },
      {
        id: 'covid-opacities',
        title: 'COVID opacities with mask',
        task: 'Compare the COVID chest image against its segmentation mask.',
        target: { kind: 'series', key: 'covid-chest-seg' },
        difficulty: 2 as 1 | 2 | 3,
      },
    ],
    provenance: ['catalog series (repo samples)', 'read-status flow reused'],
  },
  {
    id: 'pathogen-stories',
    title: 'Pathogen structure stories',
    blurb: 'M1/M4 structures + E2/M4 bundles in study order: entry, block, assembly, celiac, allergen.',
    cases: [
      {
        id: 'spike-ace2',
        title: 'Spike meets ACE2 (6M0J)',
        task: 'Open the structure, press Contacts, then answer the bundle quiz.',
        target: { kind: 'bundle', id: 'ace2-entry' },
        difficulty: 1 as 1 | 2 | 3,
      },
      {
        id: 'birch-allergen',
        title: 'Bet v 1 allergen (1BV1)',
        task: 'Orient by the three backbone landmarks; note they are not epitopes.',
        target: { kind: 'bundle', id: 'birch-pollen' },
        difficulty: 1 as 1 | 2 | 3,
      },
      {
        id: 'cr3022-grip',
        title: 'CR3022 antibody grip (6W41)',
        task: 'Compare the 22-contact epitope against the 15-contact ACE2 footprint.',
        target: { kind: 'bundle', id: 'antibody-block' },
        difficulty: 2 as 1 | 2 | 3,
      },
      {
        id: 'hbv-shell',
        title: 'HBV capsid shell (1QGT)',
        task: 'Find ASP78 on all four monomers, then confirm Variants stays loud.',
        target: { kind: 'bundle', id: 'capsid-assembly' },
        difficulty: 2 as 1 | 2 | 3,
      },
      {
        id: 'celiac-complex',
        title: 'HLA-DQ8 presents gluten (4OZF)',
        task: 'Count the 13 groove contacts, then the 12 TCR contacts.',
        target: { kind: 'bundle', id: 'celiac-tcr' },
        difficulty: 3 as 1 | 2 | 3,
      },
      {
        // M2: structure + host-cell context in one teaching step.
        id: 'organoid-pair',
        title: 'Spike + organoid screen (6M0J + idr0083)',
        task: 'Answer the organoid bundle quiz, then open the screen from the Cells IDR picker and read the blosc gate.',
        target: { kind: 'bundle', id: 'organoid-context' },
        difficulty: 3 as 1 | 2 | 3,
      },
    ],
    provenance: ['rcsb-pathogens · PDB-6M0J-6W41-1QGT-4OZF-1BV1 (CC0-1.0)', 'E2+M4 bundles', 'idr-screens · idr0083 (CC-BY-4.0)'],
  },
  {
    // E3/X3: residency-difficulty ladder — identify → compare → reason,
    // one case per rung across the atlas, trainer, and QC lanes.
    id: 'residency-ladder',
    title: 'Residency ladder',
    blurb: 'Ordered by difficulty: name it, measure it, clear it for the lab.',
    cases: [
      {
        id: 'ladder-name',
        title: 'Name the plane third (E1)',
        task: 'Open Learn, answer the first plane drill: which third do you expect?',
        target: { kind: 'bundle', id: 'ace2-entry' },
        difficulty: 1 as 1 | 2 | 3,
      },
      {
        id: 'ladder-measure',
        title: 'Measure the PR sum (E4)',
        task: 'Open Learn, grade the RECIST-PR trainer case at 30mm + PR.',
        target: { kind: 'bundle', id: 'antibody-block' },
        difficulty: 2 as 1 | 2 | 3,
      },
      {
        id: 'ladder-clear',
        title: 'Clear the lab QC (Q1–Q4)',
        task: 'Open Studies, read the QC panel: phantom pass, dose unrecorded, compression unvalidated.',
        target: { kind: 'series', key: 'lung-ct-dicom' },
        difficulty: 3 as 1 | 2 | 3,
      },
    ],
    provenance: ['E1 plane drills', 'E4 trainer cases', 'Q1–Q4 QC registry'],
  },
  {
    id: 'skeleton-walk',
    title: 'Skeleton walk',
    blurb: 'A2 atlas tour: long bones, ribs, pelvis, skull — search + tree.',
    cases: [
      {
        id: 'long-bones',
        title: 'Long-bone picker tour',
        task: 'Open the atlas, pick femur then humerus, read the FMA term rows.',
        target: { kind: 'series', key: 'skull-ct-bone' },
        difficulty: 1 as 1 | 2 | 3,
      },
      {
        id: 'rib-search',
        title: 'Rib search + IS-A walk',
        task: 'Search “rib cage” in the atlas and read the neighbourhood status.',
        target: { kind: 'series', key: 'skull-ct-bone' },
        difficulty: 2 as 1 | 2 | 3,
      },
    ],
    provenance: ['bodyparts3d-longbones (CC-BY-4.0)', 'FMA tree (K1/A2)'],
  },
];

/** Look up a cohort by UI id. Null on unknown (caller stays loud). */
export function cohortById(id: string): TeachingCohort | null {
  return TEACHING_COHORTS.find((c) => c.id === id) ?? null;
}

/**
 * Cohort progress over a read-status snapshot: per-case status keyed by a
 * stable case key (series key / pathogen id / bundle id — the same keys
 * the read-status flow already tracks for series, extended by convention
 * to pathogen/bundle ids). Returns completed/total + per-case statuses.
 */
export function cohortProgress(
  cohort: TeachingCohort,
  statusOf: (key: string) => string,
): { done: number; total: number; cases: { id: string; status: string }[] } {
  const cases = cohort.cases.map((c) => {
    const key = c.target.kind === 'series' ? c.target.key : c.target.id;
    const status = statusOf(key);
    return { id: c.id, status };
  });
  const done = cases.filter((c) => c.status === 'read' || c.status === 'signed').length;
  return { done, total: cases.length, cases };
}

/** Difficulty span of a cohort: [min, max] over case difficulties. */
export function cohortDifficultyRange(cohort: TeachingCohort): [number, number] {
  const ds = cohort.cases.map((c) => c.difficulty);
  return [Math.min(...ds), Math.max(...ds)];
}

/** Fail-loud cohort check: difficulties must be 1|2|3 and non-decreasing
 *  (easy-first); violations name the case. */
export function validateCohortOrder(cohort: TeachingCohort): void {
  cohort.cases.forEach((c, i) => {
    if (c.difficulty !== 1 && c.difficulty !== 2 && c.difficulty !== 3) {
      throw new Error(`bad-cohort-order: ${cohort.id}/${c.id} difficulty ${c.difficulty} must be 1|2|3`);
    }
    if (i > 0 && c.difficulty < cohort.cases[i - 1]!.difficulty) {
      throw new Error(`bad-cohort-order: ${cohort.id}/${c.id} breaks easy-first order`);
    }
  });
}

/** Case audit detail line (stable, greppable). */
export function cohortAuditDetail(cohortId: string, caseId: string, action: string): string {
  return `cohort ${cohortId}/${caseId} ${action}`;
}
