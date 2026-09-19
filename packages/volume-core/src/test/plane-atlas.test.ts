import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PLANE_CARDS, planeCardByPlane, planeCardLine } from '../plane-atlas.js';

describe('A4 plane atlas', () => {
  it('3 cards, unique planes, thirds + tilt notes present', () => {
    assert.equal(PLANE_CARDS.length, 3);
    assert.equal(new Set(PLANE_CARDS.map((c) => c.plane)).size, 3);
    for (const c of PLANE_CARDS) {
      assert.ok(c.title.length > 0 && c.cuts.length > 10, `${c.plane} needs title+cuts`);
      assert.equal(c.thirds.length, 3);
      assert.ok(c.tiltNote.length > 10, `${c.plane} needs a tilt note`);
    }
    assert.equal(planeCardByPlane('axial')?.thirds[1], 'Mid: basal ganglia (putamen, caudate), thalami, lateral ventricles');
    assert.equal(planeCardByPlane('nope'), null);
  });
  it('slider fractions route to thirds; tilt appends the caution', () => {
    const ax = planeCardByPlane('axial')!;
    assert.match(planeCardLine(ax, 0.1, false), /Low: cerebellum/);
    assert.match(planeCardLine(ax, 0.5, false), /basal ganglia/);
    assert.match(planeCardLine(ax, 0.9, false), /centrum semiovale/);
    assert.doesNotMatch(planeCardLine(ax, 0.5, false), /Tilt active/);
    assert.match(planeCardLine(ax, 0.5, true), /Tilt active/);
    const sag = planeCardByPlane('sagittal')!;
    assert.match(planeCardLine(sag, 0.95, false), /vermis/);
    // clamps, never NaN
    assert.match(planeCardLine(ax, -5, false), /Low:/);
    assert.match(planeCardLine(ax, 9, false), /High:/);
    assert.throws(() => planeCardLine(ax, NaN, false), /plane-atlas-frac/);
  });
});
