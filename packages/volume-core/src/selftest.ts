// K4 self-test mode: student quiz over vendored A1/A2/K1 content (name
// the structure, name the parent) plus E2/M4 bundle facts, attempts logged
// to the existing audit trail via the quiz.answer pattern. Zero diagnostic
// surface by construction: every answer is checkable against vendored
// bytes, never a judgment call.
//
// Bank shape (measured 2026-09-17): 47 structure questions (one per
// ATLAS_STRUCTURES entry, BP id + FMA id → term), 30 parent questions
// (only structures whose FMA id has a tree parent — the 15 without a
// tree node, e.g. patellae/sternum/rib batch, are excluded, never
// guessed), 18 bundle questions reused verbatim from DISEASE_BUNDLES.
// Total 90. Distractors are fixed-offset siblings, rotated so the answer
// is not always option 0; order is caller-seeded via shuffled().
//
// Ledger: no new digest bytes (A1/A2/K1/M1/E2 pins cover the bank); this
// lane ships the bank builder + seeded shuffle + grader. Prototype scope:
// study aid, never a credential — grading stays out by design.
//
// Dependency-free by design (mirrors bundles.ts/cohorts.ts): sibling
// imports only (atlas/terms/bundles are plain objects, no cycles); no
// DOM, no fetch — the caller installs the term/tree tables first (the
// tree lookups throw bad-tree-input when missing, never half-build).

import { ATLAS_STRUCTURES } from './atlas.js';
import { DISEASE_BUNDLES, quizAuditDetail } from './bundles.js';
import { isaAncestors, treeName } from './terms.js';

/** Question kind: atlas structure, IS-A parent, or bundle fact. */
export type SelfTestKind = 'structure' | 'parent' | 'bundle';

/** One self-test question with a checkable answer (no free text). */
export interface SelfTestQuestion {
  /** Stable key, e.g. 'selftest-struct-femur-r' (bundle reuse keeps q.id). */
  id: string;
  kind: SelfTestKind;
  /** The question text. */
  prompt: string;
  /** Answer options in display order. */
  options: string[];
  /** Index into options. */
  answer: number;
  /** Why this is right, in one teaching sentence. */
  rationale: string;
  /** Provenance line (digest pin or bundle card). */
  provenance: string;
}

/** Audit series for self-test attempts (reuses the quiz.answer action). */
export const SELFTEST_BUNDLE_ID = 'selftest';

const SELFTEST_PROVENANCE =
  'vendored A1/A2 atlas + K1 tree + E2/M4 bundles (education only — not for diagnosis)';

/** Deterministic PRNG (mulberry32): same seed → same question order. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle under a seeded PRNG. Returns a new array (input
 * untouched); same seed + same input = same order, always a permutation.
 */
