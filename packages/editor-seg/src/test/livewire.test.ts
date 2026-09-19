import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { levelSetRefine, livewirePath, sliceGradient } from '../livewire.js';
import type { Volume } from '@carys/volume-core';

function stepVol(): Volume {
  // left half dark (0), right half bright (100): one vertical edge at x=8
  const data = new Float64Array(16 * 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) data[y * 16 + x] = x < 8 ? 0 : 100;
  }
  return { dims: [16, 16, 1], spacing: [1, 1, 1], origin: [0, 0, 0], dtype: 'float64', data };
}

describe('livewire + level set', () => {
  it('gradient peaks on the step edge, flat elsewhere', () => {
    const g = sliceGradient(stepVol(), 0);
    assert.equal(g.length, 256);
    assert.ok(g[8 * 16 + 7]! > 100 && g[8 * 16 + 8]! > 100);
    assert.equal(g[8 * 16 + 2], 0);
    assert.equal(g[8 * 16 + 13], 0);
  });
  it('wire follows the strong edge, endpoints exact, oob loud', () => {
    const g = sliceGradient(stepVol(), 0);
    const path = livewirePath(g, 16, 16, [7, 0], [7, 15]);
    assert.deepEqual(path[0], [7, 0]);
    assert.deepEqual(path[path.length - 1], [7, 15]);
    // stays on the edge columns (7/8), never wanders into flat halves
    assert.ok(path.every(([x]) => x === 7 || x === 8), 'wire hugs the edge');
    assert.throws(() => livewirePath(g, 16, 16, [-1, 0], [7, 7]), /livewire-endpoints/);
  });
  it('level set pulls a ragged boundary to the intensity step', () => {
    const vol = stepVol();
    const mask = new Uint8Array(256);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) mask[y * 16 + x] = x < 6 + (y % 3) ? 1 : 0; // ragged left of edge
    }
    const changed = levelSetRefine(vol, mask, 0);
    assert.ok(changed > 0, 'refine moves pixels');
    // after refine every row boundary sits at the step (x=8)
    for (let y = 0; y < 16; y++) {
      let edge = -1;
      for (let x = 0; x < 15; x++) {
        if (mask[y * 16 + x]! === 1 && mask[y * 16 + x + 1]! === 0) edge = x;
      }
      assert.equal(edge, 7, `row ${y} boundary at step`);
    }
    assert.throws(() => levelSetRefine(vol, new Uint8Array(10), 0), /levelset-mask-dims/);
  });
});
