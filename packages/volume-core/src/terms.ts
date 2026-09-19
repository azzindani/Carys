// K1 ontology term service: one engine-pure module serving versioned
// anatomical terms. Every label in the atlas lanes resolves through it so
// renames propagate and provenance is uniform.
//
// Data: BodyParts3D PART-OF + IS-A mapping files (CC-BY-4.0, see
// digests/bodyparts3d-terms/SOURCES.json), vendored as a slim table:
// FMA id -> [english name, PART-OF BP id|null, PART-OF member files[]].
// Only concepts with PART-OF members are vendored (1368) — those are the
// ones renderable from today's mesh digest; IS-A-only concepts arrive
// with the A2 mesh set, not as dead rows.
//
// Ledger row: bodyparts3d-terms, CC-BY-4.0, mode digest, lane K1, status
// shipped. Prototype scope: names + membership for teaching; never
// diagnosis. No DOM, no fetch — the table is injected once via
// installTermTable (tests + app bootstrap), never imported as JSON, so
// the module stays dependency-free and bundler-safe.

// Digest pin recorded alongside the mesh digest pin when terms resolve.
export const TERMS_DIGEST_ID = 'bodyparts3d-terms';
export const TERMS_DIGEST_PIN = 'BP3D-4.0-partof+isa-lists';

/** One resolved term: FMA id + English name + PART-OF representation. */
export interface OntologyTerm {
  /** FMA concept id, e.g. 'FMA24474'. */
  fma: string;
  /** English preferred name from the mapping files. */
  name: string;
  /** PART-OF representation id (BP…), or null for ISA-only concepts. */
  bpId: string | null;
  /** PART-OF element files (FJ…), empty when not renderable today. */
  members: string[];
}

/** Slim row shape in the vendored terms.json. */
export type TermRow = [name: string, bpId: string | null, members: string[]];

let TABLE: Record<string, TermRow> = {};

/**
 * Install the vendored term table (parsed terms.json). Called once by
 * tests + the app bootstrap before any lookup. Re-installs replace the
 * table wholesale — last write wins, no merging.
 */
export function installTermTable(rows: Record<string, TermRow>): void {
  TABLE = rows;
}

function rowToTerm(fma: string, row: TermRow): OntologyTerm {
  return { fma, name: row[0], bpId: row[1], members: [...row[2]] };
}

/** Fail-loud row check: a corrupt vendored table throws, never half-loads. */
export function validateTermTable(rows: unknown): Record<string, TermRow> {
  const bad = (why: string): Error => new Error(`bad-terms-input: ${why}`);
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) throw bad('top level must be an object');
  const r = rows as Record<string, unknown>;
  const ids = Object.keys(r);
  if (ids.length === 0) throw bad('table must not be empty');
  for (const [fma, row] of Object.entries(r)) {
    if (!/^FMA\d+$/.test(fma)) throw bad(`bad FMA id ${JSON.stringify(fma)}`);
    if (!Array.isArray(row) || row.length !== 3) throw bad(`${fma} must be a [name, bpId, members] triple`);
    const [name, bpId, members] = row as unknown[];
    if (!name || typeof name !== 'string') throw bad(`${fma} name must be a non-empty string`);
    if (bpId !== null && (typeof bpId !== 'string' || !bpId)) throw bad(`${fma} bpId must be null or a non-empty string`);
    if (!Array.isArray(members) || members.some((m) => typeof m !== 'string' || !m)) {
      throw bad(`${fma} members must be an array of non-empty strings`);
    }
  }
  return r as Record<string, TermRow>;
}

/** Resolve an FMA id to its term. Null when unknown (caller stays loud). */
export function termByFma(fma: string): OntologyTerm | null {
  const row = TABLE[fma];
  return row ? rowToTerm(fma, row) : null;
}

/** Resolve a PART-OF representation id (BP…) to its term. Null on miss. */
export function termByBpId(bpId: string): OntologyTerm | null {
  for (const [fma, row] of Object.entries(TABLE)) {
    if (row[1] === bpId) return rowToTerm(fma, row);
  }
  return null;
}

/**
 * Case-insensitive substring search over English names + FMA ids.
 * Empty/blank queries return [] (never the whole table). Bounded to
 * `limit` hits in FMA-id order for determinism.
 */
