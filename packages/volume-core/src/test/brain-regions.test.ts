import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BRAIN_ATTRIBUTION, BRAIN_DIGEST_ID, BRAIN_DIGEST_PIN, brainLabelByValue,
  installBrainTable, radlexCount, searchBrainLabels, validateBrainTable,
} from '../brain-regions.js';

const ROOT = process.cwd();
const DIGEST_DIR = join(ROOT, 'digests', 'openanatomy-brain');

function installed(): void {
  const raw = JSON.parse(readFileSync(join(DIGEST_DIR, 'labels.json'), 'utf8'));
  installBrainTable(validateBrainTable(raw));
}

describe('A3 brain regions', () => {
  it('vendored table validates: 335 SPL labels, pins exact', () => {
    const raw = JSON.parse(readFileSync(join(DIGEST_DIR, 'labels.json'), 'utf8'));
    const rows = validateBrainTable(raw);
    assert.equal(rows.length, 335);
    installBrainTable(rows);
    assert.equal(radlexCount(), 157);
    assert.equal(BRAIN_DIGEST_ID, 'openanatomy-brain');
    assert.equal(BRAIN_DIGEST_PIN, 'spl-brain-atlas-labelinfo-335');
    assert.match(BRAIN_ATTRIBUTION, /Surgical Planning Laboratory/);
  });
  it('lookups: values resolve, misses are null', () => {
    installed();
    assert.equal(brainLabelByValue(12)?.label, 'left putamen');
    assert.equal(brainLabelByValue(12)?.rid, 'RID21015');
    assert.equal(brainLabelByValue(2)?.label, 'white matter of left cerebral hemisphere');
    assert.equal(brainLabelByValue(0)?.label, 'background');
    assert.equal(brainLabelByValue(999999), null);
  });
  it('search: substring over labels + RadLex, blank never dumps', () => {
    installed();
    const puta = searchBrainLabels('putamen');
    assert.equal(puta.length, 2);
    assert.ok(puta.every((t) => t.label.includes('putamen')));
    const rid = searchBrainLabels('RID21015');
    assert.equal(rid.length, 1);
    assert.equal(rid[0]!.label, 'left putamen');
    assert.deepEqual(searchBrainLabels('  '), []);
    const one = searchBrainLabels('thalamus', 1);
    assert.equal(one.length, 1);
    assert.deepEqual(searchBrainLabels('ventricle').map((t) => t.v), searchBrainLabels('ventricle').map((t) => t.v));
  });
  it('corrupt tables fail loud with named errors', () => {
    const good = [{ v: 1, label: 'x', rid: '', color: 'rgb(1,1,1)' }];
    validateBrainTable(good);
    const bads: Array<[unknown, RegExp]> = [
      [null, /bad-brain-input/],
      [[], /must not be empty/],
      [[{ v: -1, label: 'x', rid: '', color: 'c' }], /\.v/],
      [[{ v: 1, label: 'x', rid: '', color: 'c' }, { v: 1, label: 'y', rid: '', color: 'c' }], /duplicate/],
      [[{ v: 1, label: '', rid: '', color: 'c' }], /\.label/],
      [[{ v: 1, label: 'x', rid: 5, color: 'c' }], /\.rid/],
      [[{ v: 1, label: 'x', rid: '', color: '' }], /\.color/],
    ];
    for (const [raw, re] of bads) assert.throws(() => validateBrainTable(raw), re);
  });
});
