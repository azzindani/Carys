import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitMapToModel, sampleMap, type MapFitMap } from '../mapfit.js';
import type { ResidueRef } from '../sequence.js';

const R = (index: number): ResidueRef => ({
  chain: 'A', seqId: index + 1, index, label: `ALA${index + 1}`,
});

// 5x5x5 map, unit spacing/origin, density 10 in the central 3x3x3 block.
function blockMap(): MapFitMap {
  const data = new Float64Array(125);
  for (let z = 1; z <= 3; z++) {
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) data[z * 25 + y * 5 + x] = 10;
    }
  }
  return { dims: [5, 5, 5], spacing: [1, 1, 1], origin: [0, 0, 0], data };
}

describe('map fit stub', () => {
  it('trilinear sampling is exact on lattice, null outside', () => {
    const m = blockMap();
    assert.equal(sampleMap(m, 2, 2, 2), 10);
    assert.equal(sampleMap(m, 0, 0, 0), 0);
    assert.equal(sampleMap(m, 1.5, 2, 2), 10);
    assert.equal(sampleMap(m, 0.5, 0, 0), 0);
    assert.equal(sampleMap(m, 5, 2, 2), null);
    assert.equal(sampleMap(m, -0.1, 2, 2), null);
  });
  it('model inside density scores full inclusion with zero translation', () => {
    const residues = [R(0), R(1), R(2)];
    const pos = new Map([[0, [1.5, 2, 2]], [1, [2, 2, 2]], [2, [2.5, 2, 2]]] as [number, [number, number, number]][]);
    const r = fitMapToModel(residues, pos, blockMap(), { contour: 5 });
    assert.deepEqual(r.translation, [0, 0, 0]);
    assert.equal(r.nScored, 3);
    assert.equal(r.nIncluded, 3);
    assert.equal(r.inclusion, 1);
    assert.ok(r.perResidue.every((f) => f.density === 10 && f.included));
  });
  it('offset model translates to density, outsiders stay excluded', () => {
    const residues = [R(0), R(1), R(2), R(3)];
    // Docking uses the CA centroid of ALL positioned residues, so the
    // outlier drags the frame: the centroid (17.5) pulls every CA far from
    // the block. The honest assertion is the translation itself (mass
    // centroid 2 − model centroid 17.5) plus the outsider staying null —
    // the stub does not pretend a global fit rescues far outliers.
    const pos = new Map([
      [0, [9.5, 2, 2]], [1, [10, 2, 2]], [2, [10.5, 2, 2]], [3, [40, 2, 2]],
    ] as [number, [number, number, number]][]);
    const r = fitMapToModel(residues, pos, blockMap(), { contour: 5 });
    // centroid x = (9.5+10+10.5+40)/4 = 17.5 → tx = 2-17.5
    assert.ok(Math.abs(r.translation[0] + 15.5) < 1e-9);
    assert.equal(r.nScored, 0);
    assert.equal(r.nIncluded, 0);
    assert.ok(Number.isNaN(r.inclusion));
    assert.equal(r.perResidue[3]!.density, null);
    assert.equal(r.perResidue[3]!.included, false);
  });
  it('nearby pair docks inside with full inclusion', () => {
    const pair = new Map([[0, [1.5, 2, 2]], [1, [2.5, 2, 2]]] as [number, [number, number, number]][]);
    const r = fitMapToModel([R(0), R(1)], pair, blockMap(), { contour: 5 });
    assert.deepEqual(r.translation, [0, 0, 0]);
    assert.equal(r.nScored, 2);
    assert.equal(r.nIncluded, 2);
    assert.equal(r.inclusion, 1);
  });
  it('empty map centers on the frame, contour gates inclusion', () => {
    const residues = [R(0)];
    const pos = new Map([[0, [0, 0, 0]]] as [number, [number, number, number]][]);
    const empty: MapFitMap = { dims: [4, 4, 4], spacing: [1, 1, 1], origin: [0, 0, 0], data: new Float64Array(64) };
    const r = fitMapToModel(residues, pos, empty, { contour: 1 });
    assert.deepEqual(r.translation, [1.5, 1.5, 1.5]);
    assert.equal(r.nScored, 1);
    assert.equal(r.nIncluded, 0);
    assert.equal(r.inclusion, 0);
  });
  it('hostile input fails loud with named errors', () => {
    const residues = [R(0)];
    const pos = new Map([[0, [1, 1, 1]]] as [number, [number, number, number]][]);
    const m = blockMap();
    assert.throws(() => fitMapToModel([], pos, m), /mapfit-empty/);
    assert.throws(() => fitMapToModel(residues, new Map(), m), /mapfit-empty/);
    assert.throws(() => fitMapToModel(residues, pos, { ...m, dims: [5, 5, 0] as [number, number, number] }), /mapfit-dims/);
    assert.throws(() => fitMapToModel(residues, pos, { ...m, spacing: [1, 0, 1] as [number, number, number] }), /mapfit-spacing/);
    assert.throws(() => fitMapToModel(residues, pos, { ...m, data: new Float64Array(3) }), /mapfit-length/);
    assert.throws(() => fitMapToModel(residues, pos, m, { contour: NaN }), /mapfit-contour/);
  });
});
