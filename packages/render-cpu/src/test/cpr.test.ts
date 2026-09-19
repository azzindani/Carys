import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Volume } from '@carys/volume-core';
import { centerlineLength, curvedReformat, type V3 } from '../cpr.js';

function tube(): Volume {
  // bright rod along x at y=z=16 in a 32³ volume
  const data = new Float64Array(32 * 32 * 32);
  for (let x = 0; x < 32; x++) data[16 * 1024 + 16 * 32 + x] = 1000;
  return {
    dims: [32, 32, 32], spacing: [1, 1, 1], origin: [0, 0, 0], dtype: 'float64', data,
  };
}

const WL = { width: 1100, center: 500 };

describe('cpr', () => {
  it('centerline length exact, spacing-aware, loud on bad input', () => {
    assert.equal(centerlineLength([[0, 0, 0], [3, 4, 0]], [1, 1, 1]).total, 5);
    assert.equal(centerlineLength([[0, 0, 0], [1, 0, 0]], [0.5, 1, 2]).total, 0.5);
    assert.throws(() => centerlineLength([[0, 0, 0]], [1, 1, 1]), /cpr-centerline/);
    assert.throws(() => centerlineLength([[0, 0, 0], [1, 0, 0]], [0, 1, 1]), /cpr-spacing/);
  });
  it('straight rod reformats to a bright mid-row band', () => {
    const out = curvedReformat(tube(), [[2, 16, 16], [30, 16, 16]], WL, 32, 8);
    assert.equal(out.length, 32 * 17 * 4);
    // middle row (offset 0) is the rod: bright; edges are dark
    const mid = out[(8 * 32 + 16) * 4]!;
    const edge = out[(0 * 32 + 16) * 4]!;
    assert.ok(mid > 200, `mid ${mid}`);
    assert.ok(edge < 50, `edge ${edge}`);
  });
  it('bad geometry throws named errors', () => {
    const v = tube();
    assert.throws(() => curvedReformat(v, [[0, 0, 0], [1, 1, 1]], WL, 4), /cpr-columns/);
    assert.throws(() => curvedReformat(v, [[0, 0, 0], [1, 1, 1]], WL, 32, 1), /cpr-width/);
  });
});
