import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sliceCount, clampSlice, voxelSlices, visiblePanes } from '../layout.js';

describe('viewport layout + sync', () => {
  it('slice counts follow dims per plane', () => {
    assert.equal(sliceCount([128, 64, 32], 'axial'), 32);
    assert.equal(sliceCount([128, 64, 32], 'coronal'), 64);
    assert.equal(sliceCount([128, 64, 32], 'sagittal'), 128);
    assert.equal(sliceCount([1, 1, 1], 'axial'), 1);
  });
  it('clamp pins edges, floors, rejects NaN', () => {
    const dims: [number, number, number] = [10, 20, 30];
    assert.equal(clampSlice(-5, dims, 'axial'), 0);
    assert.equal(clampSlice(99, dims, 'axial'), 29);
    assert.equal(clampSlice(7.9, dims, 'axial'), 7);
    assert.equal(clampSlice(NaN, dims, 'coronal'), 0);
    assert.equal(clampSlice(19, dims, 'coronal'), 19);
    assert.equal(clampSlice(20, dims, 'coronal'), 19);
  });
  it('picked voxel maps to every plane slice, clamped', () => {
    assert.deepEqual(voxelSlices([5, 6, 7], [10, 20, 30]), { axial: 7, coronal: 6, sagittal: 5 });
    assert.deepEqual(voxelSlices([500, -3, 29], [10, 20, 30]), { axial: 29, coronal: 0, sagittal: 9 });
    assert.deepEqual(voxelSlices([0, 0, 0], [1, 1, 1]), { axial: 0, coronal: 0, sagittal: 0 });
  });
  it('tri shows all panes, single shows exactly one', () => {
    assert.deepEqual(visiblePanes('tri'), ['axial', 'coronal', 'sagittal']);
    assert.deepEqual(visiblePanes('axial'), ['axial']);
    assert.deepEqual(visiblePanes('coronal'), ['coronal']);
    assert.deepEqual(visiblePanes('sagittal'), ['sagittal']);
  });
});
