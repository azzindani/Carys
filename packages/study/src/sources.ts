// Digest provenance foundation (BIO-ATLAS-ROADMAP §3 + §5 reuse ledger).
// Pure schemas + validators + registry helpers. No DOM, no fetch: digests
// are vendored bytes + SOURCES.json sidecars the app already holds.
//
// Prototype scope: this records *whose* knowledge each label came from and
// *under what license* each byte arrived — it never judges accuracy.
// Clinical accuracy needs expert review + QMS the static prototype does
// not carry.

/** Wire format id for SOURCES.json sidecars. Bump when the field set changes. */
export const SOURCES_FORMAT = 'carys-sources/1';
/** Legacy format id, still accepted on read (files written before the Carys rename). */
export const SOURCES_FORMAT_LEGACY = 'omniviewer-sources/1';
/** Wire format id for the repo-root digest registry. */
export const DIGESTS_FORMAT = 'carys-digests/1';
/** Legacy format id, still accepted on read (files written before the Carys rename). */
export const DIGESTS_FORMAT_LEGACY = 'omniviewer-digests/1';

/**
 * Badge every education overlay renders next to. The constant lives here
 * (engine-pure) so the A1 overlay and the report attribution page share one
 * string; measurement canvases never import it (quarantine rule).
 */
export const EDUCATION_BADGE = 'education overlay — not for diagnosis';

/** One provenance row in a digest's SOURCES.json. */
export interface DigestSource {
  source_url: string;
  /** Retrieval date, YYYY-MM-DD. */
  retrieved_date: string;
  /** SPDX id, or 'UNVERIFIED' until a human confirms the download page. */
  license_spdx: string;
  /** Version pin: commit SHA, release tag, or access date for live APIs. */
  version_pin: string;
  entry_count: number;
}

/** A digest directory's SOURCES.json sidecar. */
export interface SourcesFile {
  format: string;
  /** Digest dir name, e.g. 'z-anatomy-skeletal'. */
  digest: string;
  sources: DigestSource[];
}

export type DigestKind = 'digest' | 'reference' | 'tooling' | 'sidecar';
export type DigestStatus = 'shipped' | 'proposed' | 'blocked';

/** One row of the repo-root registry (BIO-ATLAS-ROADMAP §5 ledger). */
export interface DigestRecord {
  id: string;
  kind: DigestKind;
  license_spdx: string;
  /**
   * Human-reviewed exception note (e.g. idea-level reference with no
   * vendored bytes, or factual identifiers whose redistribution terms are
   * still unchecked). A non-empty note exempts the row from the
   * license-CI gate — the paper trail IS the compliance, and the note
   * names what is still owed. Absent for cleanly licensed rows.
   */
  license_note?: string;
  /** DEPEND | PORT | REFERENCE | TOOLING | SIDECAR | digest. */
  mode: string;
  /** Consuming lane, e.g. 'A1', 'leg-9g', 'T2'. */
  lane: string;
  status: DigestStatus;
  source_url: string;
}

/**
 * Versioned knowledge entry: every label/definition ships as one of these
 * so clinicians later correct versioned entries instead of bare strings.
 */
export interface KnowledgeEntry {
  term: string;
  source: string;
  source_version: string;
  /** Reviewer name/org, or null until expert review happens. */
  reviewed_by: string | null;
}

const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));

