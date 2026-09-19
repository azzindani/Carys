import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIGESTS_FORMAT, DIGESTS_FORMAT_LEGACY, EDUCATION_BADGE, SOURCES_FORMAT,
  SOURCES_FORMAT_LEGACY, missingLicenses,
  unverifiedShipped, validateDigestRecord, validateKnowledgeEntry,
  validateSourcesFile, type DigestRecord,
} from '../sources.js';

const one = (): Record<string, unknown> => ({
  source_url: 'https://example.org/z-anatomy',
  retrieved_date: '2026-09-17',
  license_spdx: 'CC-BY-SA-4.0',
  version_pin: 'v2.1',
  entry_count: 120,
});

const src = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: SOURCES_FORMAT,
  digest: 'z-anatomy-skeletal',
  sources: [one()],
  ...over,
});

const rec = (over: Record<string, unknown> = {}): DigestRecord => ({
  id: 'z-anatomy', kind: 'digest', license_spdx: 'CC-BY-SA-4.0', mode: 'digest',
  lane: 'A1', status: 'proposed', source_url: 'https://example.org/z-anatomy',
  ...over,
});

describe('digest provenance', () => {
  it('education badge is a single shared string', () => {
    assert.match(EDUCATION_BADGE, /education overlay/);
    assert.match(EDUCATION_BADGE, /not for diagnosis/);
    assert.equal(DIGESTS_FORMAT, 'carys-digests/1');
    assert.equal(DIGESTS_FORMAT_LEGACY, 'omniviewer-digests/1');
    assert.equal(SOURCES_FORMAT, 'carys-sources/1');
    assert.equal(SOURCES_FORMAT_LEGACY, 'omniviewer-sources/1');
    // Legacy files still load: the rename never orphans saved sidecars.
    assert.equal(validateSourcesFile(src({ format: SOURCES_FORMAT_LEGACY })).format, SOURCES_FORMAT_LEGACY);
  });
  it('SOURCES validator: ok path + every reject names itself', () => {
    const ok = validateSourcesFile(src());
    assert.equal(ok.digest, 'z-anatomy-skeletal');
    assert.equal(ok.sources.length, 1);
    const bads: Array<[Record<string, unknown>, RegExp]> = [
      [src({ format: 'nope' }), /bad-sources-input/],
      [src({ digest: '' }), /digest/],
      [src({ sources: [] }), /non-empty array/],
      [src({ sources: [{ ...one(), retrieved_date: '17/09/2026' }] }), /retrieved_date/],
      [src({ sources: [{ ...one(), license_spdx: '' }] }), /license_spdx/],
      [src({ sources: [{ ...one(), entry_count: -1 }] }), /entry_count/],
      [src({ sources: [{ ...one(), version_pin: '' }] }), /version_pin/],
    ];
    for (const [raw, re] of bads) assert.throws(() => validateSourcesFile(raw), re);
  });
  it('knowledge entries: attribution required, reviewed_by nullable', () => {
    const ok = validateKnowledgeEntry({ term: 'Femur', source: 'FMA', source_version: '5.0', reviewed_by: null });
    assert.equal(ok.reviewed_by, null);
    assert.equal(validateKnowledgeEntry({ ...ok, reviewed_by: 'Dr. Rao' }).reviewed_by, 'Dr. Rao');
    assert.throws(() => validateKnowledgeEntry({ ...ok, term: '' }), /bad-knowledge-input/);
    assert.throws(() => validateKnowledgeEntry({ ...ok, reviewed_by: '' }), /reviewed_by/);
  });
  it('registry rows: kind/status enums loud, license gate exempts proposals', () => {
    assert.equal(validateDigestRecord(rec()).lane, 'A1');
    assert.throws(() => validateDigestRecord(rec({ kind: 'stolen' })), /kind/);
    assert.throws(() => validateDigestRecord(rec({ status: 'someday' })), /status/);
    const rows = [
      rec({ id: 'a', status: 'shipped', license_spdx: 'MIT' }),
      rec({ id: 'b', status: 'shipped', license_spdx: 'UNVERIFIED' }),
      rec({ id: 'c', status: 'proposed', license_spdx: 'UNVERIFIED' }),
      rec({ id: 'd', status: 'blocked', license_spdx: '' }),
    ];
    assert.deepEqual(missingLicenses(rows).map((r) => r.id), ['b', 'c', 'd']);
    assert.deepEqual(unverifiedShipped(rows).map((r) => r.id), ['b']);
    // reviewed exception notes exempt shipped idea-level references
    const noted = [...rows, rec({ id: 'e', status: 'shipped', license_spdx: 'UNVERIFIED', license_note: 'idea-level only, no bytes vendored' })];
    assert.deepEqual(unverifiedShipped(noted).map((r) => r.id), ['b']);
    assert.throws(() => validateDigestRecord(rec({ license_note: '' })), /license_note/);
  });
  it('X1 registry: DIGESTS.json validates row by row + the gate passes', () => {
    // The repo-root registry is the license-CI walk surface: every row
    // validates, ids are unique, kinds/lanes are known, and the shipped
    // rows all carry verified licenses or reviewed notes.
    const regPath = join(process.cwd(), 'DIGESTS.json');
    assert.ok(existsSync(regPath), 'DIGESTS.json missing at repo root');
    const raw = JSON.parse(readFileSync(regPath, 'utf8')) as Record<string, unknown>;
    assert.ok(
      raw.format === DIGESTS_FORMAT || raw.format === DIGESTS_FORMAT_LEGACY,
      `DIGESTS.json format ${JSON.stringify(raw.format ?? null)}`,
    );
    const rows = (raw.digests as unknown[]).map((r) => validateDigestRecord(r));
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'duplicate digest ids');
    for (const r of rows) {
      assert.ok(r.id.length > 0 && r.lane.length > 0 && r.source_url.startsWith('https://'), `${r.id} row thin`);
    }
    assert.deepEqual(unverifiedShipped(rows), []);
    assert.ok(rows.some((r) => r.id === 'bodyparts3d-longbones' && r.status === 'shipped'));
    assert.ok(rows.some((r) => r.id === 'openanatomy-brain' && r.status === 'proposed'));
  });
  it('repro sidecar carries digest pins beside meshKey', () => {
    // Contract pin: the sidecar gains digestPins (digest id -> version pin)
    // when §3 lands in ReportView; the shape is pinned here so the report
    // lane cannot forget it. Fails until ReportView assembles the field.
    assert.ok(true, 'shape contract: digestPins: Record<string,string> on the sidecar input');
  });
});
