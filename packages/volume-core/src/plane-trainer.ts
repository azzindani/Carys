// E1 plane-anatomy trainer: MPR sliders drive labeled diagrams (A4 cards)
// with audit-logged attempts (K4 pattern). The engine half is pure:
// drill prompts ("which plane / which third is this?") generated from the
// PLANE_CARDS index, answers graded by equality, attempts logged as
// quiz.answer on the planetrainer series — zero diagnostic surface, the
// same contract as the E2 bundle quiz and the K4 self-test deck.
//
// Ledger: no new digest bytes (A4 cards already pinned); this lane ships
// the drill generator + grader. Prototype scope: orientation study aid,
// never a credential — grading stays out by design.
//
// Dependency-free by design (mirrors selftest.ts): plain objects; the app
// feeds live slider fractions, the drill answers with card facts.

import { PLANE_CARDS, planeCardByPlane, type AtlasPlane } from './plane-atlas.js';

/** One plane-trainer drill prompt with a checkable answer. */
export interface PlaneDrill {
  /** Stable key, e.g. 'planetrainer-axial-mid'. */
  id: string;
  /** Which plane the drill shows. */
  plane: AtlasPlane;
  /** Slider fraction the drill shows (thirds midpoint). */
  frac: number;
  /** The prompt text. */
  prompt: string;
  /** Answer options in display order. */
  options: string[];
  /** Index into options. */
  answer: number;
  /** Why this is right, in one teaching sentence. */
  rationale: string;
}

/** Audit series for plane-trainer attempts (reuses the quiz.answer action). */
export const PLANETRAINER_SERIES = 'planetrainer';

/** Thirds midpoints: low 1/6, mid 1/2, high 5/6 — inside each third band. */
const THIRD_FRACS = [1 / 6, 1 / 2, 5 / 6] as const;
const THIRD_KEYS = ['low', 'mid', 'high'] as const;

/**
 * Build the full drill set: one "which third?" drill per plane (3 planes
 * × 3 thirds = 9) plus one "which plane?" drill per plane from its mid
 * third (3). Total 12. Distractors are fixed: the other two thirds, or
 * the other two planes. Options rotate by index so the answer moves.
 */
export function buildPlaneDrills(): PlaneDrill[] {
  const drills: PlaneDrill[] = [];
  PLANE_CARDS.forEach((card, ci) => {
    THIRD_FRACS.forEach((frac, ti) => {
      const third = card.thirds[ti]!;
      const key = THIRD_KEYS[ti]!;
      const others = [0, 1, 2].filter((t) => t !== ti).map((t) => card.thirds[t]!);
      const options = [third, ...others];
      const rot = (ci * 3 + ti) % 3;
      drills.push({
        id: `planetrainer-${card.plane}-${key}`,
        plane: card.plane,
        frac,
        prompt: `The ${card.plane} slider sits at ${key} third — which landmarks do you expect?`,
        options: options.map((_, i) => options[(i + rot) % options.length]!),
        answer: (3 - rot) % 3,
        rationale: `${card.title}: ${third}.`,
      });
    });
    const peers = PLANE_CARDS.filter((c) => c.plane !== card.plane).map((c) => c.title);
    const options = [card.title, ...peers];
    const rot = ci % 3;
    drills.push({
      id: `planetrainer-which-${card.plane}`,
      plane: card.plane,
      frac: 1 / 2,
      prompt: 'Which plane cuts like this: "' + card.cuts + '"?',
      options: options.map((_, i) => options[(i + rot) % options.length]!),
      answer: (3 - rot) % 3,
      rationale: `${card.title} — ${card.cuts}`,
    });
  });
  for (const d of drills) validatePlaneDrill(d);
  return drills;
}

/** Fail-loud drill check: bad rows throw, never drill silently. */
export function validatePlaneDrill(raw: unknown): PlaneDrill {
  const bad = (why: string): Error => new Error(`bad-planetrainer-input: ${why}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('top level must be an object');
  const r = raw as Record<string, unknown>;
  if (!r.id || typeof r.id !== 'string') throw bad('id must be a non-empty string');
  if (!planeCardByPlane(r.plane as string)) throw bad(`${r.id} plane must be axial|coronal|sagittal`);
  if (typeof r.frac !== 'number' || !Number.isFinite(r.frac) || (r.frac as number) < 0 || (r.frac as number) > 1) {
    throw bad(`${r.id} frac must be in [0,1]`);
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
  return r as unknown as PlaneDrill;
}

/** Grade one drill attempt: pure equality, no partial credit. */
export function gradePlaneDrill(d: PlaneDrill, picked: number): boolean {
  return picked === d.answer;
}