export function searchTerms(query: string, limit = 25): OntologyTerm[] {
  const q = query.trim().toLowerCase();
  if (!q || limit <= 0) return [];
  const hits: OntologyTerm[] = [];
  for (const fma of Object.keys(TABLE).sort()) {
    const row = TABLE[fma]!;
    if (row[0].toLowerCase().includes(q) || fma.toLowerCase().includes(q)) {
      hits.push(rowToTerm(fma, row));
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/** Renderable concepts only (non-empty PART-OF members). Count, not rows. */
export function renderableCount(): number {
  return Object.values(TABLE).filter((r) => r[2].length > 0).length;
}

// --- A2 FMA tree service: IS-A ancestry + PART-OF children over the
// vendored tree.json (99 nodes covering the bone teaching spine).
// Same injection pattern as the term table: installTreeTable once,
// lookups are pure. Unknown ids are null (caller stays loud).

export interface TreeNode {
  name: string;
  parent?: string | null;
  children: string[];
}

export interface TreeData {
  isa: Record<string, TreeNode>;
  partof_children: Record<string, string[]>;
}

let TREE: TreeData | null = null;

/** Install the vendored tree (parsed tree.json). Re-installs replace. */
export function installTreeTable(data: TreeData): void {
  TREE = data;
}

/** Fail-loud tree check: corrupt tables throw, never half-load. */
export function validateTreeTable(data: unknown): TreeData {
  const bad = (why: string): Error => new Error(`bad-tree-input: ${why}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('top level must be an object');
  const d = data as Record<string, unknown>;
  if (!d.isa || typeof d.isa !== 'object' || Array.isArray(d.isa)) throw bad('isa must be an object');
  if (!d.partof_children || typeof d.partof_children !== 'object' || Array.isArray(d.partof_children)) {
    throw bad('partof_children must be an object');
  }
  const isa = d.isa as Record<string, unknown>;
  if (Object.keys(isa).length === 0) throw bad('isa must not be empty');
  for (const [fma, node] of Object.entries(isa)) {
    if (!/^FMA\d+$/.test(fma)) throw bad(`bad FMA id ${JSON.stringify(fma)}`);
    const n = node as Record<string, unknown>;
    if (!n || typeof n !== 'object') throw bad(`${fma} must be an object`);
    if (!n.name || typeof n.name !== 'string') throw bad(`${fma} name must be a non-empty string`);
    if (n.parent !== undefined && n.parent !== null && (typeof n.parent !== 'string' || !/^FMA\d+$/.test(n.parent))) {
      throw bad(`${fma} parent must be an FMA id, null, or absent`);
    }
    if (!Array.isArray(n.children) || n.children.some((c) => typeof c !== 'string' || !/^FMA\d+$/.test(c))) {
      throw bad(`${fma} children must be FMA-id strings`);
    }
  }
  return d as unknown as TreeData;
}

function needTree(): TreeData {
  if (!TREE) throw new Error('bad-tree-input: tree table not installed (call installTreeTable first)');
  return TREE;
}

/** IS-A parent chain from the concept up to the vendored root (concept first). */
export function isaAncestors(fma: string): string[] {
  const tree = needTree();
  if (!tree.isa[fma]) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = fma;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = tree.isa[cur]?.parent ?? undefined;
  }
  return out;
}

/** IS-A children of a concept ([] when leaf or unknown — caller stays loud via term lookup). */
export function isaChildren(fma: string): string[] {
  return [...(needTree().isa[fma]?.children ?? [])];
}

/** PART-OF children of a compound (rib cage, pelvis sides). Absent compounds read []. */
export function partofChildren(fma: string): string[] {
  return [...(needTree().partof_children[fma] ?? [])];
}

/** Tree node name (falls back to the term table name when outside the 99). */
export function treeName(fma: string): string | null {
  const t = needTree().isa[fma];
  if (t) return t.name;
  const row = TABLE[fma];
  return row ? row[0] : null;
}

// --- K2 glossary: definition + source + version for any FMA id. Every
// fact derives from vendored tables (tree.json + terms.json) — no
// invented prose. Unknown ids are null (caller stays loud).

/** One glossary card: what the tables say about a concept. */
export interface GlossaryCard {
  /** FMA id, e.g. 'FMA9611'. */
  fma: string;
  /** English name. */
  name: string;
  /** "X is a <parent>" (null when the cut has no parent). */
  parent: { fma: string; name: string } | null;
  /** IS-A children (FMA ids, tree order). */
  children: string[];
  /** PART-OF children (FMA ids). */
  partof: string[];
  /** Vendored member files (FJ…, without extension). */
  members: string[];
  /** Source line: archive + pin. */
  source: string;
}

const GLOSSARY_SOURCE = 'BodyParts3D 4.0 PART-OF+IS-A lists · BP3D-4.0-partof+isa-lists (CC-BY-4.0)';

/** Build the glossary card for an FMA id. Null when unknown to both tables. */
export function glossaryCard(fma: string): GlossaryCard | null {
  const tree = needTree();
  const node = tree.isa[fma];
  const row = TABLE[fma];
  if (!node && !row) return null;
  const name = node?.name ?? row![0];
  const parentFma = node?.parent ?? undefined;
  const parent = parentFma
    ? { fma: parentFma, name: tree.isa[parentFma]?.name ?? TABLE[parentFma]?.[0] ?? parentFma }
    : null;
  return {
    fma,
    name,
    parent,
    children: [...(node?.children ?? [])],
    partof: [...(tree.partof_children[fma] ?? [])],
    members: [...(row?.[2] ?? [])],
    source: GLOSSARY_SOURCE,
  };
}
