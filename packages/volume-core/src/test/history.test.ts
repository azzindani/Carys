import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../history.js';

describe('History', () => {
  it('push/undo restores snapshots in order', () => {
    const h = new History<string[]>(8);
    h.push(['a']);
    h.push(['a', 'b']);
    assert.equal(h.depth, 2);
    assert.ok(h.canUndo);
    assert.deepEqual(h.undo(), ['a', 'b']);
    assert.deepEqual(h.undo(), ['a']);
    assert.equal(h.undo(), null);
    assert.ok(!h.canUndo);
  });
  it('push after undo drops the future', () => {
    const h = new History<number>(8);
    h.push(1);
    h.push(2);
    assert.equal(h.undo(), 2);
    h.push(3);
    assert.equal(h.undo(), 3);
    assert.equal(h.undo(), 1);
    assert.equal(h.undo(), null);
  });
  it('bounded depth evicts oldest', () => {
    const h = new History<number>(2);
    h.push(1);
    h.push(2);
    h.push(3);
    assert.equal(h.depth, 2);
    assert.equal(h.undo(), 3);
    assert.equal(h.undo(), 2);
    assert.equal(h.undo(), null);
  });
  it('clear empties', () => {
    const h = new History<number>(8);
    h.push(1);
    h.clear();
    assert.ok(!h.canUndo);
    assert.equal(h.depth, 0);
    assert.equal(h.undo(), null);
  });
});
