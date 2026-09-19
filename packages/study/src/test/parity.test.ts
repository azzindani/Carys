import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reportArtifacts, reportFingerprint, reportHtmlParity, reportToJSON } from '../parity.js';
import type { StudyReport } from '../report.js';

const R: StudyReport = {
  series: 's1', note: 'n', dims: [4, 4, 4], spacing: [1, 1, 1],
  maskVoxels: 12, maskCm3: 0.012,
  measurements: [{ label: 'L1', kind: 'length', value: 43.3333, unit: 'mm', plane: 'axial', slice: 2 }],
  issues: [{ level: 'warn', code: 'anisotropic', message: 'stretch' }],
  generatedAt: '2026-01-01',
  digestPins: { 'bodyparts3d-longbones': 'BP3D-4.0-partof-obj99' },
};

describe('report parity', () => {
  it('canonical JSON stable, fingerprint deterministic, HTML covers fields', () => {
    const a = reportToJSON(R);
    assert.ok(a.endsWith('\n'));
    assert.equal(reportToJSON({ ...R }), a); // byte-stable
    assert.equal(reportFingerprint(R), reportFingerprint({ ...R }));
    assert.equal(reportFingerprint(R).length, 8);
    assert.notEqual(reportFingerprint(R), reportFingerprint({ ...R, maskVoxels: 13 }));
    const { html, json, fingerprint } = reportArtifacts(R);
    assert.deepEqual(reportHtmlParity(R, html), []);
    assert.ok(json.includes('43.333')); // 3dp rounding, not raw float
    assert.equal(fingerprint, reportFingerprint(R));
  });
  it('parity names every missing piece', () => {
    const missing = reportHtmlParity(R, '<html>empty</html>');
    assert.ok(missing.includes('series') && missing.includes('measurement:L1'));
    assert.ok(missing.includes('value:L1') && missing.includes('issue:anisotropic'));
  });
});