/** Fail-loud SOURCES.json check: a digest without valid provenance fails review. */
export function validateSourcesFile(raw: unknown): SourcesFile {
  const bad = (why: string): Error => new Error(`bad-sources-input: ${why}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('top level must be an object');
  const r = raw as Record<string, unknown>;
  if (r.format !== SOURCES_FORMAT && r.format !== SOURCES_FORMAT_LEGACY) {
    throw bad(`format ${JSON.stringify(r.format ?? null)} != ${SOURCES_FORMAT}`);
  }
  if (!r.digest || typeof r.digest !== 'string') throw bad('digest must be a non-empty string');
  if (!Array.isArray(r.sources) || r.sources.length === 0) throw bad('sources must be a non-empty array');
  r.sources.forEach((s, i) => {
    const o = s as Record<string, unknown>;
    if (!o || typeof o !== 'object') throw bad(`sources[${i}] must be an object`);
    if (!o.source_url || typeof o.source_url !== 'string') throw bad(`sources[${i}].source_url must be a non-empty string`);
    if (!isDate(o.retrieved_date)) throw bad(`sources[${i}].retrieved_date must be YYYY-MM-DD`);
    if (!o.license_spdx || typeof o.license_spdx !== 'string') throw bad(`sources[${i}].license_spdx must be a non-empty string`);
    if (!o.version_pin || typeof o.version_pin !== 'string') throw bad(`sources[${i}].version_pin must be a non-empty string`);
    if (!Number.isInteger(o.entry_count) || (o.entry_count as number) < 0) {
      throw bad(`sources[${i}].entry_count must be a non-negative int`);
    }
  });
  return r as unknown as SourcesFile;
}

/** Fail-loud knowledge-entry check: an unattributed label is a bug, not a default. */
export function validateKnowledgeEntry(raw: unknown): KnowledgeEntry {
  const bad = (why: string): Error => new Error(`bad-knowledge-input: ${why}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('top level must be an object');
  const r = raw as Record<string, unknown>;
  for (const k of ['term', 'source', 'source_version'] as const) {
    if (!r[k] || typeof r[k] !== 'string') throw bad(`${k} must be a non-empty string`);
  }
  if (r.reviewed_by !== null && (typeof r.reviewed_by !== 'string' || !r.reviewed_by)) {
    throw bad('reviewed_by must be null or a non-empty string');
  }
  return r as unknown as KnowledgeEntry;
}

/** Fail-loud registry-row check: the license-CI gate walks validated rows. */
export function validateDigestRecord(raw: unknown): DigestRecord {
  const bad = (why: string): Error => new Error(`bad-registry-input: ${why}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('record must be an object');
  const r = raw as Record<string, unknown>;
  if (!r.id || typeof r.id !== 'string') throw bad('id must be a non-empty string');
  if (!['digest', 'reference', 'tooling', 'sidecar'].includes(r.kind as string)) {
    throw bad(`kind must be digest|reference|tooling|sidecar, got ${JSON.stringify(r.kind ?? null)}`);
  }
  if (!r.license_spdx || typeof r.license_spdx !== 'string') throw bad('license_spdx must be a non-empty string');
  if (!r.mode || typeof r.mode !== 'string') throw bad('mode must be a non-empty string');
  if (!r.lane || typeof r.lane !== 'string') throw bad('lane must be a non-empty string');
  if (r.license_note !== undefined && (typeof r.license_note !== 'string' || !r.license_note)) {
    throw bad('license_note must be a non-empty string when present');
  }
  if (!['shipped', 'proposed', 'blocked'].includes(r.status as string)) {
    throw bad(`status must be shipped|proposed|blocked, got ${JSON.stringify(r.status ?? null)}`);
  }
  if (!r.source_url || typeof r.source_url !== 'string') throw bad('source_url must be a non-empty string');
  return r as unknown as DigestRecord;
}

/** Rows whose license is still unknown: proposed/blocked rows may sit here by design. */
export function missingLicenses(records: DigestRecord[]): DigestRecord[] {
  return records.filter((r) => !r.license_spdx || r.license_spdx === 'UNVERIFIED');
}

/**
 * License-CI gate: shipped rows must carry a verified license OR a
 * reviewed exception note. [] = pass; anything else names the rows that
 * must not ship. Proposed/blocked rows are exempt — UNVERIFIED is their
 * honest state until a human checks.
 */
export function unverifiedShipped(records: DigestRecord[]): DigestRecord[] {
  return records.filter(
    (r) => (!r.license_spdx || r.license_spdx === 'UNVERIFIED')
      && (!r.license_note || !r.license_note.trim())
      && r.status === 'shipped',
  );
}
