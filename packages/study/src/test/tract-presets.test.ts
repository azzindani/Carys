import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACT_PRESETS, presetRois, tractPresetById, validateTractPreset,
} from '@carys/volume-core';
import { filterTracts } from '@carys/render-cpu';

// two streamlines: s0 along x at y=0, s1 along x at y=10 (z=0 both),
// in a 10×10×10 viewBox — mirrors tract-roi.test.ts geometry.
const PTS = new Float32Array([0, 0, 0, 5, 0, 0, 10, 0, 0, 0, 10, 0, 5, 10, 0, 10, 10, 0]);
const OFF = new Uint32Array([0, 3, 6]);
const DIMS: [number, number, number] = [10, 10, 10];

describe('N2 tract presets', () => {
  it('5 presets, unique ids, lessons + provenance present', () => {
    assert.equal(TRACT_PRESETS.length, 5);
    assert.equal(new Set(TRACT_PRESETS.map((p) => p.id)).size, 5);
    for (const p of TRACT_PRESETS) {
      assert.ok(p.title.length > 0 && p.lesson.length > 10, `${p.id} needs title+lesson`);
      assert.ok(p.provenance.length > 0, `${p.id} needs provenance`);
      validateTractPreset(JSON.parse(JSON.stringify(p)));
    }
    assert.equal(tractPresetById('midline-cross')?.waypoints.length, 1);
    assert.equal(tractPresetById('nope'), null);
  });
  it('presetRois resolves fractions to voxels, spheres stay spheres', () => {
    const mid = tractPresetById('midline-cross')!;
    const { waypoints, exclusions } = presetRois(mid, DIMS);
    assert.deepEqual(waypoints[0]!.center, [5, 5, 5]);
    assert.ok(Math.abs(waypoints[0]!.radius - 1.2) < 1e-9);
    assert.equal(exclusions.length, 2);
    // anisotropic: radius keys off the smallest side
    const r = presetRois(mid, [20, 10, 40]);
    assert.deepEqual(r.waypoints[0]!.center, [10, 5, 20]);
    assert.ok(Math.abs(r.waypoints[0]!.radius - 1.2) < 1e-9);
    assert.throws(() => presetRois(mid, [0, 10, 10]), /tract-preset-dims/);
  });
  it('presets filter end to end through filterTracts', () => {
    // Toy tracts run at y=0/y=10, z=0 — all three centered presets miss
    // them (empty stays loud, not wrong).
    const mid = presetRois(tractPresetById('midline-cross')!, DIMS);
    assert.deepEqual(filterTracts(PTS, OFF, mid.waypoints, []), []);
    const left = presetRois(tractPresetById('left-hemisphere')!, DIMS);
    assert.deepEqual(filterTracts(PTS, OFF, left.waypoints, []), []);
    const two = presetRois(tractPresetById('two-hop')!, DIMS);
    assert.deepEqual(filterTracts(PTS, OFF, two.waypoints, two.exclusions), []);
    // A3 SPL-named bundles validate + resolve like the N2 three (same
    // fractional contract, only the names are new).
    for (const id of ['thalamo-midline', 'putamen-pair']) {
      const p = tractPresetById(id)!;
      assert.ok(p, `${id} resolves`);
      validateTractPreset(JSON.parse(JSON.stringify(p)));
      const r = presetRois(p, DIMS);
      assert.equal(r.waypoints.length, 2, `${id} keeps 2 waypoints`);
      assert.deepEqual(filterTracts(PTS, OFF, r.waypoints, r.exclusions), []);
    }
    // Crossing toy: s0 threads the midline sphere, s1 sits at the corner.
    // Waypoint alone keeps s0; with wall exclusions s0 is vetoed too
    // (it touches x=0 inside the 0.5-floored wall sphere) — the lesson:
    // wall vetoes mean "nothing escapes the box".
    const cross = new Float32Array([0, 5, 5, 5, 5, 5, 10, 5, 5, 0, 0, 0, 10, 0, 0, 10, 10, 0]);
    const coff = new Uint32Array([0, 3, 6]);
    assert.deepEqual(filterTracts(cross, coff, mid.waypoints, []), [0]);
    assert.deepEqual(filterTracts(cross, coff, mid.waypoints, mid.exclusions), []);
  });
  it('corrupt presets fail loud with named errors', () => {
    const bads: Array<[unknown, RegExp]> = [
      [null, /bad-tract-preset/],
      [{ id: '', title: 't', lesson: 'l', provenance: 'p', waypoints: [], exclusions: [] }, /id/],
      [{ id: 'x', title: 't', lesson: 'l', provenance: 'p', waypoints: [{ center: [0, 0], radius: 0.1 }], exclusions: [] }, /center/],
      [{ id: 'x', title: 't', lesson: 'l', provenance: 'p', waypoints: [{ center: [0, 0, 2], radius: 0.1 }], exclusions: [] }, /center/],
      [{ id: 'x', title: 't', lesson: 'l', provenance: 'p', waypoints: [{ center: [0, 0, 0], radius: 0 }], exclusions: [] }, /radius/],
      [{ id: 'x', title: 't', lesson: 'l', provenance: 'p', waypoints: [], exclusions: {} }, /exclusions/],
    ];
    for (const [raw, re] of bads) assert.throws(() => validateTractPreset(raw), re);
  });
});
