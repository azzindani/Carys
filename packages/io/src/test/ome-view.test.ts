import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bandPlan, pickPyramidLevel } from '../ome-view.js';

describe('pyramid viewport math', () => {
  it('picks the coarsest level that still covers the viewport', () => {
    const widths = [128, 64]; // cells_demo.zarr L0/L1
    assert.equal(pickPyramidLevel(widths, 128), 0);
    assert.equal(pickPyramidLevel(widths, 129), 0);
    assert.equal(pickPyramidLevel(widths, 64), 1);
    assert.equal(pickPyramidLevel(widths, 65), 0);
    assert.equal(pickPyramidLevel(widths, 1), 1);
    assert.equal(pickPyramidLevel([256, 128, 64], 100), 1);
    assert.equal(pickPyramidLevel([256, 128, 64], 64), 2);
    assert.equal(pickPyramidLevel([256, 128, 64], 300), 0);
  });
  it('band plan tiles exactly, tail truncates', () => {
    assert.deepEqual(bandPlan(128, 64), [{ y: 0, h: 64 }, { y: 64, h: 64 }]);
    assert.deepEqual(bandPlan(130, 64), [{ y: 0, h: 64 }, { y: 64, h: 64 }, { y: 128, h: 2 }]);
    assert.deepEqual(bandPlan(32, 64), [{ y: 0, h: 32 }]);
  });
  it('hostile input fails loud with named errors', () => {
    assert.throws(() => pickPyramidLevel([], 64), /ome-view-levels/);
    assert.throws(() => pickPyramidLevel([128, -4], 64), /ome-view-levels/);
    assert.throws(() => pickPyramidLevel([128, 64], 0), /ome-view-target/);
    assert.throws(() => pickPyramidLevel([128, 64], NaN), /ome-view-target/);
    assert.throws(() => bandPlan(0), /ome-view-height/);
    assert.throws(() => bandPlan(128, 0), /ome-view-band/);
  });
});
