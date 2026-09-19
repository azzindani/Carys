import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { length, angle } from '../measure.js';

describe('measure', () => {
  it('length respects spacing', () => {
    assert.equal(length([0, 0, 0], [3, 4, 0], [1, 1, 2]), 5);
    assert.equal(length([0, 0, 0], [0, 0, 2], [1, 1, 2]), 4);
  });
  it('angle of a right triangle corner is 90deg', () => {
    assert.ok(Math.abs(angle([1, 0, 0], [0, 0, 0], [0, 1, 0]) - 90) < 1e-9);
  });
});
