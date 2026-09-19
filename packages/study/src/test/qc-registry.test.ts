import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compressionAudit, deidReportCard, doseRegistry, phantomTrend,
} from '../qc-registry.js';

describe('Q1-Q4 QC registry', () => {
  it('Q1 phantom trend: pass/fail + drift vs earliest date', () => {
    const rows = phantomTrend([
      { series: 's2', date: '2026-09-02', meanHU: 3, expectedHU: 0, toleranceHU: 5 },
      { series: 's1', date: '2026-09-01', meanHU: 1, expectedHU: 0, toleranceHU: 5 },
      { series: 's3', date: '2026-09-03', meanHU: 9, expectedHU: 0, toleranceHU: 5 },
    ]);
    assert.deepEqual(rows.map((r) => r.series), ['s1', 's2', 's3']);
    assert.deepEqual(rows.map((r) => r.pass), [true, true, false]);
    assert.deepEqual(rows.map((r) => r.driftHU), [0, 2, 8]);
    assert.deepEqual(phantomTrend([]), []);
    assert.throws(() => phantomTrend([
      { series: 'x', date: '2026-09-01', meanHU: NaN, expectedHU: 0, toleranceHU: 5 },
    ]), /phantom-nonfinite-input/);
  });
  it('Q2 dose registry: numbers pass, junk nulls, rates exact', () => {
    const reg = doseRegistry([
      { series: 'a', ctdivol: 12.5, dlp: 400, kvp: 120 },
      { series: 'b', ctdivol: 'high', dlp: null, kvp: NaN },
    ]);
    assert.deepEqual(reg.rows[0], { series: 'a', ctdivol: 12.5, dlp: 400, kvp: 120 });
    assert.deepEqual(reg.rows[1], { series: 'b', ctdivol: null, dlp: null, kvp: null });
    assert.deepEqual(reg.notRecorded, { ctdivol: 0.5, dlp: 0.5, kvp: 0.5 });
    assert.deepEqual(doseRegistry([]).notRecorded, { ctdivol: 1, dlp: 1, kvp: 1 });
  });
  it('Q3 compression audit: verdicts named, unvalidated rate exact', () => {
    const a = compressionAudit([
      { series: 'a', transferSyntaxUID: '1.2.840.10008.1.2.1' },
      { series: 'b', transferSyntaxUID: '1.2.840.10008.1.2.4.50' },
      { series: 'c', transferSyntaxUID: null },
    ]);
    assert.ok(a.rows[0]!.verdict.startsWith('none'));
    assert.ok(a.rows[1]!.verdict.startsWith('lossy'));
    assert.ok(a.rows[2]!.verdict.startsWith('unknown'));
    assert.equal(a.unvalidatedRate, 0.667);
    assert.equal(compressionAudit([]).unvalidatedRate, 1);
  });
  it('Q4 de-id card: flags + ready counts, bad inputs loud', () => {
    const card = deidReportCard([
      { series: 'clean', burnedFraction: 0, actions: { replace: 5, remove: 0, keep: 20 } },
      { series: 'burned', burnedFraction: 0.01, actions: { replace: 5, remove: 0, keep: 20 } },
      { series: 'leftover', burnedFraction: 0, actions: { replace: 5, remove: 2, keep: 20 } },
    ]);
    assert.deepEqual(card.rows.map((r) => r.ready), [true, false, false]);
    assert.equal(card.readyCount, 1);
    assert.equal(card.rows[1]!.burnedFlag, true);
    assert.throws(() => deidReportCard([
      { series: 'x', burnedFraction: 2, actions: { replace: 0, remove: 0, keep: 0 } },
    ]), /deid-bad-fraction/);
    assert.throws(() => deidReportCard([], -1), /deid-bad-threshold/);
  });
});
