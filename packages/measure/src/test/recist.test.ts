import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessRecist, targetSum, volumeDoublingTime, type TargetLesion } from '../recist.js';

const L = (longAxis: number): TargetLesion => ({ longAxis });

describe('recist 1.1', () => {
  it('targetSum adds axes, empties to 0, rejects bad input', () => {
    assert.equal(targetSum([]), 0);
    assert.equal(targetSum([L(10), L(22.5)]), 32.5);
    assert.throws(() => targetSum([L(-3)]), /recist-bad-axis/);
    assert.throws(() => targetSum([L(NaN)]), /recist-bad-axis/);
  });
  it('PR at exactly -30%, SD just above', () => {
    const base = [L(50), L(50)]; // sum 100
    assert.equal(assessRecist(base, base, [L(35), L(35)]).category, 'PR'); // -30%
    assert.equal(assessRecist(base, base, [L(36), L(35)]).category, 'SD'); // -29%
  });
  it('PD needs both +20% from nadir AND +5mm absolute', () => {
    const base = [L(100)], nadir = [L(10)]; // shrank to 10
    // +20% from nadir (12) but only +2mm absolute → still PR vs baseline
    // (−88%), NOT PD: the classic trap is the +20% alone looking like PD
    const trap = assessRecist(base, nadir, [L(12)]);
    assert.equal(trap.category, 'PR');
    assert.ok(trap.pctFromNadir >= 20 && trap.absFromNadir < 5);
    // +20% and +5mm → PD
    const pd = assessRecist(base, nadir, [L(15)]);
    assert.equal(pd.category, 'PD');
    assert.ok(pd.pctFromNadir >= 20 && pd.absFromNadir >= 5);
  });
  it('CR on disappearance, PD on any new lesion', () => {
    assert.equal(assessRecist([L(40)], [L(40)], []).category, 'CR');
    const pd = assessRecist([L(40)], [L(20)], [L(20)], true);
    assert.equal(pd.category, 'PD');
    assert.equal(pd.newLesion, true);
  });
  it('pct fields exact, zero sums degrade to Infinity not NaN', () => {
    const a = assessRecist([L(80)], [L(80)], [L(60)]);
    assert.equal(a.pctFromBaseline, -25);
    assert.equal(a.pctFromNadir, -25);
    assert.equal(a.absFromNadir, -20);
    const z = assessRecist([], [], [L(5)]);
    assert.equal(z.pctFromBaseline, Infinity);
    assert.equal(z.category, 'PD'); // +5mm absolute from 0 nadir
    const zz = assessRecist([], [], []);
    assert.equal(zz.pctFromBaseline, 0);
    assert.equal(zz.category, 'CR');
  });
});

describe('volume doubling time', () => {
  it('exact doubling returns the interval', () => {
    assert.ok(Math.abs(volumeDoublingTime(10, 20, 100) - 100) < 1e-9);
    assert.ok(Math.abs(volumeDoublingTime(10, 40, 100) - 50) < 1e-9); // two doublings
  });
  it('no growth returns Infinity, bad inputs throw', () => {
    assert.equal(volumeDoublingTime(20, 20, 100), Infinity);
    assert.equal(volumeDoublingTime(20, 10, 100), Infinity);
    assert.throws(() => volumeDoublingTime(0, 10, 100), /vdt-positive-volumes/);
    assert.throws(() => volumeDoublingTime(10, -1, 100), /vdt-positive-volumes/);
    assert.throws(() => volumeDoublingTime(10, 20, 0), /vdt-positive-interval/);
  });
});
