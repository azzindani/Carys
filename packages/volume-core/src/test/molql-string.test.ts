import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MolqlError, parseMolPredicate, parseMolQuery, runMolPredicate, runMolQuery, runMolQueryString, runMolPredicateString } from '../molql.js';
import type { StructureModel } from '../structure.js';

function model(): StructureModel {
  const atom = (o: Partial<StructureModel['hierarchy']['atoms'][number]>) => ({
    type_symbol: 'C', label_atom_id: 'CA', label_comp_id: 'ALA',
    label_asym_id: 'A', auth_asym_id: 'A', label_seq_id: 1, auth_seq_id: 1,
    x: 0, y: 0, z: 0, occupancy: 1, b_iso: 20, ...o,
  });
  return {
    hierarchy: {
      atoms: [
        atom({ label_asym_id: 'A', auth_asym_id: 'A', label_seq_id: 12, auth_seq_id: 12 }),
        atom({ label_asym_id: 'B', auth_asym_id: 'B', label_seq_id: 12, auth_seq_id: 12, type_symbol: 'N', label_atom_id: 'N' }),
        atom({ label_asym_id: 'A', auth_asym_id: 'A', label_seq_id: 30, auth_seq_id: 30 }),
      ],
      residues: [], chains: [], residueOffsets: [], chainOffsets: [],
    },
    units: [], entities: [],
  };
}

describe('molql strings', () => {
  it('each field filters exactly like its JSON form (table)', () => {
    const m = model();
    const cases: Array<[string, number[]]> = [
      ['chain B', [1]],
      ['resi 30', [2]],
      ['resi 10:20', [0, 1]],
      ['resi 20:10', [0, 1]], // normalized either direction, like bundleRange
      ['atom N', [1]],
      ['element N', [1]],
      ['chain A and resi 30', [2]],
      ['CHAIN A and RESI 10:20 and ATOM CA', [0]], // keywords case-insensitive
      ['chain Z', []],
    ];
    for (const [q, want] of cases) {
      assert.deepEqual(runMolQueryString(m, q), want, q);
      assert.deepEqual(runMolQuery(m, parseMolQuery(q)), want, `${q} (parsed form agrees)`);
    }
  });
  it('malformed queries rejected with named error (table)', () => {
    const bad = [
      '', '   ', 'chain', 'chain and resi 1', 'and chain A', 'chain A and',
      'chain A resi 1', 'foo A', 'resi x', 'resi 1:2:3', 'resi :10',
      'chain A and chain B', 'element', 'atom CA and atom N',
    ];
    for (const q of bad) {
      assert.throws(() => parseMolQuery(q), (e: unknown) => e instanceof MolqlError, JSON.stringify(q));
    }
  });
});
describe('molql predicates', () => {
  it('OR/NOT/parens evaluate with NOT > AND > OR precedence (table)', () => {
    const m = model();
    const cases: Array<[string, number[]]> = [
      ['chain A or chain B', [0, 1, 2]],
      ['chain B or element N', [1]],
      ['not chain A', [1]],
      ['not not chain B', [1]],
      ['chain A and not resi 30', [0]],
      ['(chain B or element C) and resi 12', [0, 1]],
      ['not (chain A and resi 30)', [0, 1]],
      ['chain B or chain A and resi 30', [1, 2]], // AND binds tighter
      ['(chain B or chain A) and resi 30', [2]],
      ['CHAIN A OR CHAIN B', [0, 1, 2]],
      ['atom N or (element C and resi 30)', [1, 2]],
    ];
    for (const [q, want] of cases) {
      assert.deepEqual(runMolPredicateString(m, q), want, q);
      assert.deepEqual(runMolPredicate(m, parseMolPredicate(q)), want, `${q} (parsed form agrees)`);
    }
  });
  it('malformed predicates rejected with named error (table)', () => {
    const bad = [
      '', '   ', 'and', 'or', 'not', 'chain A or', 'chain A and',
      '(chain A', 'chain A)', '()', '( )', 'foo A', 'chain', 'resi 1:2:3',
      'chain A and and chain B', 'chain A resi 1', 'not )', '(not)',
    ];
    for (const q of bad) {
      assert.throws(() => parseMolPredicate(q), (e: unknown) => e instanceof MolqlError, JSON.stringify(q));
    }
  });
});
