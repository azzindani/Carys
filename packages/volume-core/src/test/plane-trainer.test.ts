import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlaneDrills, gradePlaneDrill, PLANETRAINER_SERIES, validatePlaneDrill,
} from '../plane-trainer.js';
import { PLANE_CARDS } from '../plane-atlas.js';

describe('E1 plane trainer', () => {
  it('12 drills: 9 third-drills + 3 which-plane, unique ids', () => {
    const drills = buildPlaneDrills();
    assert.equal(drills.length, 12);
    assert.equal(new Set(drills.map((d) => d.id)).size, 12);
    assert.equal(drills.filter((d) => d.id.startsWith('planetrainer-which-')).length, 3);
    for (const d of drills) {
      assert.ok(PLANE_CARDS.some((c) => c.plane === d.plane), `${d.id} bad plane`);
      assert.ok(d.frac >= 0 && d.frac <= 1, `${d.id} frac out of range`);
      assert.equal(d.options.length, 3);
      assert.ok(d.rationale.length > 10, `${d.id} needs a rationale`);
    }
    assert.equal(PLANETRAINER_SERIES, 'planetrainer');
  });
  it('third drills answer the card thirds; which-plane answers the title', () => {
    const drills = buildPlaneDrills();
    const axMid = drills.find((d) => d.id === 'planetrainer-axial-mid')!;
    assert.equal(axMid.options[axMid.answer], 'Mid: basal ganglia (putamen, caudate), thalami, lateral ventricles');
    const whichAx = drills.find((d) => d.id === 'planetrainer-which-axial')!;
    assert.equal(whichAx.options[whichAx.answer], 'Axial — feet-to-head stack');
    assert.equal(whichAx.frac, 1 / 2);
  });
  it('grader is pure equality', () => {
    const drills = buildPlaneDrills();
    const d = drills[0]!;
    assert.equal(gradePlaneDrill(d, d.answer), true);
    assert.equal(gradePlaneDrill(d, (d.answer + 1) % d.options.length), false);
  });
  it('corrupt drills fail loud with named errors', () => {
    const good = {
      id: 'x', plane: 'axial', frac: 0.5, prompt: 'p?',
      options: ['a', 'b'], answer: 0, rationale: 'r',
    };
    validatePlaneDrill(good);
    const bads: Array<[unknown, RegExp]> = [
      [null, /bad-planetrainer-input/],
      [{ ...good, plane: 'oblique' }, /plane/],
      [{ ...good, frac: 2 }, /frac/],
      [{ ...good, options: ['only'] }, /options/],
      [{ ...good, options: ['a', 'a'] }, /unique/],
      [{ ...good, answer: 9 }, /range/],
    ];
    for (const [raw, re] of bads) assert.throws(() => validatePlaneDrill(raw), re);
  });
});
