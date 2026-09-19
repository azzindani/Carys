import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { iopEdgeLabels } from '../orientation.js';

type Iop = [number, number, number, number, number, number];

describe('iop edge labels', () => {
  it('identity IOP labels all three planes', () => {
    const id: Iop = [1, 0, 0, 0, 1, 0];
    assert.deepEqual(iopEdgeLabels(id, 'axial'), { left: 'R', right: 'L', top: 'A', bottom: 'P' });
    assert.deepEqual(iopEdgeLabels(id, 'coronal'), { left: 'R', right: 'L', top: 'I', bottom: 'S' });
    assert.deepEqual(iopEdgeLabels(id, 'sagittal'), { left: 'A', right: 'P', top: 'I', bottom: 'S' });
  });
  it('flipped row/column cosines mirror the labels', () => {
    assert.deepEqual(
      iopEdgeLabels([-1, 0, 0, 0, 1, 0], 'axial'),
      { left: 'L', right: 'R', top: 'A', bottom: 'P' },
    );
    assert.deepEqual(
      iopEdgeLabels([1, 0, 0, 0, -1, 0], 'axial'),
      { left: 'R', right: 'L', top: 'P', bottom: 'A' },
    );
  });
  it('non-axial acquisition returns null instead of guessing', () => {
    // direct coronal acquisition: column cosine carries z
    assert.equal(iopEdgeLabels([1, 0, 0, 0, 0, -1], 'coronal'), null);
    assert.equal(iopEdgeLabels([1, 0, 0, 0, 0, -1], 'axial'), null);
  });
  it('zero IOP falls back to identity (LPS-ordered converts)', () => {
    assert.deepEqual(
      iopEdgeLabels([0, 0, 0, 0, 0, 0], 'axial'),
      { left: 'R', right: 'L', top: 'A', bottom: 'P' },
    );
  });
});
