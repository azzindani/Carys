import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY_REORIENTATION, geometryFromRasAffine, isIdentityReorientation, orientationCode,
  rasAffineFromGeometry, reorientDims, reorientGeometry, reorientVoxels, toLps, voxelToPatient,
  type PatientGeometry,
} from '../geometry.js';

const close = (a: number[], b: number[], eps = 1e-9): void => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]!) < eps, `${a} ≉ ${b}`));
};

/** 3x4x5 grid whose value encodes its own (i,j,k): 100i + 10j + k. */
function tagged(dims: [number, number, number]): Float64Array {
  const d = new Float64Array(dims[0] * dims[1] * dims[2]);
  for (let k = 0; k < dims[2]; k++) {
    for (let j = 0; j < dims[1]; j++) {
      for (let i = 0; i < dims[0]; i++) d[k * dims[0] * dims[1] + j * dims[0] + i] = 100 * i + 10 * j + k;
    }
  }
  return d;
}

describe('patient geometry', () => {
  it('reads a RAS affine as LPS geometry and writes it back', () => {
    // A NIfTI-style RAS grid: +i Right, +j Anterior, +k Superior, 2/2/3 mm.
    const ras = [[2, 0, 0, -10], [0, 2, 0, 20], [0, 0, 3, 30], [0, 0, 0, 1]];
    const g = geometryFromRasAffine(ras)!;
    close(g.spacing, [2, 2, 3]);
    close(g.direction[0], [-1, 0, 0]);
    close(g.direction[1], [0, -1, 0]);
    close(g.direction[2], [0, 0, 1]);
    close(g.origin, [10, -20, 30]);
    assert.equal(orientationCode(g.direction), 'RAS');
    rasAffineFromGeometry(g).forEach((row, r) => close(row, ras[r]!));
  });

  it('refuses a degenerate affine rather than inventing an orientation', () => {
    assert.equal(geometryFromRasAffine([[0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]), null);
  });

  it('maps RAS storage onto LPS by flipping i and j', () => {
    const r = toLps([[-1, 0, 0], [0, -1, 0], [0, 0, 1]]);
    assert.deepEqual(r, { perm: [0, 1, 2], flip: [true, true, false] });
    assert.ok(isIdentityReorientation(toLps([[1, 0, 0], [0, 1, 0], [0, 0, 1]])));
  });

  it('maps a sagittal acquisition (slices across L-R) onto LPS', () => {
    // +i Posterior, +j Inferior, +k Left: rows run front-to-back, columns
    // head-to-foot, slices across the patient.
    const r = toLps([[0, 1, 0], [0, 0, -1], [1, 0, 0]]);
    assert.deepEqual(r.perm, [2, 0, 1]);
    assert.deepEqual(r.flip, [false, false, true]);
  });

  it('snaps an oblique grid to a true permutation', () => {
    const c = Math.cos(0.3), s = Math.sin(0.3);
    const r = toLps([[c, s, 0], [-s, c, 0], [0, 0, 1]]);
    assert.deepEqual([...r.perm].sort(), [0, 1, 2]);
    assert.deepEqual(r.flip, [false, false, false]);
  });

  it('re-lays voxels out so the canonical axes read the right source voxels', () => {
    const dims: [number, number, number] = [3, 4, 5];
    const src = tagged(dims);
    const r = { perm: [2, 0, 1] as [number, number, number], flip: [false, false, true] as [boolean, boolean, boolean] };
    const cd = reorientDims(dims, r);
    assert.deepEqual(cd, [5, 3, 4]);
    const out = reorientVoxels(src, dims, r);
    // canonical (a,b,c) = source (i=b, j=3-c, k=a)
    for (const [a, b, c] of [[0, 0, 0], [4, 2, 3], [1, 1, 1], [3, 0, 2]]) {
      const v = out[c! * cd[0] * cd[1] + b! * cd[0] + a!]!;
      assert.equal(v, 100 * b! + 10 * (dims[1] - 1 - c!) + a!);
    }
  });

  it('inverse re-layout restores the source grid bit for bit', () => {
    const dims: [number, number, number] = [3, 4, 5];
    const src = tagged(dims);
    const r = { perm: [1, 2, 0] as [number, number, number], flip: [true, false, true] as [boolean, boolean, boolean] };
    const back = reorientVoxels(reorientVoxels(src, dims, r), dims, r, 'inverse');
    assert.deepEqual([...back], [...src]);
    assert.ok(reorientVoxels(Uint8Array.from([1, 2, 3, 4, 5, 6]), [1, 2, 3], IDENTITY_REORIENTATION) instanceof Uint8Array);
  });

  it('keeps every voxel at the same patient position through a re-layout', () => {
    const dims: [number, number, number] = [3, 4, 5];
    const g: PatientGeometry = geometryFromRasAffine([[0.5, 0, 0, -7], [0, 0.8, 0, 3], [0, 0, 2.5, 11], [0, 0, 0, 1]])!;
    const r = toLps(g.direction);
    const g2 = reorientGeometry(g, dims, r);
    assert.equal(orientationCode(g2.direction), 'LPS');
    close(g2.spacing, [0.5, 0.8, 2.5]);
    // canonical (a,b,c) ↔ source (2-a, 3-b, c): both must land at one point
    for (const [a, b, c] of [[0, 0, 0], [2, 3, 4], [1, 2, 3]]) {
      close(voxelToPatient(g2, [a!, b!, c!]), voxelToPatient(g, [2 - a!, 3 - b!, c!]), 1e-9);
    }
  });
});
