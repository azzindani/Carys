import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { drawPt, drawPenLine, UndoStack, encodeRLE, decodeRLE } from '../drawing.js';

describe('drawing', () => {
  it('drawPt paints in bounds, ignores out of bounds', () => {
    const m = new Uint8Array(8);
    drawPt(m, 2, 2, 2, 1, 1, 1, 7);
    assert.equal(m[7], 7);
    drawPt(m, 2, 2, 2, 9, 9, 9, 7); // no throw
    assert.equal(m.reduce((a, b) => a + b, 0), 7);
  });
  it('drawPenLine connects endpoints without gaps', () => {
    const m = new Uint8Array(125);
    drawPenLine(m, 5, 5, 5, [0, 0, 0], [4, 4, 4], 1);
    assert.equal(m[0], 1);
    assert.equal(m[124], 1);
    assert.ok(m.reduce((a, b) => a + b, 0) >= 5, 'gaps in line');
  });
  it('UndoStack push/undo round-trips masks', () => {
    const u = new UndoStack(4);
    const a = Uint8Array.from([1, 0, 1]);
    const b = Uint8Array.from([1, 1, 1]);
    u.push(a);
    u.push(b);
    const back = u.undo(3);
    assert.deepEqual([...back!], [1, 0, 1]);
    assert.equal(u.undo(3), null); // bottom reached
  });
  it('RLE round-trips runs and literals', () => {
    const m = Uint8Array.from([0, 0, 0, 5, 1, 2, 3, 0, 0]);
    assert.deepEqual([...decodeRLE(encodeRLE(m), m.length)], [...m]);
  });
});
