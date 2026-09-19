import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cellAt, downsampleTile, labelCells } from '../cells.js';

describe('cell table', () => {
  it('labels two squares, stats exact, scan order fixes ids', () => {
    // 6x4: 2x2 block at (0,0) value 100, single at (5,3) value 50
    const t = new Array(24).fill(0);
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) t[y * 6 + x] = 100;
    t[3 * 6 + 5] = 50;
    const tab = labelCells(t, 6, 4, 10);
    assert.equal(tab.count, 2);
    assert.deepEqual(tab.cells.map((c) => c.id), [1, 2]);
    const a = tab.cells[0]!;
    assert.equal(a.area, 4);
    assert.equal(a.mean, 100);
    assert.deepEqual([a.x0, a.y0, a.x1, a.y1], [0, 0, 1, 1]);
    assert.ok(Math.abs(a.cx - 0.5) < 1e-9 && Math.abs(a.cy - 0.5) < 1e-9);
    assert.equal(tab.cells[1]!.area, 1);
    // diagonals never merge: 4-neighbourhood only
    const d = [1, 0, 0, 1];
    assert.equal(labelCells(d, 2, 2, 0).count, 2);
  });
  it('CellProfiler-studied shape columns: perimeter/extent/formFactor/aspect exact', () => {
    // 2x2 block: 8 exposed edges, full bbox, formFactor π/4, square.
    const t = new Array(16).fill(0);
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) t[y * 4 + x] = 100;
    const a = labelCells(t, 4, 4, 10).cells[0]!;
    assert.equal(a.perimeter, 8);
    assert.equal(a.extent, 1);
    assert.ok(Math.abs(a.formFactor - Math.PI / 4) < 1e-9);
    assert.equal(a.aspect, 1);
    // 1x4 bar: 10 exposed edges, aspect 4, less round than the block.
    const b = labelCells([100, 100, 100, 100], 4, 1, 10).cells[0]!;
    assert.equal(b.perimeter, 10);
    assert.equal(b.aspect, 4);
    assert.ok(b.formFactor < a.formFactor);
    // L-tromino (3 px, 4-connected): concave corner adds edges — 8 for
    // 3 px, vs 8 for the 4 px block (concavity costs perimeter per area).
    const L = [100, 100, 0, 100, 0, 0, 0, 0, 0];
    const c = labelCells(L, 3, 3, 10).cells[0]!;
    assert.equal(c.area, 3);
    assert.equal(c.perimeter, 8);
    assert.ok(c.extent < 1);
    assert.ok(c.formFactor < a.formFactor);
  });
  it('minArea drops dust, threshold is strict, lookup clamps', () => {
    const t = [0, 200, 0, 0, 0, 0, 0, 0, 0];
    assert.equal(labelCells(t, 3, 3, 10, 2).count, 0);
    assert.equal(labelCells(t, 3, 3, 10, 1).count, 1);
    assert.equal(labelCells(t, 3, 3, 200, 1).count, 0); // > is strict
    const tab = labelCells(t, 3, 3, 10, 1);
    assert.equal(cellAt(tab, 1, 0), 1);
    assert.equal(cellAt(tab, 0, 0), 0);
    assert.equal(cellAt(tab, 99, 99), 0);
    assert.equal(cellAt(tab, -1, 0), 0);
  });
  it('downsample block-means, odd edges average what exists', () => {
    const { data, w, h } = downsampleTile([0, 2, 4, 6], 2, 2, 2);
    assert.deepEqual([w, h], [1, 1]);
    assert.equal(data[0], 3);
    const odd = downsampleTile([1, 1, 1, 1, 1, 1], 3, 2, 2);
    assert.deepEqual([odd.w, odd.h], [2, 1]);
    assert.equal(odd.data[0], 1);
    assert.throws(() => downsampleTile([1], 1, 1, 0), /cells-factor/);
  });
  it('hostile input fails loud with named errors', () => {
    assert.throws(() => labelCells([1, 2], 0, 2, 1), /cells-dims/);
    assert.throws(() => labelCells([1, 2], 1, 1, 1), /cells-length/);
    assert.throws(() => labelCells([1], 1, 1, NaN), /cells-threshold/);
    assert.throws(() => labelCells([1], 1, 1, 1, 0), /cells-min-area/);
  });
});
