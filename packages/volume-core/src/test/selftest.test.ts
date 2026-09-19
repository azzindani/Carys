import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SELFTEST_BUNDLE_ID, buildSelfTestBank, gradeSelfTestAnswer, mulberry32,
  selfTestAuditDetail, shuffled, validateSelfTestQuestion,
} from '../selftest.js';
import { ATLAS_STRUCTURES } from '../atlas.js';
import { installTermTable, installTreeTable, validateTermTable, validateTreeTable } from '../terms.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TERMS_DIR = join(ROOT, 'digests', 'bodyparts3d-terms');

function installed(): void {
  const raw = JSON.parse(readFileSync(join(TERMS_DIR, 'terms.json'), 'utf8'));
  installTermTable(validateTermTable(raw));
  const tree = JSON.parse(readFileSync(join(TERMS_DIR, 'tree.json'), 'utf8'));
  installTreeTable(validateTreeTable(tree));
}

describe('K4 self-test bank', () => {
  it('95 questions: 47 structure + 30 parent + 18 bundle, unique ids', () => {
    installed();
    const bank = buildSelfTestBank();
    const kinds = bank.map((q) => q.kind);
    assert.equal(bank.length, 95);
    assert.equal(kinds.filter((k) => k === 'structure').length, 47);
    assert.equal(kinds.filter((k) => k === 'parent').length, 30);
    assert.equal(kinds.filter((k) => k === 'bundle').length, 18);
    assert.equal(new Set(bank.map((q) => q.id)).size, 95);
    // every atlas structure gets a structure question
    const ids = new Set(bank.map((q) => q.id));
    for (const s of ATLAS_STRUCTURES) assert.ok(ids.has(`selftest-struct-${s.id}`), `missing ${s.id}`);
  });
  it('parent questions cover only tree-backed structures (never guessed)', () => {
    installed();
    const bank = buildSelfTestBank();
    const parents = bank.filter((q) => q.kind === 'parent');
    const pids = new Set(parents.map((q) => q.id));
    // sternum + patellae have no tree node: no parent questions for them
    assert.ok(!pids.has('selftest-parent-FMA7485'), 'sternum must not get a parent question');
    assert.ok(pids.has('selftest-parent-FMA24474'), 'femur must get a parent question');
    const felt = parents.find((q) => q.id === 'selftest-parent-FMA24474')!;
    assert.equal(felt.options[felt.answer], 'femur');
  });
  it('bundle questions reuse byte-pinned answers verbatim', () => {
    installed();
    const bank = buildSelfTestBank();
    const byId = new Map(bank.map((q) => [q.id, q]));
    assert.equal(byId.get('ace2-entry-q2')!.options[byId.get('ace2-entry-q2')!.answer], '15');
    assert.equal(byId.get('antibody-block-q2')!.options[byId.get('antibody-block-q2')!.answer], '22');
    assert.equal(byId.get('celiac-tcr-q2')!.options[byId.get('celiac-tcr-q2')!.answer], '13');
    assert.equal(byId.get('capsid-assembly-q1')!.options[byId.get('capsid-assembly-q1')!.answer], 'Four');
    // M2 organoid questions ride the same verbatim reuse
    assert.equal(byId.get('organoid-context-q2')!.options[byId.get('organoid-context-q2')!.answer], 'Single-channel, 144384×93184 at ~1nm/px');
  });
  it('seeded shuffle is deterministic + a permutation', () => {
    installed();
    const bank = buildSelfTestBank();
    const a = shuffled(bank, 17);
    const b = shuffled(bank, 17);
    assert.deepEqual(a.map((q) => q.id), b.map((q) => q.id));
    assert.deepEqual([...a.map((q) => q.id)].sort(), [...bank.map((q) => q.id)].sort());
    const c = shuffled(bank, 18);
    assert.notDeepEqual(a.map((q) => q.id), c.map((q) => q.id));
  });
  it('mulberry32 stays in [0,1) and streams', () => {
    const r = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = r();
      assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    }
    assert.notEqual(r(), r());
  });
  it('grader is pure equality; audit detail reuses the quiz line', () => {
    installed();
    const bank = buildSelfTestBank();
    const q = bank[0]!;
    assert.equal(gradeSelfTestAnswer(q, q.answer), true);
    assert.equal(gradeSelfTestAnswer(q, (q.answer + 1) % q.options.length), false);
    assert.equal(
      selfTestAuditDetail(q.id, true, q.answer),
      `quiz ${SELFTEST_BUNDLE_ID}/${q.id} picked=${q.answer} correct`,
    );
    assert.equal(SELFTEST_BUNDLE_ID, 'selftest');
  });
  it('corrupt questions fail loud with named errors', () => {
    const good = {
      id: 'x', kind: 'structure', prompt: 'p?', options: ['a', 'b'],
      answer: 0, rationale: 'r', provenance: 's',
    };
    validateSelfTestQuestion(good);
    const bads: Array<[unknown, RegExp]> = [
      [null, /bad-selftest-input/],
      [{ ...good, kind: 'essay' }, /kind/],
      [{ ...good, options: ['only'] }, /options/],
      [{ ...good, options: ['a', 'a'] }, /unique/],
      [{ ...good, answer: 5 }, /range/],
      [{ ...good, rationale: '' }, /rationale/],
      [{ ...good, provenance: '' }, /provenance/],
    ];
    for (const [raw, re] of bads) assert.throws(() => validateSelfTestQuestion(raw), re);
  });
});
