import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { biRads, lungRads } from '../oncology.js';

describe('lung-rads', () => {
  it('size ladder: 1 → 2 → 3 → 4A → 4B', () => {
    assert.equal(lungRads({ solidMm: 0, partSolidMm: 0, groundGlassMm: 0, suspicious: false }), '1');
    assert.equal(lungRads({ solidMm: 4, partSolidMm: 0, groundGlassMm: 0, suspicious: false }), '2');
    assert.equal(lungRads({ solidMm: 6, partSolidMm: 0, groundGlassMm: 0, suspicious: false }), '3');
    assert.equal(lungRads({ solidMm: 8, partSolidMm: 0, groundGlassMm: 0, suspicious: false }), '4A');
    assert.equal(lungRads({ solidMm: 0, partSolidMm: 8, groundGlassMm: 0, suspicious: false }), '4B');
  });
  it('ground-glass thresholds + suspicious shortcut', () => {
    assert.equal(lungRads({ solidMm: 0, partSolidMm: 0, groundGlassMm: 20, suspicious: false }), '2');
    assert.equal(lungRads({ solidMm: 0, partSolidMm: 0, groundGlassMm: 30, suspicious: false }), '3');
    assert.equal(lungRads({ solidMm: 3, partSolidMm: 0, groundGlassMm: 0, suspicious: true }), '4X');
  });
});

describe('bi-rads', () => {
  it('negative benign base, escalating suspicion', () => {
    assert.equal(biRads({ mass: false, suspiciousMass: false, suspiciousCalcs: false, distortion: false }), '2');
    assert.equal(biRads({ mass: true, suspiciousMass: false, suspiciousCalcs: false, distortion: false }), '4A');
    assert.equal(biRads({ mass: false, suspiciousMass: false, suspiciousCalcs: true, distortion: false }), '4C');
    assert.equal(biRads({ mass: false, suspiciousMass: true, suspiciousCalcs: true, distortion: false }), '5');
    assert.equal(biRads({ mass: false, suspiciousMass: true, suspiciousCalcs: false, distortion: true }), '5');
  });
});
