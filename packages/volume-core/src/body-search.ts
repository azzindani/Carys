// Whole-body atlas search (H2, docs/PHASES.md): a query to the BodyParts3D
// element meshes it names, before any of their system files is fetched.
// The body digest's index lists every part (element, own FMA concept, name,
// system); the K1 term table (terms.ts, installed by the app) knows which
// elements make up a PART-OF concept, so "heart" finds its 83 pieces, not
// a part called "heart". Pure: rows in, element ids out.
import { searchTerms, termByFma, termsWithMember, type OntologyTerm } from './terms.js';

/** One part of the body digest's index. */
export interface BodyRow {
  /** BodyParts3D element mesh id (FJ…) */
  element: string;
  /** its own FMA concept */
  fma: string;
  name: string;
  system: string;
}

export interface BodyFind {
  /** what was found, for the readout */
  label: string;
  /** the element meshes, in index order */
  elements: string[];
}

/** K1 concepts searched for a name match: all of them. */
const ALL_TERMS = 5000;

/**
 * The parts a query names. In order: an element id; an FMA id (the parts of
 * that concept, or the parts that are it); a concept named exactly so; parts
 * named exactly so; parts whose name holds it; parts whose element id holds
 * it; the first concept whose name holds it and has parts here. Null when
 * nothing does (the caller says so).
 */
export function findBodyStructures(rows: readonly BodyRow[], query: string): BodyFind | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const inIndex = (els: readonly string[]): string[] => {
    const want = new Set(els);
    return rows.filter((r) => want.has(r.element)).map((r) => r.element);
  };
  const byConcept = (t: OntologyTerm | null): BodyFind | null => {
    if (!t) return null;
    const els = inIndex(t.members);
    return els.length ? { label: `${t.name} (${t.fma})`, elements: els } : null;
  };
  const el = rows.find((r) => r.element.toLowerCase() === q);
  if (el) return { label: `${el.name} (${el.element})`, elements: [el.element] };
  if (/^fma\d+$/.test(q)) {
    const fma = q.toUpperCase();
    const own = rows.filter((r) => r.fma === fma);
    return byConcept(termByFma(fma)) ?? (own.length ? { label: `${own[0]!.name} (${fma})`, elements: own.map((r) => r.element) } : null);
  }
  const terms = searchTerms(q, ALL_TERMS);
  const exact = byConcept(terms.find((t) => t.name.toLowerCase() === q) ?? null);
  if (exact) return exact;
  const named = rows.filter((r) => r.name.toLowerCase() === q);
  if (named.length) return { label: named[0]!.name, elements: named.map((r) => r.element) };
  const holding = rows.filter((r) => r.name.toLowerCase().includes(q));
  if (holding.length) return { label: `"${query.trim()}"`, elements: holding.map((r) => r.element) };
  // an HRA part's element names its organ ("lung-male/…"): its segments do not
  const organ = rows.filter((r) => r.element.toLowerCase().includes(q));
  if (organ.length) return { label: `"${query.trim()}"`, elements: organ.map((r) => r.element) };
  for (const t of terms) {
    const hit = byConcept(t);
    if (hit) return hit;
  }
  return null;
}

/** The K1 concepts an element is part of, smallest first and without its
 *  own concept: what a tapped piece belongs to ("hepatovenous segment iv" →
 *  anterior sector of left liver, left hemiliver, liver, …). Empty for the
 *  elements BodyParts3D places in no PART-OF tree. */
export function conceptsOfElement(element: string, own: string, limit = 10): OntologyTerm[] {
  return termsWithMember(element)
    .filter((t) => t.fma !== own)
    .sort((a, b) => a.members.length - b.members.length || (a.fma < b.fma ? -1 : 1))
    .slice(0, limit);
}
