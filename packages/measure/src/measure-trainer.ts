// E4 measurement trainer: known-answer public cases where students measure
// (RECIST/delta lanes) and compare against published values —
// tolerance-banded, never pass/fail on diagnosis. The engine half is pure:
// trainer cases with published values + tolerance bands, attempts graded
// by band membership, attempts logged as quiz.answer on the
// measuretrainer series (K4 pattern). Zero diagnostic surface: bands are
// arithmetic facts about the published numbers, never judgments.
//
// Ledger: no new digest bytes (RECIST/delta math + phantom fixture
// already pinned); this lane ships the case index + grader. Prototype
// scope: measurement study aid, never a credential — grading stays out.
//
// Dependency-free by design (mirrors plane-trainer.ts): plain objects;
// the app feeds the student's measured numbers, the grader answers.

import { targetSum, type RecistCategory } from './recist.js';

/** One known-answer measurement case. */
export interface TrainerCase {
  /** Stable key, e.g. 'measuretrainer-recist-pr'. */
  id: string;
  /** Display title. */
  title: string;
  /** What to do, in one teaching sentence. */
  task: string;
  /** Measurement kind: a RECIST sum pair or a single length. */
  kind: 'recist-sum' | 'length';
  /** Published value(s): lesion axes in mm (RECIST) or length in mm. */
  published: number[];
  /** Tolerance band half-width in mm (±tol counts as agreement). */
  toleranceMm: number;
  /** Expected RECIST category (recist-sum only; null for plain lengths). */
  expectedCategory: RecistCategory | null;
  /** Provenance line (which lane/math the answer comes from). */
  provenance: string;
}

/** Audit series for measurement-trainer attempts (quiz.answer action). */
export const MEASURETRAINER_SERIES = 'measuretrainer';

export const TRAINER_CASES: TrainerCase[] = [
  {
    id: 'measuretrainer-recist-pr',
    title: 'RECIST partial response: 45mm → 30mm',
    task: 'Sum the current target lesions (20 + 10mm) and compare against the 45mm baseline: which category?',
    kind: 'recist-sum',
    published: [20, 10],
    toleranceMm: 1,
    expectedCategory: 'PR',
    provenance: 'assessRecist (PR ≥30% drop): baseline 45, nadir 45, current 30 → −33.3%',
  },
  {
    id: 'measuretrainer-recist-sd',
    title: 'RECIST stable disease: 45mm → 40mm',
    task: 'Sum the current target lesions (25 + 15mm): which category?',
    kind: 'recist-sum',
    published: [25, 15],
    toleranceMm: 1,
    expectedCategory: 'SD',
    provenance: 'assessRecist (−11.1% vs baseline, +0% vs nadir): neither PR nor PD → SD',
  },
  {
    id: 'measuretrainer-recist-pd',
    title: 'RECIST progressive disease: 30mm → 40mm + 5mm floor',
    task: 'Nadir sum is 30mm; current sums to 40mm (+33%, +10mm): which category?',
    kind: 'recist-sum',
    published: [22, 18],
    toleranceMm: 1,
    expectedCategory: 'PD',
    provenance: 'assessRecist (+33.3% vs nadir AND +10mm ≥ 5mm floor → PD)',
  },
  {
    id: 'measuretrainer-length-phantom',
    title: 'Phantom insert width: 4 voxels at 0.5mm',
    task: 'The R1 phantom insert spans 4 voxels at 0.5mm spacing — what length should the length tool read?',
    kind: 'length',
    published: [2.0],
    toleranceMm: 0.1,
    expectedCategory: null,
    provenance: 'phantom-qc.dcm geometry (4×0.5mm); tolerance ±0.1mm',
  },
];

/** Look up a trainer case by id. Null on unknown (caller stays loud). */
export function trainerCaseById(id: string): TrainerCase | null {
  return TRAINER_CASES.find((c) => c.id === id) ?? null;
}

/**
 * Grade a student's measured sum against the published case: agreement =
 * |measured − published| ≤ tolerance. RECIST cases additionally check the
 * student's category pick against the expected category. Returns the
 * verdict + the numbers so the UI teaches, never just scores.
 */
export function gradeTrainerCase(
  c: TrainerCase,
  measuredSum: number,
  pickedCategory: RecistCategory | null,
): { agree: boolean; publishedSum: number; diff: number } {
  if (!Number.isFinite(measuredSum)) throw new RangeError(`measuretrainer-bad-measure: ${measuredSum}`);
  const publishedSum = targetSum(c.published.map((longAxis) => ({ longAxis })));
  const diff = measuredSum - publishedSum;
  let agree = Math.abs(diff) <= c.toleranceMm;
  if (c.kind === 'recist-sum') {
    if (pickedCategory !== c.expectedCategory) agree = false;
  }
  return { agree, publishedSum, diff };
}

/** Fail-loud case check: bad rows throw, never train silently. */
export function validateTrainerCase(raw: unknown): TrainerCase {
  const bad = (why: string): Error => new Error(`bad-measuretrainer-input: ${why}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('top level must be an object');
  const r = raw as Record<string, unknown>;
  if (!r.id || typeof r.id !== 'string') throw bad('id must be a non-empty string');
  if (!r.title || typeof r.title !== 'string') throw bad(`${r.id} title must be a non-empty string`);
  if (!r.task || typeof r.task !== 'string') throw bad(`${r.id} task must be a non-empty string`);
  if (r.kind !== 'recist-sum' && r.kind !== 'length') throw bad(`${r.id} kind must be recist-sum|length`);
  if (!Array.isArray(r.published) || r.published.length === 0
    || r.published.some((v) => typeof v !== 'number' || !Number.isFinite(v) || (v as number) < 0)) {
    throw bad(`${r.id} published must be a non-empty array of non-negative numbers`);
  }
  if (typeof r.toleranceMm !== 'number' || !Number.isFinite(r.toleranceMm) || (r.toleranceMm as number) < 0) {
    throw bad(`${r.id} toleranceMm must be a non-negative number`);
  }
  if (r.kind === 'recist-sum') {
    if (!['CR', 'PR', 'SD', 'PD'].includes(r.expectedCategory as string)) {
      throw bad(`${r.id} expectedCategory must be CR|PR|SD|PD`);
    }
  } else if (r.expectedCategory !== null) {
    throw bad(`${r.id} length cases carry expectedCategory null`);
  }
  if (!r.provenance || typeof r.provenance !== 'string') throw bad(`${r.id} provenance must be a non-empty string`);
  return r as unknown as TrainerCase;
}
