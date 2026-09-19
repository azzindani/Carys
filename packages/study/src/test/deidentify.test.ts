import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDeid, tagKey } from '../deidentify.js';

describe('ps3.15 deidentify', () => {
  it('identity replaced, dates removed by default, UIDs/pixels pass', () => {
    const tags = new Map<string, unknown>([
      ['00100010', 'Doe^John'], ['00100020', '123'], ['00080020', '20240101'],
      ['00080030', '120000'], ['0020000D', '1.2.3'], ['7FE00010', '<pixels>'],
      ['00280010', 512],
    ]);
    const r = classifyDeid(tags);
    assert.equal(r.actions.get('00100010'), 'replace');
    assert.equal(r.actions.get('00080020'), 'remove');
    assert.equal(r.actions.get('0020000D'), 'pass');
    assert.equal(r.actions.get('7FE00010'), 'pass');
    assert.equal(r.actions.get('00280010'), 'pass');
    assert.equal(r.replaced, 2);
    assert.equal(r.removed, 2);
  });
  it('keepDates retains dates, birthdate replace-wins only when kept', () => {
    const tags = new Map<string, unknown>([['00080020', '20240101'], ['00100030', '19700101']]);
    const r = classifyDeid(tags, { keepDates: true });
    assert.equal(r.actions.get('00080020'), 'keep');
    assert.equal(r.actions.get('00100030'), 'keep');
  });
  it('privates removed unless allowlisted + retained', () => {
    const tags = new Map<string, unknown>([['00191080', 1000], ['00110010', 'vendor-blob']]);
    const drop = classifyDeid(tags);
    assert.equal(drop.actions.get('00191080'), 'remove');
    assert.equal(drop.actions.get('00110010'), 'remove');
    const keep = classifyDeid(tags, { retainSafePrivate: true });
    assert.equal(keep.actions.get('00191080'), 'keep');
    assert.equal(keep.actions.get('00110010'), 'remove');
  });
  it('tagKey normalizes group/element', () => {
    assert.equal(tagKey(0x10, 0x10), '00100010');
  });
});
