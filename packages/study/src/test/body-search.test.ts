import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { conceptsOfElement, findBodyStructures, installTermTable, validateTermTable, type BodyRow } from '@carys/volume-core';

// H2 (docs/PHASES.md): finding structures of the whole-body digest by name,
// FMA id or element, through the K1 PART-OF concepts.

const ROOT = process.cwd();
installTermTable(validateTermTable(JSON.parse(readFileSync(join(ROOT, 'digests', 'bodyparts3d-terms', 'terms.json'), 'utf8'))));
const index = JSON.parse(readFileSync(join(ROOT, 'digests', 'bodyparts3d-body', 'index.json'), 'utf8')) as { parts: [string, string, string, string][] };
const rows: BodyRow[] = index.parts.map(([element, fma, name, system]) => ({ element, fma, name, system }));
const system = new Map(rows.map((r) => [r.element, r.system]));

describe('whole-body search (H2)', () => {
  it('finds an organ as its PART-OF concept: every piece of it', () => {
    const heart = findBodyStructures(rows, 'Heart')!;
    assert.equal(heart.label, 'heart (FMA7088)');
    assert.equal(heart.elements.length, 83);
    assert.ok(heart.elements.every((e) => system.get(e) === 'cardiovascular'));
    const liver = findBodyStructures(rows, 'liver')!;
    assert.equal(liver.label, 'liver (FMA7197)');
    assert.ok(liver.elements.includes('FJ2820'), 'hepatovenous segment iv');
    const brain = findBodyStructures(rows, 'brain')!;
    assert.equal(brain.label, 'brain (FMA50801)');
    assert.ok(brain.elements.length > 50);
  });

  it('finds by FMA id, element id, exact and partial names', () => {
    assert.deepEqual(findBodyStructures(rows, 'FMA24474')!.elements, ['FJ3365']);
    assert.deepEqual(findBodyStructures(rows, 'fj3365')!.elements, ['FJ3365']);
    assert.deepEqual(findBodyStructures(rows, 'right femur')!.elements, ['FJ3365']);
    const segs = findBodyStructures(rows, 'hepatovenous')!;
    assert.equal(segs.label, '"hepatovenous"');
    assert.ok(segs.elements.length >= 8 && segs.elements.every((e) => system.get(e) === 'digestive'));
    assert.equal(findBodyStructures(rows, '  '), null);
    assert.equal(findBodyStructures(rows, 'no such structure'), null);
  });

  it('says what a tapped piece is part of, smallest first', () => {
    const within = conceptsOfElement('FJ2820', 'FMA15742').map((t) => t.name);
    assert.deepEqual(within.slice(0, 3), ['anterior sector of left liver', 'left hemiliver', 'liver']);
    assert.ok(!within.includes('hepatovenous segment iv'));
    assert.ok(conceptsOfElement('FJ1758', 'FMA260794').some((t) => t.name === 'brain'));
    // a gyrus is nine concepts down from its organ: the chain reaches it
    assert.ok(conceptsOfElement('FJ1834', 'FMA72653').some((t) => t.name === 'brain'));
    // an IS-A-only mesh sits in no PART-OF tree
    assert.deepEqual(conceptsOfElement('FJ2428', 'FMA13884'), []);
  });

  it('finds the HRA organs by name or by the organ their element names (H3)', () => {
    const hra = JSON.parse(readFileSync(join(ROOT, 'digests', 'hra-organs', 'index.json'), 'utf8')) as { parts: [string, string, string, string][] };
    const all: BodyRow[] = [...rows, ...hra.parts.map(([element, fma, name, system]) => ({ element, fma, name, system }))];
    // no segment is named for the lung: its organ is in the element id
    const lung = findBodyStructures(all, 'lung')!;
    assert.ok(lung.elements.length >= 10 && lung.elements.every((e) => e.startsWith('lung-male/')), lung.label);
    const tonsils = findBodyStructures(all, 'palatine tonsil')!;
    assert.deepEqual(tonsils.elements.map((e) => e.split('/')[0]).sort(), ['palatine-tonsil-male-left', 'palatine-tonsil-male-right']);
    // BodyParts3D's own structures still come first
    assert.deepEqual(findBodyStructures(all, 'right femur')!.elements, ['FJ3365']);
  });
});

