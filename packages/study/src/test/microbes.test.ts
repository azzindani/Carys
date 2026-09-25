// H8 microbiology library: every card names its source and licence, every
// licence is one the library may take (CC BY 4.0 or CC0 adapted, or MIT
// for text written here), every structure and bundle it links to exists,
// and the build's checks (Crossref licences, PDB first authors, source
// organisms) are on record for every reference and entry.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  DISEASE_BUNDLES, MICROBE_CARDS, MICROBE_DIGEST_ID, PATHOGEN_STRUCTURES, microbeById, microbePdbIds,
  parseAssemblyCif,
} from '@carys/volume-core';
import { parseCif } from '@carys/io';
import { validateDigestRecord, validateKnowledgeEntry, validateSourcesFile } from '../sources.js';

const ROOT = process.cwd();
const DIR = join(ROOT, 'digests', MICROBE_DIGEST_ID);
const lib = JSON.parse(readFileSync(join(DIR, 'library.json'), 'utf8')) as {
  format: string; pin: string; cards: number;
  structures: { pdbId: string; file: string; card: string; sha256: string; title: string; organism: string; atoms: number }[];
  references: { doi?: string; pdbId?: string; firstAuthor: string; licenceUrl?: string }[];
};
const capsids = JSON.parse(readFileSync(join(ROOT, 'digests', 'rcsb-capsids', 'capsids.json'), 'utf8')) as {
  entries: { key: string; pdbId: string }[];
};

describe('H8 microbiology library', () => {
  it('holds five virus families and six bacteria, ids unique', () => {
    assert.equal(MICROBE_CARDS.filter((c) => c.kind === 'virus-family').length, 5);
    assert.equal(MICROBE_CARDS.filter((c) => c.kind === 'bacterium').length, 6);
    assert.equal(new Set(MICROBE_CARDS.map((c) => c.id)).size, MICROBE_CARDS.length);
    assert.equal(microbeById('vibrio-cholerae')?.name, 'Vibrio cholerae');
    assert.equal(microbeById('nope'), null);
    assert.equal(lib.cards, MICROBE_CARDS.length);
  });

  it('every card names its source and licence, and fills every field', () => {
    for (const c of MICROBE_CARDS) {
      assert.ok(c.text.source.length > 10, `${c.id} source`);
      assert.ok(c.text.licence === 'CC-BY-4.0' || c.text.licence === 'MIT', `${c.id} licence ${c.text.licence}`);
      for (const f of [c.structure, c.genome, c.morphology, c.gram]) assert.ok(f.length > 10, `${c.id}: ${f}`);
      assert.ok(c.examples.length > 0, `${c.id} examples`);
      assert.ok(c.references.length > 0, `${c.id} references`);
      // adapted text cites the CC BY source it was adapted from
      if (c.text.licence === 'CC-BY-4.0') assert.ok(c.references.some((r) => r.doi && r.licence === 'CC-BY-4.0'), c.id);
      if (c.kind === 'bacterium') assert.match(c.gram, /^(Gram-positive|Gram-negative|Acid-fast)/, c.id);
      else assert.match(c.gram, /^Not applicable/, c.id);
      const back = validateKnowledgeEntry({ ...c.entry });
      assert.equal(back.reviewed_by, null);
    }
  });

  it('links only to structures and bundles that exist', () => {
    const bundles = new Set(DISEASE_BUNDLES.map((b) => b.id));
    for (const c of MICROBE_CARDS) {
      assert.ok(c.structures.length > 0, `${c.id} has no structure`);
      for (const s of c.structures) {
        if (s.kind === 'pathogen') assert.equal(PATHOGEN_STRUCTURES.find((p) => p.id === s.id)?.pdbId, s.pdbId, `${c.id} → ${s.id}`);
        else if (s.kind === 'capsid') assert.equal(capsids.entries.find((e) => e.key === s.key)?.pdbId, s.pdbId, `${c.id} → ${s.key}`);
        else assert.ok(lib.structures.some((x) => x.pdbId === s.pdbId && x.card === c.id), `${c.id} → ${s.pdbId}`);
        // and every structure a card opens is among its references
        assert.ok(c.references.some((r) => r.pdbId === s.pdbId), `${c.id} does not cite ${s.pdbId}`);
      }
      for (const b of c.bundles) assert.ok(bundles.has(b), `${c.id} → bundle ${b}`);
    }
  });

  it('every reference was checked at build time: CC BY 4.0 DOIs, PDB first authors', () => {
    for (const c of MICROBE_CARDS) {
      for (const r of c.references) {
        const rec = lib.references.find((x) => (r.doi ? x.doi === r.doi : x.pdbId === r.pdbId));
        assert.ok(rec, `${c.id}: ${r.label} not checked`);
        assert.ok(r.label.includes(rec.firstAuthor), `${r.label} vs ${rec.firstAuthor}`);
        if (r.doi) assert.match(rec.licenceUrl ?? '', /creativecommons\.org\/licenses\/by\/4\.0/);
      }
    }
  });

  it('vendors the bacterial entries as RCSB serves them, each readable', () => {
    assert.equal(lib.format, 'carys-microbes/1');
    assert.deepEqual(lib.structures.map((s) => s.pdbId), microbePdbIds());
    assert.equal(lib.pin, `PDB-${microbePdbIds().join('-')}`);
    for (const s of lib.structures) {
      const gz = readFileSync(join(DIR, s.file));
      assert.equal(createHash('sha256').update(gz).digest('hex'), s.sha256, s.file);
      const text = gunzipSync(gz).toString('utf8');
      assert.equal(parseAssemblyCif(text).count, s.atoms, s.pdbId);
      // the Model mode reads it with io's mmCIF reader
      assert.ok(parseCif(text).atoms.length > 1000, s.pdbId);
      assert.ok(s.organism.startsWith(microbeById(s.card)!.name), `${s.pdbId}: ${s.organism}`);
    }
  });

  it('is a registered, sourced digest', () => {
    const src = validateSourcesFile(JSON.parse(readFileSync(join(DIR, 'SOURCES.json'), 'utf8')));
    assert.equal(src.digest, MICROBE_DIGEST_ID);
    assert.deepEqual([...new Set(src.sources.map((s) => s.license_spdx))].sort(), ['CC-BY-4.0', 'CC0-1.0']);
    const reg = JSON.parse(readFileSync(join(ROOT, 'DIGESTS.json'), 'utf8')) as { digests: unknown[] };
    const row = reg.digests.map(validateDigestRecord).find((d) => d.id === MICROBE_DIGEST_ID);
    assert.equal(row?.status, 'shipped');
    assert.equal(row?.lane, 'H8');
  });
});
