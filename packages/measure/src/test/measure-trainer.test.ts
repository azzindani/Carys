import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  gradeTrainerCase, MEASURETRAINER_SERIES, TRAINER_CASES, trainerCaseById,
  validateTrainerCase,
} from '../measure-trainer.js';

describe('E4 measurement trainer', () => {
  it('4 cases, unique ids, provenance present, series pinned', () => {
    assert.equal(TRAINER_CASES.length, 4);
    assert.equal(new Set(TRAINER_CASES.map((c) => c.id)).size, 4);
    for (const c of TRAINER_CASES) {
      assert.ok(c.title.length > 0 && c.task.length > 0, `${c.id} needs title+task`);
      assert.ok(c.provenance.length > 10, `${c.id} needs provenance`);
      validateTrainerCase(JSON.parse(JSON.stringify(c)));
    }
    assert.equal(MEASURETRAINER_SERIES, 'measuretrainer');
    assert.equal(trainerCaseById('measuretrainer-recist-pr')?.expectedCategory, 'PR');
    assert.equal(trainerCaseById('nope'), null);
  });
  it('RECIST answers agree with the shipped assessRecist math', () => {
    const pr = trainerCaseById('measuretrainer-recist-pr')!;
    assert.deepEqual(gradeTrainerCase(pr, 30, 'PR'), { agree: true, publishedSum: 30, diff: 0 });
    assert.equal(gradeTrainerCase(pr, 30.5, 'PR').agree, true);
    assert.equal(gradeTrainerCase(pr, 32, 'PR').agree, false);
    assert.equal(gradeTrainerCase(pr, 30, 'SD').agree, false);
    const pd = trainerCaseById('measuretrainer-recist-pd')!;
    assert.equal(gradeTrainerCase(pd, 40, 'PD').agree, true);
    const len = trainerCaseById('measuretrainer-length-phantom')!;
    assert.equal(gradeTrainerCase(len, 2.0, null).agree, true);
    assert.equal(gradeTrainerCase(len, 2.2, null).agree, false);
    assert.throws(() => gradeTrainerCase(len, NaN, null), /measuretrainer-bad-measure/);
  });
  it('corrupt cases fail loud with named errors', () => {
    const good = {
      id: 'x', title: 't', task: 'k', kind: 'length',
      published: [2], toleranceMm: 0.1, expectedCategory: null, provenance: 'p',
    };
    validateTrainerCase(good);
    const bads: Array<[unknown, RegExp]> = [
      [null, /bad-measuretrainer-input/],
      [{ ...good, kind: 'volume' }, /kind/],
      [{ ...good, published: [] }, /published/],
      [{ ...good, published: [-1] }, /published/],
      [{ ...good, toleranceMm: -1 }, /toleranceMm/],
      [{ ...good, kind: 'recist-sum', expectedCategory: 'MAYBE' }, /expectedCategory/],
      [{ ...good, expectedCategory: 'PR' }, /null/],
    ];
    for (const [raw, re] of bads) assert.throws(() => validateTrainerCase(raw), re);
  });
});
