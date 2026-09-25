import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AssemblyError, BEAD_ATOM_RADIUS, MAT34_IDENTITY, applyMat34, assemblyCopies, beadsOf, composeOps,
  expandPoints, parseOperExpression, type AssemblyDef, type Mat34,
} from '../assembly.js';
import { parseAssemblyCif } from '../assembly-cif.js';
import { CifError, cifCategories, cifTokens } from '../cif-tokens.js';

/** A quarter turn about z, and a shift along x. */
const ROT_Z: Mat34 = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const SHIFT_X: Mat34 = [1, 0, 0, 10, 0, 1, 0, 0, 0, 0, 1, 0];

describe('oper_expression (H7)', () => {
  it('reads single operators, lists, ranges and products', () => {
    assert.deepEqual(parseOperExpression('1'), [['1']]);
    assert.deepEqual(parseOperExpression('P'), [['P']]);
    assert.deepEqual(parseOperExpression('(1,6,11)'), [['1'], ['6'], ['11']]);
    assert.equal(parseOperExpression('(1-60)').length, 60);
    assert.deepEqual(parseOperExpression('(1-60)')[59], ['60']);
    assert.deepEqual(parseOperExpression('(X0)(1-3)'), [['X0', '1'], ['X0', '2'], ['X0', '3']]);
    assert.equal(parseOperExpression('(1-60)(61-88)').length, 60 * 28);
    assert.deepEqual(parseOperExpression(' (1-2, 5) '), [['1'], ['2'], ['5']]);
  });

  it('fails loud on what it cannot read', () => {
    for (const bad of ['', '(1-', '(5-1)', '(1,,2)', '(a b)', '(1)x', '1-']) {
      assert.throws(() => parseOperExpression(bad), AssemblyError, JSON.stringify(bad));
    }
  });

  it('composes left to right, the rightmost operator first', () => {
    const ops = new Map<string, Mat34>([['R', ROT_Z], ['T', SHIFT_X]]);
    // T after R: (1,0,0) turns to (0,1,0), then shifts to (10,1,0)
    assert.deepEqual(applyMat34(composeOps(['T', 'R'], ops), 1, 0, 0), [10, 1, 0]);
    // R after T: (11,0,0) turns to (0,11,0)
    assert.deepEqual(applyMat34(composeOps(['R', 'T'], ops), 1, 0, 0), [0, 11, 0]);
    assert.deepEqual(composeOps([], ops), MAT34_IDENTITY);
    assert.throws(() => composeOps(['Q'], ops), /operator Q/);
  });
});

describe('assembly expansion (H7)', () => {
  const ops = new Map<string, Mat34>([['1', MAT34_IDENTITY], ['2', ROT_Z], ['X0', SHIFT_X]]);
  const def = (gens: AssemblyDef['gens']): AssemblyDef => ({ id: '1', details: '', oligomericCount: NaN, gens });
  // chain A: two atoms, chain B: one
  const pts = { count: 3, x: [1, 2, 5], y: [0, 0, 5], z: [0, 1, 0], asym: [0, 0, 1] };

  it('names copies as RCSB assembly files do', () => {
    const copies = assemblyCopies(def([{ opers: '(1-2)', asyms: ['A', 'B'] }, { opers: '(X0)(2)', asyms: ['A'] }]), ['A', 'B'], ops);
    assert.deepEqual(copies.map((c) => c.label), ['A', 'B', 'A-2', 'B-2', 'A-X0x2']);
    assert.throws(() => assemblyCopies(def([{ opers: '1', asyms: ['C'] }]), ['A', 'B'], ops), /chain C/);
    assert.throws(() => assemblyCopies(def([{ opers: '7', asyms: ['A'] }]), ['A', 'B'], ops), /operator 7/);
  });

  it('places every point of each copy through its operator', () => {
    const copies = assemblyCopies(def([{ opers: '(1-2)', asyms: ['A', 'B'] }, { opers: '(X0)(2)', asyms: ['A'] }]), ['A', 'B'], ops);
    const e = expandPoints(pts, copies);
    assert.equal(e.count, 2 + 1 + 2 + 1 + 2);
    assert.deepEqual([...e.copy], [0, 0, 1, 2, 2, 3, 4, 4]);
    assert.deepEqual([...e.source], [0, 1, 2, 0, 1, 2, 0, 1]);
    for (let k = 0; k < e.count; k++) {
      const i = e.source[k]!;
      const want = applyMat34(copies[e.copy[k]!]!.m, pts.x[i]!, pts.y[i]!, pts.z[i]!);
      assert.ok(Math.hypot(e.x[k]! - want[0], e.y[k]! - want[1], e.z[k]! - want[2]) < 1e-5);
    }
    // A-X0x2: (1,0,0) turns to (0,1,0), shifts to (10,1,0)
    assert.deepEqual([e.x[6], e.y[6], e.z[6]], [10, 1, 0]);
  });

  it('makes beads that keep the atoms\' volume and centre', () => {
    const p = { count: 5, x: [0, 2, 0, 9, 7], y: [0, 0, 3, 9, 7], z: [0, 0, 0, 9, 7], asym: [0, 0, 0, 1, 1] };
    const b = beadsOf(p, [0, 0, 0, -1, 1]);
    assert.equal(b.count, 2);
    assert.deepEqual([b.x[0], b.y[0], b.z[0]], [2 / 3, 1, 0]);
    assert.deepEqual([b.atoms[0], b.atoms[1]], [3, 1]);
    assert.deepEqual([b.asym[0], b.asym[1], b.first[1]], [0, 1, 4]);
    // bead volume = the volume of its atoms at BEAD_ATOM_RADIUS each
    assert.ok(Math.abs(b.r[0]! ** 3 - 3 * BEAD_ATOM_RADIUS ** 3) < 1e-4);
    assert.ok(Math.abs(b.r[1]! - BEAD_ATOM_RADIUS) < 1e-6);
    assert.throws(() => beadsOf(p, [0, 0, 0, 0, 1]), /spans chains/);
    assert.throws(() => beadsOf(p, [0, 0, 0, 2, 2]), /group 1 has no atoms/);
  });
});

