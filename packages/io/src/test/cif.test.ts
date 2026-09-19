import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CifError, isCifLike, parseCif } from '../cif.js';
import { parsePdb } from '../pdb.js';

// Hand-written mmCIF exercising quotes, a semicolon block (containing a
// fake loop_ line), HETATM skip, '?' B-factor, bad coords, comments.
const SNIPPET = [
  'data_demo',
  '# a comment',
  "_struct.title 'A \"quoted\" title'",
  '_struct.details',
  ';',
  'multiline block; loop_ must not confuse the tokenizer',
  ';',
  'loop_',
  '_atom_site.group_PDB',
  '_atom_site.id',
  '_atom_site.type_symbol',
  '_atom_site.label_comp_id',
  '_atom_site.auth_asym_id',
  '_atom_site.auth_seq_id',
  '_atom_site.label_atom_id',
  '_atom_site.Cartn_x',
  '_atom_site.Cartn_y',
  '_atom_site.Cartn_z',
  '_atom_site.B_iso_or_equiv',
  'ATOM 1 C ALA A 1 N 11.104 13.207 2.100 20.00',
  'ATOM 2 C ALA A 1 CA 12.104 13.207 2.100 ?',
  'HETATM 3 O HOH A 2 O 13.500 14.000 3.250 20.00',
  "ATOM 4 C GLY 'B' 2 C 13.500 14.000 3.250 20.00",
  'ATOM 5 O GLY B 2 O bad coords here 20.00',
  '# trailing comment',
].join('\n');

describe('cif', () => {
  it('atom_site loop parses with quotes, blocks, skips', () => {
    assert.ok(isCifLike(SNIPPET));
    assert.ok(!isCifLike('ATOM      1  N   ALA A   1      11.104  13.207   2.100'));
    const { atoms, residues } = parseCif(SNIPPET);
    assert.equal(atoms.length, 3);
    assert.deepEqual(atoms[0], {
      x: 11.104, y: 13.207, z: 2.1, element: 'C', chain: 'A', resSeq: 1, resName: 'ALA',
      atomName: 'N', bfactor: 20,
    });
    assert.ok(!('bfactor' in atoms[1]!), '? B-factor must be absent, not NaN');
    assert.equal(atoms[2]!.chain, 'B');
    assert.ok(atoms.every((a) => a.resName !== 'HOH'), 'HETATM leaked in');
    assert.deepEqual(residues.map((r) => r.label), ['ALA1', 'GLY2']);
    assert.deepEqual(residues.map((r) => r.index), [0, 1]);
  });
  it('same structure in PDB and CIF yields identical models', () => {
    const pdb = [
      'ATOM      1  N   ALA A   1      11.104  13.207   2.100  1.00 20.00           N  ',
      'ATOM      2  CA  ALA A   1      12.104  13.207   2.100  1.00 20.00           C  ',
      'ATOM      4  C   GLY B   2      13.500  14.000   3.250  1.00 20.00           C  ',
    ].join('\n');
    const cif = [
      'data_equiv',
      'loop_',
      '_atom_site.group_PDB',
      '_atom_site.id',
      '_atom_site.label_atom_id',
      '_atom_site.type_symbol',
      '_atom_site.label_comp_id',
      '_atom_site.auth_asym_id',
      '_atom_site.auth_seq_id',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      '_atom_site.B_iso_or_equiv',
      'ATOM 1 N N ALA A 1 11.104 13.207 2.100 20.00',
      'ATOM 2 CA C ALA A 1 12.104 13.207 2.100 20.00',
      'ATOM 4 C C GLY B 2 13.500 14.000 3.250 20.00',
    ].join('\n');
    const a = parsePdb(pdb);
    const b = parseCif(cif);
    assert.deepEqual(b.atoms, a.atoms);
    assert.deepEqual(b.residues, a.residues);
  });
  it('label_* columns backstop missing auth_* columns', () => {
    const cif = [
      'data_labels',
      'loop_',
      '_atom_site.group_PDB',
      '_atom_site.type_symbol',
      '_atom_site.label_comp_id',
      '_atom_site.label_asym_id',
      '_atom_site.label_seq_id',
      '_atom_site.label_atom_id',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      'ATOM C SER C 10 C 1.000 2.000 3.000',
    ].join('\n');
    const { atoms, residues } = parseCif(cif);
    assert.equal(atoms.length, 1);
    assert.equal(atoms[0]!.chain, 'C');
    assert.equal(atoms[0]!.resSeq, 10);
    assert.deepEqual(residues.map((r) => r.label), ['SER10']);
  });
  it('absent loop, missing columns, bad quotes are loud (table)', () => {
    const cases: { name: string; text: string; kind: string }[] = [
      { name: 'no-loop', text: 'data_x\n_struct.title hello\n', kind: 'no-atom-site' },
      {
        name: 'no-coords',
        text: 'data_x\nloop_\n_atom_site.group_PDB\n_atom_site.id\nATOM 1\n',
        kind: 'no-atom-site',
      },
      {
        name: 'missing-ids',
        text: 'data_x\nloop_\n_atom_site.group_PDB\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\nATOM 1.0 2.0 3.0\n',
        kind: 'missing-ids',
      },
      {
        name: 'bad-quote',
        text: "data_x\n_struct.title 'oops\nloop_\n_atom_site.Cartn_x\n",
        kind: 'bad-quote',
      },
    ];
    for (const c of cases) {
      assert.throws(
        () => parseCif(c.text),
        (e: unknown) => e instanceof CifError && e.kind === c.kind,
        c.name,
      );
    }
  });
});
