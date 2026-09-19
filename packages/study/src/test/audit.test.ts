import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { audit, auditClear, auditFor, auditToJSON, auditTrail } from '../audit.js';

describe('audit trail', () => {
  it('appends with seq + timestamp, filters by series, exports JSON', () => {
    auditClear();
    const a = audit('measure.create', 's1', 'Length 1: 42.0 mm');
    const b = audit('mask.op', 's2', 'smooth');
    assert.equal(a.seq + 1, b.seq);
    assert.ok(!Number.isNaN(Date.parse(a.at)));
    assert.equal(a.actor, 'local');
    assert.equal(auditTrail().length, 2);
    assert.deepEqual(auditFor('s1').map((e) => e.action), ['measure.create']);
    assert.deepEqual(auditFor('nope'), []);
    const j = JSON.parse(auditToJSON());
    assert.equal(j.length, 2);
    assert.equal(auditClear(), 2);
    assert.deepEqual(auditTrail(), []);
  });
  it('quiz answers log as quiz.answer with greppable detail', () => {
    auditClear();
    const e = audit('quiz.answer', 'spike-ace2', 'quiz ace2-entry/ace2-entry-q1 picked=1 correct');
    assert.equal(e.action, 'quiz.answer');
    assert.equal(e.series, 'spike-ace2');
    assert.match(e.detail, /^quiz ace2-entry\/ace2-entry-q1 picked=1 correct$/);
    assert.equal(auditFor('spike-ace2').length, 1);
    assert.equal(auditClear(), 1);
  });
});
