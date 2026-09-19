import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { angle, frameDiff, length, maskVolume, maskStatsToCSV, profileLine } from '../measure.js';
import { mulberry32 } from './rng.js';

const SP: [number, number, number] = [0.5, 0.5, 2];

describe('measure cases', () => {
  it('length exact on 60 random segments', () => {
    const rng = mulberry32(7777);
    for (let t = 0; t < 60; t++) {
      const a: [number, number, number] = [rng() * 10, rng() * 10, rng() * 10];
      const b: [number, number, number] = [rng() * 10, rng() * 10, rng() * 10];
      const got = length(a, b, [1, 1, 1]);
      const want = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      assert.ok(Math.abs(got - want) < 1e-9, `case ${t}`);
      assert.equal(length(a, a, SP), 0, `case ${t}`);
    }
  });
  it('length honors anisotropic spacing', () => {
    assert.equal(length([0, 0, 0], [1, 0, 0], SP), 0.5);
    assert.equal(length([0, 0, 0], [0, 0, 1], SP), 2);
  });
  it('right angle is 90 degrees', () => {
    const g = angle([1, 0, 0], [0, 0, 0], [0, 1, 0]);
    assert.ok(Math.abs(g - 90) < 1e-9, `${g}`);
  });
  it('known angles exact, randoms bounded (40 vectors)', () => {
    // exact protractor cases (axis rotations)
    const exact: [[number, number, number], [number, number, number], number][] = [
      [[1, 0, 0], [0, 1, 0], 90],
      [[1, 0, 0], [1, 0, 0], 0],
      [[1, 0, 0], [-1, 0, 0], 180],
      [[1, 0, 0], [1, 1, 0], 45],
      [[1, 1, 0], [1, -1, 0], 90],
      [[2, 0, 0], [1, Math.sqrt(3), 0], 60],
    ];
    for (const [a, b, want] of exact) {
      const g = angle(a, [0, 0, 0], b);
      assert.ok(Math.abs(g - want) < 1e-9, `${a} vs ${b}: ${g} != ${want}`);
    }
    const rng = mulberry32(7778);
    for (let t = 0; t < 40; t++) {
      const r = (): [number, number, number] => [rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2];
      const g = angle(r(), [0, 0, 0], r());
      assert.ok(Number.isFinite(g) && g >= 0 && g <= 180, `case ${t}: ${g}`);
    }
  });
  it('maskVolume scales with spacing (20 sizes)', () => {
    for (let t = 0; t < 20; t++) {
      const n = 10 + t;
      const mask = new Uint8Array(n).fill(1);
      const vol = {
        dims: [n, 1, 1] as [number, number, number], spacing: SP,
        origin: [0, 0, 0] as [number, number, number], dtype: 'uint8' as const, data: mask,
      };
      assert.equal(maskVolume(mask, vol), n * 0.5 * 0.5 * 2, `case ${t}`); // mm^3
    }
  });
  it('maskStatsToCSV carries exact values + escapes commas', () => {
    const vol = (sp: [number, number, number]) => ({
      dims: [4, 1, 1] as [number, number, number], spacing: sp,
      origin: [0, 0, 0] as [number, number, number], dtype: 'uint8' as const,
      data: new Uint8Array(4),
    });
    assert.equal(
      maskStatsToCSV('liver', Uint8Array.from([1, 1, 0, 0]), vol([0.5, 0.5, 2])),
      'series,voxels,volume_mm3,volume_cm3,spacing_x,spacing_y,spacing_z\nliver,2,1,0.001,0.5,0.5,2\n',
    );
    assert.equal(
      maskStatsToCSV('empty', new Uint8Array(4), vol([1, 1, 1])).split('\n')[1],
      'empty,0,0,0,1,1,1',
    );
    assert.ok(maskStatsToCSV('a,b', Uint8Array.from([1, 0, 0, 0]), vol([1, 1, 1])).includes('"a,b"'));
  });
  it('frameDiff summarizes change exactly', () => {
    assert.deepEqual(frameDiff([1, 2, 3, 4], [1, 2, 3, 4]), { meanAbs: 0, maxAbs: 0, changedFrac: 0 });
    assert.deepEqual(frameDiff([0, 0, 0, 0], [2, 4, 6, 8]), { meanAbs: 5, maxAbs: 8, changedFrac: 1 });
    assert.deepEqual(frameDiff([0, 0, 0, 10], [0, 0, 0, 10], 5), { meanAbs: 0, maxAbs: 0, changedFrac: 0 });
    const d = frameDiff([0, 5, 10], [0, 0, 0], 4);
    assert.equal(d.meanAbs, 5);
    assert.equal(d.maxAbs, 10);
    assert.ok(Math.abs(d.changedFrac - 2 / 3) < 1e-12);
    assert.throws(() => frameDiff([1, 2], [1]), RangeError);
  });
  it('profileLine samples endpoints', () => {
    const data = new Float64Array([10, 20, 30, 40]);
    const vol = {
      dims: [4, 1, 1] as [number, number, number], spacing: [1, 1, 1] as [number, number, number],
      origin: [0, 0, 0] as [number, number, number], dtype: 'float64' as const, data,
    };
    const p = profileLine(vol, [0, 0, 0], [3, 0, 0], 4);
    assert.equal(p.length, 4);
    assert.ok(Math.abs(p[0]! - 10) < 1e-9 && Math.abs(p[3]! - 40) < 1e-9);
  });
});
