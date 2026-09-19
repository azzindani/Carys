// Ported from Mol* symbol-table/structure-query.ts shape + PDBe QueryHelper
// predicate folding (entity/chain/residue/atom conjunction). CPU-side filter
// over parsed coordinates. Full MolQL parser deferred; JSON shape mirrors it.
// parseMolQuery adds the human string form ("chain A and resi 10:20") over
// the same conjunction semantics: one clause per field, AND-combined.

import type { StructureModel } from './structure.js';

export type GeneratorKind = 'all' | 'atoms' | 'residues' | 'chains';

export interface AtomTest {
  chainLabel?: string;
  residueSeqId?: number | [number, number];
  atomName?: string;
  element?: string;
}

export interface MolQuery {
  generator: GeneratorKind;
  filter?: AtomTest;
}

export function runMolQuery(model: StructureModel, q: MolQuery): number[] {
  const h = model.hierarchy;
  const out: number[] = [];
  const f = q.filter ?? {};
  for (let i = 0; i < h.atoms.length; i++) {
    if (testAtom(h.atoms[i]!, f)) out.push(i);
  }
  return out;
}

type AtomLike = StructureModel['hierarchy']['atoms'][number];

function testAtom(a: AtomLike, f: AtomTest): boolean {
  if (f.chainLabel !== undefined && a.label_asym_id !== f.chainLabel && a.auth_asym_id !== f.chainLabel) {
    return false;
  }
  if (f.residueSeqId !== undefined) {
    if (typeof f.residueSeqId === 'number') {
      if (a.label_seq_id !== f.residueSeqId && a.auth_seq_id !== f.residueSeqId) return false;
    } else {
      const [lo, hi] = f.residueSeqId;
      const inLabel = a.label_seq_id >= lo && a.label_seq_id <= hi;
      const inAuth = a.auth_seq_id >= lo && a.auth_seq_id <= hi;
      if (!inLabel && !inAuth) return false;
    }
  }
  if (f.atomName !== undefined && a.label_atom_id !== f.atomName) return false;
  if (f.element !== undefined && a.type_symbol !== f.element) return false;
  return true;
}

export class MolqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MolqlError';
  }
}

/**
 * Human string form over the same conjunction: clauses joined by AND, one
 * clause per field max —
 *   "chain A and resi 10:20 and atom CA and element C"
 * Keywords are case-insensitive; values are exact (chain/atom/element ids
 * are case-sensitive upstream). resi takes INT or LO:HI (normalized either
 * direction, like bundleRange). Throws MolqlError on syntax errors.
 */
export function parseMolQuery(src: string): MolQuery {
  const toks = src.trim().split(/\s+/).filter((t) => t.length > 0);
  if (toks.length === 0) throw new MolqlError('empty query (want e.g. "chain A and resi 10:20")');
  const filter: AtomTest = {};
  const seen = new Set<string>();
  let i = 0;
  const takeValue = (field: string): string => {
    const v = toks[i + 1];
    if (v === undefined || v.toLowerCase() === 'and') throw new MolqlError(`"${field}" needs a value`);
    return v;
  };
  while (i < toks.length) {
    const field = toks[i]!.toLowerCase();
    if (field === 'and') throw new MolqlError(`stray "and" at clause ${seen.size + 1}`);
    if (!['chain', 'resi', 'atom', 'element'].includes(field)) {
      throw new MolqlError(`unknown field "${toks[i]}" (want chain|resi|atom|element)`);
    }
    if (seen.has(field)) throw new MolqlError(`duplicate "${field}" clause (clauses AND-combine)`);
    seen.add(field);
    const raw = takeValue(field);
    if (field === 'chain') filter.chainLabel = raw;
    else if (field === 'atom') filter.atomName = raw;
    else if (field === 'element') filter.element = raw;
    else {
      const m = /^(-?\d+)(:(-?\d+))?$/.exec(raw);
      if (!m) throw new MolqlError(`bad resi range "${raw}" (want INT or LO:HI)`);
      const lo = parseInt(m[1]!, 10);
      const hi = m[3] === undefined ? lo : parseInt(m[3]!, 10);
      filter.residueSeqId = lo <= hi ? (lo === hi ? lo : [lo, hi] as [number, number]) : [hi, lo] as [number, number];
    }
    i += 2;
    if (i < toks.length) {
      if (toks[i]!.toLowerCase() !== 'and') throw new MolqlError(`want "and" between clauses, found "${toks[i]}"`);
      i += 1;
      if (i === toks.length) throw new MolqlError('trailing "and" with no clause after it');
    }
  }
  return { generator: 'atoms', filter };
}