export function shuffled<T>(rows: T[], seed: number): T[] {
  const out = [...rows];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Fail-loud question check: bad bank rows throw, never quiz silently. */
export function validateSelfTestQuestion(raw: unknown): SelfTestQuestion {
  const bad = (why: string): Error => new Error(`bad-selftest-input: ${why}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('top level must be an object');
  const r = raw as Record<string, unknown>;
  if (!r.id || typeof r.id !== 'string') throw bad('id must be a non-empty string');
  if (r.kind !== 'structure' && r.kind !== 'parent' && r.kind !== 'bundle') {
    throw bad(`${r.id} kind must be structure|parent|bundle`);
  }
  if (!r.prompt || typeof r.prompt !== 'string') throw bad(`${r.id} prompt must be a non-empty string`);
  if (!Array.isArray(r.options) || r.options.length < 2 || r.options.some((o) => typeof o !== 'string' || !o)) {
    throw bad(`${r.id} options must be ≥2 non-empty strings`);
  }
  if (new Set(r.options as string[]).size !== (r.options as string[]).length) {
    throw bad(`${r.id} options must be unique`);
  }
  if (!Number.isInteger(r.answer) || (r.answer as number) < 0 || (r.answer as number) >= (r.options as string[]).length) {
    throw bad(`${r.id} answer out of range`);
  }
  if (!r.rationale || typeof r.rationale !== 'string') throw bad(`${r.id} rationale must be a non-empty string`);
  if (!r.provenance || typeof r.provenance !== 'string') throw bad(`${r.id} provenance must be a non-empty string`);
  return r as unknown as SelfTestQuestion;
}

/** Rotate options left by salt: the correct answer moves with the index. */
function rotateOptions(options: string[], salt: number): { options: string[]; answer: number } {
  const n = options.length;
  const rot = ((salt % n) + n) % n;
  return {
    options: options.map((_, i) => options[(i + rot) % n]!),
    answer: (n - rot) % n,
  };
}

/**
 * Build the full self-test bank: 47 structure + 30 parent + 18 bundle
 * questions. Throws bad-tree-input when the tree table is not installed
 * (parent questions need it) — caller installs terms first, same as K1.
 */
export function buildSelfTestBank(): SelfTestQuestion[] {
  const bank: SelfTestQuestion[] = [];
  const structs = ATLAS_STRUCTURES;
  // Kind 1: name the structure from its BP + FMA ids; distractors are
  // fixed-offset siblings (offsets coprime to 47, never the correct term).
  structs.forEach((s, i) => {
    const distract = [11, 23, 37].map((o) => structs[(i + o) % structs.length]!.entry.term);
    const { options, answer } = rotateOptions([s.entry.term, ...distract], i);
    bank.push({
      id: `selftest-struct-${s.id}`,
      kind: 'structure',
      prompt: `Which structure is ${s.bpId} (${s.entry.source_version})?`,
      options,
      answer,
      rationale: `${s.entry.term} — ${s.bpId}, ${s.entry.source} ${s.entry.source_version}.`,
      provenance: SELFTEST_PROVENANCE,
    });
  });
  // Kind 2: name the IS-A parent; structures without a tree node are
  // excluded (their absence is visible in the bank counts, never guessed).
  const withParents = structs.filter((s) => isaAncestors(s.entry.source_version).length > 1);
  const pool = [...new Set(withParents.map((s) => {
    const pfma = isaAncestors(s.entry.source_version)[1]!;
    return treeName(pfma) ?? pfma;
  }))];
  withParents.forEach((s) => {
    const pfma = isaAncestors(s.entry.source_version)[1]!;
    const pname = treeName(pfma) ?? pfma;
    const start = pool.indexOf(pname);
    const distract: string[] = [];
    for (let k = 1; distract.length < 3 && k <= pool.length; k++) {
      const cand = pool[(start + k) % pool.length]!;
      if (cand !== pname && !distract.includes(cand)) distract.push(cand);
    }
    const { options, answer } = rotateOptions([pname, ...distract], bank.length);
    bank.push({
      id: `selftest-parent-${s.entry.source_version}`,
      kind: 'parent',
      prompt: `${s.entry.term} (${s.entry.source_version}) is a …?`,
      options,
      answer,
      rationale: `${s.entry.term} is a ${pname} (${pfma}).`,
      provenance: SELFTEST_PROVENANCE,
    });
  });
  // Kind 3: bundle facts verbatim (answers already pinned to digest bytes
  // by bundles.test.ts — reused here, never re-authored).
  for (const b of DISEASE_BUNDLES) {
    for (const q of b.quiz) {
      bank.push({
        id: q.id,
        kind: 'bundle',
        prompt: q.prompt,
        options: [...q.options],
        answer: q.answer,
        rationale: q.rationale,
        provenance: b.provenance.join(' · '),
      });
    }
  }
  for (const q of bank) validateSelfTestQuestion(q);
  return bank;
}

/** Grade one attempt: pure equality, no partial credit. */
export function gradeSelfTestAnswer(q: SelfTestQuestion, picked: number): boolean {
  return picked === q.answer;
}

/** Audit detail for a self-test attempt (reuses the greppable quiz line). */
export function selfTestAuditDetail(questionId: string, correct: boolean, picked: number): string {
  return quizAuditDetail(SELFTEST_BUNDLE_ID, questionId, correct, picked);
}
