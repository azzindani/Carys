import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PATHOGEN_ATTRIBUTION, PATHOGEN_DIGEST_ID, PATHOGEN_DIGEST_PIN,
  PATHOGEN_STRUCTURES, pathogenById,
} from '@carys/volume-core';
import { validateDigestRecord, validateKnowledgeEntry, validateSourcesFile } from '../sources.js';
import { parsePdb } from '@carys/io';

const ROOT = process.cwd();
const DIGEST_DIR = join(ROOT, 'digests', 'rcsb-pathogens');

describe('M1 pathogen digest registry', () => {
  it('5 entries, unique ids/files, pins + attribution exact', () => {
    assert.equal(PATHOGEN_STRUCTURES.length, 5);
    assert.equal(new Set(PATHOGEN_STRUCTURES.map((s) => s.id)).size, 5);
    assert.equal(new Set(PATHOGEN_STRUCTURES.map((s) => s.file)).size, 5);
    assert.equal(PATHOGEN_DIGEST_ID, 'rcsb-pathogens');
    assert.equal(PATHOGEN_DIGEST_PIN, 'PDB-6M0J-6W41-1QGT-4OZF-1BV1');
    assert.match(PATHOGEN_ATTRIBUTION, /CC0/);
    assert.equal(pathogenById('spike-ace2')?.pdbId, '6M0J');
    assert.equal(pathogenById('nope'), null);
  });
  it('every knowledge entry validates through study, none pre-reviewed', () => {
    for (const s of PATHOGEN_STRUCTURES) {
      const back = validateKnowledgeEntry({ ...s.entry });
      assert.equal(back.term, s.entry.term);
      assert.equal(back.source, 'PDB');
      assert.equal(back.reviewed_by, null);
    }
  });
  it('vendored digest: 5 PDB files + CC0 SOURCES sidecar validate', () => {
    const sidecar = JSON.parse(readFileSync(join(DIGEST_DIR, 'SOURCES.json'), 'utf8'));
    const ok = validateSourcesFile(sidecar);
    assert.equal(ok.digest, 'rcsb-pathogens');
    assert.equal(ok.sources[0]!.license_spdx, 'CC0-1.0');
    assert.equal(ok.sources[0]!.entry_count, 5);
    for (const s of PATHOGEN_STRUCTURES) assert.ok(existsSync(join(DIGEST_DIR, s.file)), `missing ${s.file}`);
  });
  it('vendored files parse: atom counts + chains match the digest plan', () => {
    const counts: Record<string, { atoms: number; chains: string[] }> = {
      '6M0J.pdb': { atoms: 6419, chains: ['A', 'E'] },
      '6W41.pdb': { atoms: 4906, chains: ['C', 'H', 'L'] },
      '1QGT.pdb': { atoms: 4560, chains: ['A', 'B', 'C', 'D'] },
      '4OZF.pdb': { atoms: 6364, chains: ['A', 'B', 'G', 'H', 'J'] },
      '1BV1.pdb': { atoms: 1278, chains: ['A'] },
    };
    for (const s of PATHOGEN_STRUCTURES) {
      const m = parsePdb(readFileSync(join(DIGEST_DIR, s.file), 'utf8'));
      const want = counts[s.file]!;
      assert.equal(m.atoms.length, want.atoms, `${s.file} atom count`);
      const chains = [...new Set(m.residues.map((r) => r.chain))].sort();
      assert.deepEqual(chains, want.chains, `${s.file} chains`);
      assert.ok(m.atoms.every((a) => Number.isFinite(a.x + a.y + a.z)), `${s.file} finite coords`);
    }
  });
  it('contacts resolve against parsed residues (names agree)', () => {
    for (const s of PATHOGEN_STRUCTURES) {
      const m = parsePdb(readFileSync(join(DIGEST_DIR, s.file), 'utf8'));
      const byKey = new Map(m.residues.map((r) => [`${r.chain}:${r.seqId}`, r.label]));
      for (const c of s.contacts) {
        const label = byKey.get(`${c.chain}:${c.resSeq}`);
        assert.ok(label, `${s.pdbId} contact ${c.chain}:${c.resSeq} missing from parsed model`);
        assert.ok(label!.startsWith(c.resName), `${s.pdbId} ${c.chain}:${c.resSeq} is ${label}, digest says ${c.resName}`);
      }
    }
  });
  it('M4 celiac tripartite: peptide on J, TCR on G/H, counts exact', () => {
    const celiac = pathogenById('celiac-tcr')!;
    const pep = celiac.contacts.filter((c) => c.chain === 'J');
    const tcr = celiac.contacts.filter((c) => c.chain === 'G' || c.chain === 'H');
    assert.equal(pep.length, 13);
    assert.equal(tcr.length, 12);
    assert.equal(celiac.contacts.length, 25);
    // peptide resSeq runs 2–14 (13 consecutive groove residues)
    assert.deepEqual(pep.map((c) => c.resSeq), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    // allergen landmarks are backbone positions, never epitopes
    const alg = pathogenById('birch-allergen')!;
    assert.equal(alg.contacts.length, 3);
    assert.deepEqual(alg.variantSites, []);
  });
  it('variant-note sites resolve on the measured chain', () => {
    const spike = pathogenById('spike-ace2')!;
    const m = parsePdb(readFileSync(join(DIGEST_DIR, spike.file), 'utf8'));
    const chain = spike.contacts[0]!.chain;
    const seqs = new Set(m.residues.filter((r) => r.chain === chain).map((r) => r.seqId));
    // 417/452/478/484/498 are monitored positions that need not contact
    // ACE2 in this crystal form — they must still exist as residues.
    for (const v of spike.variantSites) assert.ok(seqs.has(v), `6M0J chain ${chain} lacks variant site ${v}`);
    // capsid entry carries no variant sites by design
    assert.deepEqual(pathogenById('hbv-capsid')!.variantSites, []);
  });
  it('registry row validates as shipped CC0', () => {
    const row = validateDigestRecord({
      id: 'rcsb-pathogens', kind: 'digest', license_spdx: 'CC0-1.0',
      mode: 'digest', lane: 'M1', status: 'shipped',
      source_url: 'https://www.rcsb.org/',
    });
    assert.equal(row.lane, 'M1');
  });
});