/** Parse + run in one call (same result as runMolQuery on the parsed form). */
export function runMolQueryString(model: StructureModel, src: string): number[] {
  return runMolQuery(model, parseMolQuery(src));
}

export type MolPredicate =
  | { kind: 'test'; test: AtomTest }
  | { kind: 'and'; parts: MolPredicate[] }
  | { kind: 'or'; parts: MolPredicate[] }
  | { kind: 'not'; part: MolPredicate };

function evalPredicate(p: MolPredicate, a: AtomLike): boolean {
  switch (p.kind) {
    case 'test': return testAtom(a, p.test);
    case 'and': return p.parts.every((q) => evalPredicate(q, a));
    case 'or': return p.parts.some((q) => evalPredicate(q, a));
    case 'not': return !evalPredicate(p.part, a);
  }
}

/** Evaluate a predicate tree over every atom (indices in hierarchy order). */
export function runMolPredicate(model: StructureModel, p: MolPredicate): number[] {
  const out: number[] = [];
  const atoms = model.hierarchy.atoms;
  for (let i = 0; i < atoms.length; i++) {
    if (evalPredicate(p, atoms[i]!)) out.push(i);
  }
  return out;
}

function parseResiRange(raw: string): number | [number, number] {
  const m = /^(-?\d+)(:(-?\d+))?$/.exec(raw);
  if (!m) throw new MolqlError(`bad resi range "${raw}" (want INT or LO:HI)`);
  const lo = parseInt(m[1]!, 10);
  const hi = m[3] === undefined ? lo : parseInt(m[3]!, 10);
  return lo <= hi ? (lo === hi ? lo : [lo, hi] as [number, number]) : [hi, lo] as [number, number];
}

/**
 * Boolean string form: field clauses (same values as parseMolQuery) joined
 * by AND/OR/NOT with parentheses. Precedence: NOT > AND > OR. Keywords
 * case-insensitive, values exact:
 *   "chain A and (resi 10:20 or resi 30) and not atom H"
 * Throws MolqlError on syntax errors.
 */
export function parseMolPredicate(src: string): MolPredicate {
  const toks = src.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/).filter((t) => t.length > 0);
  if (toks.length === 0) throw new MolqlError('empty query');
  let i = 0;
  const peek = (): string | undefined => toks[i];
  const next = (): string => toks[i++]!;
  const parseOr = (): MolPredicate => {
    const parts = [parseAnd()];
    while (peek()?.toLowerCase() === 'or') { next(); parts.push(parseAnd()); }
    return parts.length === 1 ? parts[0]! : { kind: 'or', parts };
  };
  const parseAnd = (): MolPredicate => {
    const parts = [parseUnary()];
    while (peek()?.toLowerCase() === 'and') { next(); parts.push(parseUnary()); }
    return parts.length === 1 ? parts[0]! : { kind: 'and', parts };
  };
  const parseUnary = (): MolPredicate => {
    if (peek()?.toLowerCase() === 'not') { next(); return { kind: 'not', part: parseUnary() }; }
    return parsePrimary();
  };
  const parsePrimary = (): MolPredicate => {
    if (peek() === '(') {
      next();
      if (peek() === ')') throw new MolqlError('empty parentheses');
      const p = parseOr();
      if (next() !== ')') throw new MolqlError('unclosed parenthesis (missing ")")');
      return p;
    }
    const tok = next();
    if (tok === undefined) throw new MolqlError('query ends mid-clause');
    const field = tok.toLowerCase();
    if (field === 'and' || field === 'or' || field === 'not' || field === ')') {
      throw new MolqlError(`stray "${field}" where a field was wanted`);
    }
    if (!['chain', 'resi', 'atom', 'element'].includes(field)) {
      throw new MolqlError(`unknown field "${field}" (want chain|resi|atom|element)`);
    }
    const raw = peek();
    if (raw === undefined || ['and', 'or', ')'].includes(raw.toLowerCase())) {
      throw new MolqlError(`"${field}" needs a value`);
    }
    next();
    if (field === 'chain') return { kind: 'test', test: { chainLabel: raw } };
    if (field === 'atom') return { kind: 'test', test: { atomName: raw } };
    if (field === 'element') return { kind: 'test', test: { element: raw } };
    return { kind: 'test', test: { residueSeqId: parseResiRange(raw) } };
  };
  const p = parseOr();
  if (i < toks.length) throw new MolqlError(`trailing "${toks[i]}" after query end`);
  return p;
}

/** Parse + run a boolean query in one call. */
export function runMolPredicateString(model: StructureModel, src: string): number[] {
  return runMolPredicate(model, parseMolPredicate(src));
}