const TINY = `data_9XYZ
_entry.id 9XYZ
_struct.title 'A VIRUS'S TINY SHELL'
loop_
_entity.id
_entity.type
_entity.pdbx_description
1 polymer 'coat protein'
2 water water
#
_pdbx_struct_assembly.id 1
_pdbx_struct_assembly.details 'complete icosahedral assembly'
_pdbx_struct_assembly.oligomeric_count 2
_pdbx_struct_assembly_gen.assembly_id 1
_pdbx_struct_assembly_gen.oper_expression '(1-2)'
_pdbx_struct_assembly_gen.asym_id_list A,B
loop_
_pdbx_struct_oper_list.id
_pdbx_struct_oper_list.matrix[1][1]
_pdbx_struct_oper_list.matrix[1][2]
_pdbx_struct_oper_list.matrix[1][3]
_pdbx_struct_oper_list.vector[1]
_pdbx_struct_oper_list.matrix[2][1]
_pdbx_struct_oper_list.matrix[2][2]
_pdbx_struct_oper_list.matrix[2][3]
_pdbx_struct_oper_list.vector[2]
_pdbx_struct_oper_list.matrix[3][1]
_pdbx_struct_oper_list.matrix[3][2]
_pdbx_struct_oper_list.matrix[3][3]
_pdbx_struct_oper_list.vector[3]
1 1 0 0 0 0 1 0 0 0 0 1 0
2 -1 0 0 0 0 -1 0 0 0 0 1 0
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_entity_id
_atom_site.label_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.auth_seq_id
_atom_site.pdbx_PDB_model_num
ATOM 1 N N GLY A 1 1 10.0 0.0 0.0 5 1
ATOM 2 C CA GLY A 1 1 11.0 0.0 0.0 5 1
ATOM 3 C CA ALA A 1 2 12.0 1.0 0.0 6 1
HETATM 4 O O HOH B 2 . 20.0 0.0 0.0 101 1
ATOM 5 N N GLY A 1 1 99.0 99.0 99.0 5 2
`;

describe('assembly mmCIF (H7)', () => {
  it('reads atoms of the first model, chains, residues and operators', () => {
    const u = parseAssemblyCif(TINY);
    assert.equal(u.id, '9XYZ');
    assert.equal(u.title, "A VIRUS'S TINY SHELL");
    assert.equal(u.count, 4);
    assert.deepEqual(u.asymIds, ['A', 'B']);
    assert.deepEqual(u.asymEntity, ['1', '2']);
    assert.deepEqual([...u.residue], [0, 0, 1, -1]);
    assert.equal(u.residueCount, 2);
    assert.deepEqual([...u.polymerChain], [0, 0, 0, -1]);
    assert.deepEqual(u.element, ['N', 'C', 'C', 'O']);
    assert.deepEqual([...u.seq], [5, 5, 6, 101]);
    assert.equal(u.entities.get('1'), 'coat protein');
    assert.equal(u.assemblies.length, 1);
    assert.deepEqual(u.assemblies[0]!.gens, [{ opers: '(1-2)', asyms: ['A', 'B'] }]);
    const copies = assemblyCopies(u.assemblies[0]!, u.asymIds, u.operators);
    const e = expandPoints(u, copies);
    assert.equal(e.count, 8);
    // chain A under operator 2: a half turn about z
    assert.deepEqual([e.x[4], e.y[4], e.z[4]], [-10, 0, 0]);
  });

  it('fails loud on a missing column or matrix', () => {
    assert.throws(() => parseAssemblyCif(TINY.replace(/_atom_site.label_seq_id/, '_atom_site.other_id')), CifError);
    assert.throws(() => parseAssemblyCif(TINY.replace('2 -1 0 0 0', '2 -1 0 ? 0')), /operator 2/);
    assert.throws(() => parseAssemblyCif('data_x\n_entry.id x\n'), CifError);
  });
});

describe('CIF tokens (H7)', () => {
  it('closes a quote only before whitespace', () => {
    assert.deepEqual(cifTokens(`_a 'VIRUS'S COAT' "O5'" 'x'`), ['_a', "VIRUS'S COAT", "O5'", 'x']);
    assert.throws(() => cifTokens(`_a 'open`), CifError);
  });

  it('reads a category from single items or a loop alike', () => {
    const toks = cifTokens(`data_t\n_cell.a 10\n_cell.b 'twenty one'\nloop_\n_op.id\n_op.name\n1 one\n2 two\n`);
    const cats = cifCategories(toks, ['cell', 'op', 'absent']);
    assert.deepEqual(cats.get('cell'), [{ a: '10', b: 'twenty one' }]);
    assert.deepEqual(cats.get('op'), [{ id: '1', name: 'one' }, { id: '2', name: 'two' }]);
    assert.deepEqual(cats.get('absent'), []);
    assert.throws(() => cifCategories(cifTokens('_cell.a\n_cell.b 2'), ['cell']), /has no value/);
  });
});
