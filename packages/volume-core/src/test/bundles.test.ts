import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISEASE_BUNDLES, bundleById, quizAuditDetail,
} from '../bundles.js';
import { PATHOGEN_STRUCTURES } from '../pathogens.js';

describe('E2 disease bundles', () => {
  it('7 bundles, unique ids, every pathogen resolves', () => {
    assert.equal(DISEASE_BUNDLES.length, 7);
    assert.equal(new Set(DISEASE_BUNDLES.map((b) => b.id)).size, 7);
    const ids = new Set(PATHOGEN_STRUCTURES.map((p) => p.id));
    for (const b of DISEASE_BUNDLES) {
      assert.ok(ids.has(b.pathogenId), `${b.id} names unknown pathogen ${b.pathogenId}`);
      assert.ok(b.story.length > 50, `${b.id} story too thin`);
      assert.ok(b.pathway.length >= 2, `${b.id} pathway too thin`);
      assert.ok(b.quiz.length >= 2, `${b.id} quiz too thin`);
      assert.ok(b.provenance.length > 0, `${b.id} has no provenance card`);
    }
    assert.equal(bundleById('ace2-entry')?.pathogenId, 'spike-ace2');
    assert.equal(bundleById('nope'), null);
  });
  it('quiz answers are in range + rationale present', () => {
    for (const b of DISEASE_BUNDLES) {
      const qids = new Set<string>();
      for (const q of b.quiz) {
        assert.ok(!qids.has(q.id), `duplicate question ${q.id}`);
        qids.add(q.id);
        assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length,
          `${q.id} answer ${q.answer} out of range`);
        assert.ok(q.options.length >= 2, `${q.id} needs options`);
        assert.ok(q.rationale.length > 10, `${q.id} needs a rationale`);
      }
    }
  });
  it('M4 answers check against vendored bytes (celiac counts, allergen chains)', () => {
    const byPathogen = new Map(PATHOGEN_STRUCTURES.map((p) => [p.id, p]));
    const celiac = byPathogen.get('celiac-tcr')!;
    // celiac-tcr-q2: groove-contact count == peptide contacts length
    const cb = DISEASE_BUNDLES.find((b) => b.id === 'celiac-tcr')!;
    const cq2 = cb.quiz[1]!;
    assert.equal(cq2.options[cq2.answer], String(celiac.contacts.filter((c) => c.chain === 'J').length));
    // celiac-tcr-q1: peptide chain is J
    assert.equal(cb.quiz[0]!.options[cb.quiz[0]!.answer], 'Chain J');
    // birch-pollen-q1: single chain
    const alg = byPathogen.get('birch-allergen')!;
    assert.equal(alg.chains.length, 1);
    const bb = DISEASE_BUNDLES.find((b) => b.id === 'birch-pollen')!;
    assert.equal(bb.quiz[0]!.options[bb.quiz[0]!.answer], 'One');
    // allergen contacts are landmarks, never variant sites
    assert.deepEqual(alg.variantSites, []);
  });
  it('quiz answers check against vendored M1 bytes (not invented)', () => {
    const byPathogen = new Map(PATHOGEN_STRUCTURES.map((p) => [p.id, p]));
    // M2 organoid bundle: answers pinned to the vendored screen facts
    // (IDR API sizes + EBI mirror probe), never invented.
    const organ = DISEASE_BUNDLES.find((b) => b.id === 'organoid-context')!;
    assert.equal(organ.pathogenId, 'spike-ace2');
    assert.equal(organ.quiz[1]!.options[organ.quiz[1]!.answer], 'Single-channel, 144384×93184 at ~1nm/px');
    assert.equal(organ.quiz[2]!.options[organ.quiz[2]!.answer], 'Fails loud: blosc/lz4 chunks need the P0 toolchain');
    assert.ok(organ.provenance.some((p) => p.includes('idr-screens')));
    // ace2-entry-q2: contact count == digest contacts length
    const spike = byPathogen.get('spike-ace2')!;
    const q2 = DISEASE_BUNDLES.find((b) => b.id === 'ace2-entry')!.quiz[1]!;
    assert.equal(q2.options[q2.answer], String(spike.contacts.length));
    // antibody-block-q2: same for the antibody entry
    const ab = byPathogen.get('rbd-antibody')!;
    const abq = DISEASE_BUNDLES.find((b) => b.id === 'antibody-block')!.quiz[1]!;
    assert.equal(abq.options[abq.answer], String(ab.contacts.length));
    // capsid-assembly-q1: monomer count == chains length
    const capsid = byPathogen.get('hbv-capsid')!;
    assert.equal(capsid.chains.length, 4);
    // capsid-assembly-q3: variantSites empty by design
    assert.deepEqual(capsid.variantSites, []);
    // ace2-entry-q3: E:501 is both a contact and a monitored site
    assert.ok(spike.contacts.some((c) => c.chain === 'E' && c.resSeq === 501));
    assert.ok(spike.variantSites.includes(501));
  });
  it('quiz audit detail is stable + greppable', () => {
    assert.equal(
      quizAuditDetail('ace2-entry', 'ace2-entry-q1', true, 1),
      'quiz ace2-entry/ace2-entry-q1 picked=1 correct',
    );
    assert.equal(
      quizAuditDetail('ace2-entry', 'ace2-entry-q1', false, 0),
      'quiz ace2-entry/ace2-entry-q1 picked=0 wrong',
    );
  });
});
