import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  glossaryCard, installTermTable, installTreeTable, isaAncestors, isaChildren,
  partofChildren, renderableCount, resolveAtlasTerms, searchTerms,
  termByBpId, termByFma, TERMS_DIGEST_ID, TERMS_DIGEST_PIN, treeName,
  validateTermTable, validateTreeTable,
} from '@carys/volume-core';
import { validateDigestRecord, validateSourcesFile } from '../sources.js';

const ROOT = process.cwd();
const TERMS_DIR = join(ROOT, 'digests', 'bodyparts3d-terms');

function installed(): void {
  const raw = JSON.parse(readFileSync(join(TERMS_DIR, 'terms.json'), 'utf8'));
  installTermTable(validateTermTable(raw));
  const tree = JSON.parse(readFileSync(join(TERMS_DIR, 'tree.json'), 'utf8'));
  installTreeTable(validateTreeTable(tree));
}

describe('K1 term service', () => {
  it('vendored table validates: 1368 renderable concepts, CC-BY-4.0 sidecar', () => {
    const raw = JSON.parse(readFileSync(join(TERMS_DIR, 'terms.json'), 'utf8'));
    const rows = validateTermTable(raw);
    assert.equal(Object.keys(rows).length, 1368);
    installTermTable(rows);
    assert.equal(renderableCount(), 1368);
    const sidecar = JSON.parse(readFileSync(join(TERMS_DIR, 'SOURCES.json'), 'utf8'));
    const ok = validateSourcesFile(sidecar);
    assert.equal(ok.digest, 'bodyparts3d-terms');
    assert.equal(ok.sources[0]!.license_spdx, 'CC-BY-4.0');
    assert.equal(TERMS_DIGEST_ID, 'bodyparts3d-terms');
    assert.equal(TERMS_DIGEST_PIN, 'BP3D-4.0-partof+isa-lists');
  });
  it('lookups: FMA + BP ids resolve, misses are null', () => {
    installed();
    assert.equal(termByFma('FMA24474')?.name, 'right femur');
    assert.equal(termByFma('FMA7485')?.members.length, 3);
    assert.equal(termByBpId('BP10053')?.fma, 'FMA24474');
    assert.equal(termByBpId('BP9392')?.name, 'sternum');
    assert.equal(termByFma('FMA00000'), null);
    assert.equal(termByBpId('BP00000'), null);
  });
  it('search: substring over names + ids, blank never dumps, limit deterministic', () => {
    installed();
    const femur = searchTerms('femur');
    assert.ok(femur.length >= 2, `femur hits: ${femur.length}`);
    assert.ok(femur.every((t) => t.name.toLowerCase().includes('femur') || t.fma.includes('femur')));
    assert.deepEqual(searchTerms('  '), []);
    assert.deepEqual(searchTerms('', 0), []);
    const one = searchTerms('stern', 1);
    assert.equal(one.length, 1);
    // FMA-id order: repeated calls agree
    assert.deepEqual(searchTerms('rib').map((t) => t.fma), searchTerms('rib').map((t) => t.fma));
  });
  it('A1 labels agree with the table: zero drift', () => {
    installed();
    const drift = resolveAtlasTerms((fma) => {
      const hit = termByFma(fma);
      return hit ? { term: hit.name, bpId: hit.bpId } : null;
    });
    assert.deepEqual(drift, []);
  });
  it('corrupt tables fail loud with named errors', () => {
    const bads: Array<[unknown, RegExp]> = [
      [null, /bad-terms-input/],
      [{}, /must not be empty/],
      [{ NOPE: ['x', null, []] }, /bad FMA id/],
      [{ FMA1: ['x', null, 'members'] }, /members must be an array/],
      [{ FMA1: ['x', null] }, /triple/],
      [{ FMA1: ['', null, []] }, /name/],
      [{ FMA1: ['x', '', []] }, /bpId/],
      [{ FMA1: ['x', null, ['']] }, /members/],
    ];
    for (const [raw, re] of bads) assert.throws(() => validateTermTable(raw), re);
  });
  it('A2 tree: femur ancestry reaches bone organ, rib cage has 14 part-of children', () => {
    installed();
    const chain = isaAncestors('FMA24474');
    assert.deepEqual(chain.slice(0, 4), ['FMA24474', 'FMA9611', 'FMA7474', 'FMA5018']);
    assert.ok(chain.includes('FMA67135'), `chain missing anatomical structure: ${chain}`);
    assert.equal(treeName('FMA9611'), 'femur');
    assert.equal(treeName('FMA00000'), null);
    assert.deepEqual(isaChildren('FMA9611'), ['FMA24474', 'FMA24475']);
    assert.deepEqual(isaChildren('FMA00000'), []);
    assert.equal(partofChildren('FMA7480').length, 14);
    assert.ok(partofChildren('FMA7480').includes('FMA7857'));
    assert.deepEqual(partofChildren('FMA16202'), []);
  });
  it('A2 tree: skull/pelvis/sacrum resolve + corrupt trees fail loud', () => {
    installed();
    assert.ok(isaAncestors('FMA46565').length >= 1);
    assert.equal(treeName('FMA46565'), 'skull');
    assert.ok(partofChildren('FMA9578').length >= 2);
    assert.ok(isaAncestors('FMA00000').length === 0);
    const bads: Array<[unknown, RegExp]> = [
      [null, /bad-tree-input/],
      [{}, /isa must be an object/],
      [{ isa: {}, partof_children: {} }, /isa must not be empty/],
      [{ isa: { NOPE: { name: 'x', children: [] } }, partof_children: {} }, /bad FMA id/],
      [{ isa: { FMA1: { name: '', children: [] } }, partof_children: {} }, /name/],
      [{ isa: { FMA1: { name: 'x', children: ['NOPE'] } }, partof_children: {} }, /children/],
      [{ isa: { FMA1: { name: 'x', children: [] } } }, /partof_children/],
    ];
    for (const [raw, re] of bads) assert.throws(() => validateTreeTable(raw), re);
    assert.throws(() => validateTreeTable({ isa: { FMA1: { name: 'x', children: [], parent: 'NOPE' } }, partof_children: {} }), /parent/);
  });
  it('A2 labels agree with the table: zero drift over 47 structures', () => {
    installed();
    const drift = resolveAtlasTerms((fma) => {
      const hit = termByFma(fma);
      return hit ? { term: hit.name, bpId: hit.bpId } : null;
    });
    assert.deepEqual(drift, []);
  });
  it('K2 glossary: femur card derives parent/children/meshes/source', () => {
    installed();
    const card = glossaryCard('FMA9611')!;
    assert.equal(card.name, 'femur');
    assert.deepEqual(card.parent, { fma: 'FMA7474', name: 'long bone' });
    assert.deepEqual(card.children, ['FMA24474', 'FMA24475']);
    assert.deepEqual(card.partof, []);
    assert.ok(card.members.length === 0, 'femur family node has no direct meshes');
    assert.match(card.source, /CC-BY-4.0/);
    assert.match(card.source, /BP3D-4.0/);
  });
  it('K2 glossary: leaf + compound + unknown behave', () => {
    installed();
    const leaf = glossaryCard('FMA24474')!;
    assert.equal(leaf.name, 'right femur');
    assert.deepEqual(leaf.parent, { fma: 'FMA9611', name: 'femur' });
    assert.deepEqual(leaf.children, []);
    assert.deepEqual(leaf.members, ['FJ3365']);
    const rib = glossaryCard('FMA7480')!;
    assert.equal(rib.name, 'rib cage');
    assert.equal(rib.parent, null);
    assert.equal(rib.partof.length, 14);
    assert.ok(rib.partof.includes('FMA7857'));
    assert.equal(glossaryCard('FMA00000'), null);
  });
  it('registry row for the terms digest validates as shipped CC-BY-4.0', () => {
    const row = validateDigestRecord({
      id: 'bodyparts3d-terms', kind: 'digest', license_spdx: 'CC-BY-4.0',
      mode: 'digest', lane: 'K1', status: 'shipped',
      source_url: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html',
    });
    assert.equal(row.lane, 'K1');
  });
});
