import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { frameVoxel, splatFramePoint, strokeFrameLine } from '../oblique-paint.js';

const ORTHO = { center: [4, 4, 2] as [number, number, number], row: [1, 0, 0] as [number, number, number], col: [0, 1, 0] as [number, number, number] };
// pure yaw 0.3 (hand-derived like the measure oracle: row=[cb,0,−sb])
const YAW = (() => {
  const b = 0.3;
  return {
    center: [4, 4, 2] as [number, number, number],
    row: [Math.cos(b), 0, -Math.sin(b)] as [number, number, number],
    col: [0, 1, 0] as [number, number, number],
  };
})();

describe('oblique paint', () => {
  it('orthogonal frame reproduces lattice taps', () => {
    assert.deepEqual(frameVoxel(ORTHO, 8, 8, 3, 5), [3, 5, 2]);
    const m = new Uint8Array(8 * 8 * 5);
    assert.equal(splatFramePoint(m, [8, 8, 5], ORTHO, 8, 8, 3, 5, 0, 1), 1);
    assert.equal(m[2 * 64 + 5 * 8 + 3], 1);
    // radius-1 disk = plus shape (5 frame pixels, same slice)
    const m2 = new Uint8Array(8 * 8 * 5);
    assert.equal(splatFramePoint(m2, [8, 8, 5], ORTHO, 8, 8, 3, 5, 1, 1), 5);
  });
  it('tilted splats land in-bounds, off-volume taps drop silently', () => {
    const m = new Uint8Array(8 * 8 * 5);
    const n = splatFramePoint(m, [8, 8, 5], YAW, 8, 8, 4, 4, 0, 1);
    assert.equal(n, 1);
    let vox = 0;
    for (const v of m) if (v) vox++;
    assert.equal(vox, 1);
    const m2 = new Uint8Array(8 * 8 * 5);
    assert.equal(splatFramePoint(m2, [8, 8, 5], YAW, 8, 8, -50, -50, 0, 1), 0);
  });
  it('frame strokes are gapless and erase round-trips', () => {
    const m = new Uint8Array(8 * 8 * 5);
    strokeFrameLine(m, [8, 8, 5], YAW, 8, 8, [1, 1], [6, 6], 0, 1);
    let vox = 0;
    for (const v of m) if (v) vox++;
    assert.ok(vox >= 6, `stroke paints ≥6 voxels, got ${vox}`);
    strokeFrameLine(m, [8, 8, 5], YAW, 8, 8, [1, 1], [6, 6], 0, 0);
    assert.ok(m.every((v) => v === 0));
  });
});
