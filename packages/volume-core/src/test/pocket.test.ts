import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findPockets } from '../pocket.js';
import type { ResidueRef } from '../sequence.js';

const R = (index: number, extra: Partial<ResidueRef> = {}): ResidueRef => ({
  chain: 'A', seqId: index + 1, index, label: `ALA${index + 1}`, ...extra,
});

describe('pocket', () => {
  it('finds an exposed loop off a buried helix', () => {
    // helix: 8 residues packed at 3.8Å steps (buried); loop: 4 residues
    // sticking out 30Å away (exposed, mutually adjacent, helix far enough
    // that chain adjacency can't bridge the gap)
    const residues = Array.from({ length: 12 }, (_, i) => R(i));
    const pos = new Map<number, [number, number, number]>();
    for (let i = 0; i < 8; i++) pos.set(i, [i * 3.8, 0, 0]);
    for (let i = 8; i < 12; i++) pos.set(i, [30 + (i - 8) * 3.8, 30, 0]);
    const pockets = findPockets(residues, pos, { contactA: 8, buriedCutoff: 4, minSize: 3 });
    assert.equal(pockets.length, 1);
    assert.deepEqual(pockets[0]!.residues.map((r) => r.index), [8, 9, 10, 11]);
    assert.ok(pockets[0]!.meanNeighbors < 4);
  });
  it('all-buried chain yields no pockets; minSize filters singletons', () => {
    const residues = Array.from({ length: 6 }, (_, i) => R(i));
    const pos = new Map(residues.map((r) => [r.index, [r.index * 3.8, 0, 0]] as [number, [number, number, number]]));
    assert.deepEqual(findPockets(residues, pos, { contactA: 8, buriedCutoff: 0 }), []);
    assert.deepEqual(findPockets(residues, pos, { contactA: 8, buriedCutoff: 99, minSize: 99 }), []);
  });
  it('bad inputs throw named errors', () => {
    const residues = [R(0)];
    const pos = new Map([[0, [0, 0, 0]] as [number, [number, number, number]]]);
    assert.throws(() => findPockets([], new Map()), /pocket-empty/);
    assert.throws(() => findPockets(residues, pos, { contactA: 0 }), /pocket-contact/);
    assert.throws(() => findPockets(residues, pos, { minSize: 0 }), /pocket-minsize/);
  });
});
