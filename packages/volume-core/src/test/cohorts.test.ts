import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEACHING_COHORTS, cohortAuditDetail, cohortById, cohortDifficultyRange,
  cohortProgress, validateCohortOrder,
} from '../cohorts.js';

describe('K3 teaching cohorts', () => {
  it('4 cohorts, unique ids/cases, targets well-formed', () => {
    assert.equal(TEACHING_COHORTS.length, 4);
    assert.equal(new Set(TEACHING_COHORTS.map((c) => c.id)).size, 4);
    for (const c of TEACHING_COHORTS) {
      assert.ok(c.title.length > 0 && c.blurb.length > 0, `${c.id} needs title+blurb`);
      assert.ok(c.cases.length >= 2, `${c.id} needs cases`);
      assert.ok(c.provenance.length > 0, `${c.id} needs provenance`);
      const caseIds = new Set(c.cases.map((x) => x.id));
      assert.equal(caseIds.size, c.cases.length, `${c.id} duplicate case ids`);
      for (const x of c.cases) {
        assert.ok(x.title.length > 0 && x.task.length > 0, `${c.id}/${x.id} needs title+task`);
        assert.ok(['series', 'pathogen', 'bundle'].includes(x.target.kind), `${x.id} bad target kind`);
      }
    }
    assert.equal(cohortById('chest-basics')?.cases.length, 3);
    assert.equal(cohortById('nope'), null);
  });
  it('progress counts read/signed as done, ignores reading/unread', () => {
    const cohort = cohortById('chest-basics')!;
    const states: Record<string, string> = {
      'lung-ct-dicom': 'signed', 'covid-chest-seg': 'read', 'cardiac-4d-cine': 'reading',
    };
    const p = cohortProgress(cohort, (k) => states[k] ?? 'unread');
    assert.equal(p.total, 3);
    assert.equal(p.done, 2);
    assert.deepEqual(p.cases.map((c) => c.status), ['reading', 'signed', 'read']);
  });
  it('pathogen/bundle cases key on entry ids (read-status convention)', () => {
    const cohort = cohortById('pathogen-stories')!;
    const seen: string[] = [];
    const p = cohortProgress(cohort, (k) => { seen.push(k); return 'unread'; });
    assert.deepEqual(seen, ['ace2-entry', 'birch-pollen', 'antibody-block', 'capsid-assembly', 'celiac-tcr', 'organoid-context']);
    assert.equal(p.done, 0);
    const signed = cohortProgress(cohort, (k) => (k === 'ace2-entry' ? 'signed' : 'unread'));
    assert.equal(signed.done, 1);
  });
  it('E3/X3 difficulty: every cohort easy-first, ladder spans 1-3', () => {
    for (const c of TEACHING_COHORTS) validateCohortOrder(c);
    assert.deepEqual(cohortDifficultyRange(cohortById('residency-ladder')!), [1, 3]);
    assert.deepEqual(cohortDifficultyRange(cohortById('chest-basics')!), [1, 2]);
    assert.throws(() => validateCohortOrder({
      id: 'bad', title: 't', blurb: 'b', cases: [
        { id: 'a', title: 't', task: 'k', target: { kind: 'series', key: 's' }, difficulty: 3 },
        { id: 'b', title: 't', task: 'k', target: { kind: 'series', key: 's' }, difficulty: 1 },
      ], provenance: ['p'],
    }), /bad-cohort-order/);
    assert.throws(() => validateCohortOrder({
      id: 'bad2', title: 't', blurb: 'b', cases: [
        { id: 'a', title: 't', task: 'k', target: { kind: 'series', key: 's' }, difficulty: 9 as unknown as 1 },
      ], provenance: ['p'],
    }), /bad-cohort-order/);
  });
  it('audit detail is stable + greppable', () => {
    assert.equal(
      cohortAuditDetail('chest-basics', 'lung-nodule', 'open'),
      'cohort chest-basics/lung-nodule open',
    );
  });
});
