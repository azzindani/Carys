import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { instanceFromJson, seriesFromJson, studyFromJson } from '../json-model.js';
import { buildStowBody, parseStowResponse } from '../stow.js';
import { parseMultipartRelated } from '../multipart.js';

describe('json model', () => {
  it('reads PN Alphabetic, coerces numbers, tolerates absence', () => {
    const s = studyFromJson({
      '0020000D': { vr: 'UI', Value: ['1.2.3'] },
      '00100010': { vr: 'PN', Value: [{ Alphabetic: 'DOE^JOHN' }] },
      '00201206': { vr: 'IS', Value: ['4'] },
      '00080061': { vr: 'CS', Value: ['CT', 'MR'] },
    });
    assert.equal(s.studyUID, '1.2.3');
    assert.equal(s.patientName, 'DOE^JOHN');
    assert.equal(s.patientID, null);
    assert.equal(s.seriesCount, 4);
    assert.deepEqual(s.modalities, ['CT', 'MR']);
  });
  it('falls back to Modality when ModalitiesInStudy is absent', () => {
    const s = studyFromJson({
      '0020000D': { vr: 'UI', Value: ['9'] },
      '00080060': { vr: 'CS', Value: ['PT'] },
    });
    assert.deepEqual(s.modalities, ['PT']);
  });
  it('parses series and instance rows', () => {
    const se = seriesFromJson({
      '0020000D': { vr: 'UI', Value: ['1'] },
      '0020000E': { vr: 'UI', Value: ['2'] },
      '00200011': { vr: 'IS', Value: [7] },
    });
    assert.equal(se.seriesNumber, 7);
    const ins = instanceFromJson({
      '00080018': { vr: 'UI', Value: ['3'] },
      '00280010': { vr: 'US', Value: [512] },
    });
    assert.equal(ins.instanceUID, '3');
    assert.equal(ins.rows, 512);
    assert.equal(ins.cols, null);
  });
});

describe('stow', () => {
  it('builds a body the parser round-trips', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    const { body, contentType } = buildStowBody([{ bytes: a }, { bytes: b, contentLocation: 'x' }], 'stow-b');
    assert.ok(contentType.includes('boundary=stow-b'));
    const parts = parseMultipartRelated(body, 'stow-b');
    assert.equal(parts.length, 2);
    assert.deepEqual(parts[0]!.body, a);
    assert.deepEqual(parts[1]!.body, b);
    assert.equal(parts[1]!.contentLocation, 'x');
  });
  it('requires at least one instance', () => {
    assert.throws(() => buildStowBody([]), /at least one/);
  });
  it('parses stored/failed summaries', () => {
    const r = parseStowResponse({ Stored: ['1.1', { SOPInstanceUID: '2.2' }], Failed: [{ uid: '3.3', reason: 'nope' }] });
    assert.deepEqual(r.stored, ['1.1', '2.2']);
    assert.deepEqual(r.failed, [{ uid: '3.3', reason: 'nope' }]);
    assert.deepEqual(parseStowResponse(null), { stored: [], failed: [] });
  });
});
