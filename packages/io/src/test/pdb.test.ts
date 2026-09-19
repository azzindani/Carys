import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleRange } from '@carys/volume-core';
import { parsePdb, selectResidueAtoms } from '../pdb.js';

// Real fixed-column PDB layout (cols 1-based): record 1-6, serial 7-11,
// resName 18-20, chain 22, resSeq 23-26, x 31-38, y 39-46, z 47-54,
// element 77-78.
const SNIPPET = [
  'ATOM      1  N   ALA A   1      11.104  13.207   2.100  1.00 20.00           N  ',
  'ATOM      2  CA  ALA A   1      12.104  13.207   2.100  1.00 20.00           C  ',
  'HETATM    3  O   HOH A   2      13.500  14.000   3.250  1.00 20.00           O  ',
  'ATOM      4  C   GLY B   2      13.500  14.000   3.250  1.00 20.00           C  ',
  'ATOM      5  O   GLY B   2         bad    coords   here  1.00 20.00           O  ',
  'REMARK trailing junk',
].join('\n');

describe('pdb', () => {
  it('parses ATOM fixed columns with exact coords', () => {
    const { atoms } = parsePdb(SNIPPET);
    assert.equal(atoms.length, 3);
    assert.deepEqual(atoms[0], {
      x: 11.104, y: 13.207, z: 2.1, element: 'N', chain: 'A', resSeq: 1, resName: 'ALA',
      atomName: 'N', bfactor: 20,
    });
    assert.equal(atoms[2]!.chain, 'B');
    assert.equal(atoms[2]!.resName, 'GLY');
  });
  it('sequence bundle highlights exactly its residues atoms', () => {
    const model = parsePdb(SNIPPET);
    const gly = selectResidueAtoms(model, bundleRange(1, 1));
    assert.equal(gly.length, 1);
    assert.equal(gly[0]!.resName, 'GLY');
    assert.deepEqual(selectResidueAtoms(model, bundleRange(0, 1)).length, 3);
    assert.deepEqual(selectResidueAtoms(model, { residues: [9] }), []);
    assert.deepEqual(selectResidueAtoms(model, { residues: [] }), []);
  });
  it('real 1CRN crambin: 327 atoms, 46 residues, exact first atom', () => {
    // samples/1crn.pdb vendored from https://files.rcsb.org/download/1CRN.pdb
    const m = parsePdb(readFileSync(join(process.cwd(), 'samples/1crn.pdb'), 'utf8'));
    assert.equal(m.atoms.length, 327);
    assert.equal(m.residues.length, 46);
    assert.deepEqual(m.atoms[0], {
      x: 17.047, y: 14.099, z: 3.625, element: 'N', chain: 'A', resSeq: 1, resName: 'THR',
      atomName: 'N', bfactor: 13.79,
    });
    assert.deepEqual(m.residues[0], { chain: 'A', seqId: 1, index: 0, label: 'THR1' });
    assert.ok(m.atoms.every((a) => Number.isFinite(a.x + a.y + a.z)));
  });
  it('AlphaFold ubiquitin carries pLDDT in B-factor across all bands', () => {
    // samples/af-p0cg48-ubiquitin.pdb vendored from
    // https://alphafold.ebi.ac.uk/files/AF-P0CG48-F1-model_v6.pdb (2026-09-09)
    const m = parsePdb(readFileSync(join(process.cwd(), 'samples/af-p0cg48-ubiquitin.pdb'), 'utf8'));
    assert.equal(m.atoms.length, 5417);
    const bs = m.atoms.map((a) => a.bfactor ?? NaN);
    assert.ok(bs.every((b) => Number.isFinite(b)), 'every atom needs a B-factor');
    assert.ok(Math.min(...bs) < 50 && Math.max(...bs) > 90, 'no pLDDT spread');
    for (const [lo, hi] of [[0, 50], [50, 70], [70, 90], [90, 101]] as const) {
      assert.ok(bs.some((b) => b >= lo && b < hi), `band ${lo}-${hi} empty`);
    }
  });
  it('groups residues in order, skips HETATM and bad records', () => {
    const { atoms, residues } = parsePdb(SNIPPET);
    assert.ok(atoms.every((a) => a.resName !== 'HOH'), 'HETATM leaked in');
    assert.deepEqual(residues.map((r) => r.label), ['ALA1', 'GLY2']);
    assert.deepEqual(residues.map((r) => r.chain), ['A', 'B']);
    assert.deepEqual(residues.map((r) => r.index), [0, 1]);
    assert.deepEqual(parsePdb('REMARK nothing\n').atoms, []);
  });
});
