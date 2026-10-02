import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultTFPreset, presetTFFor, presetTFHounsfield, sampleTF, tfDomain, TF_PRESETS, validateTF,
} from '../tf.js';

// Calibrated on the sample set's real CTs and MRs (render-cpu/tf.ts): these
// fields carry the same tissue values in the same proportions.

/** An abdomen CT in HU: padding at -2048, air, fat, organs, bone, a metal
 *  streak. The stored range is the scanner's; the tissues are the patient's. */
function abdomenCt(n = 20000): Float64Array {
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    d[i] = t < 0.2 ? -2048 : t < 0.45 ? -1000 : t < 0.6 ? -100 : t < 0.93 ? 45 : t < 0.999 ? 800 : 3000;
  }
  return d;
}

/** A cine MR: background, myocardium, blood pool, and a few flow-artefact
 *  voxels ten times brighter than any anatomy. */
function cineMr(n = 20000): Float64Array {
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    d[i] = t < 0.3 ? 0 : t < 0.7 ? 80 + (i % 7) : t < 0.998 ? 250 + (i % 11) : 4000;
  }
  return d;
}

describe('tf domain (real-data calibration)', () => {
  it('a CT is Hounsfield and its presets ignore the stored range', () => {
    const d = tfDomain(abdomenCt(), 'CT');
    assert.equal(d.hounsfield, true);
    assert.equal(defaultTFPreset(d), 'bone');
    // the same stops whatever the padding or the metal
    assert.deepEqual(presetTFFor('bone', d), presetTFHounsfield('bone'));
  });

  it('bone draws bone, not fat or organs; lung leaves the air round the body clear', () => {
    const bone = presetTFHounsfield('bone');
    for (const hu of [-1000, -100, 45, 120]) assert.equal(sampleTF(bone, hu).a, 0, `bone at ${hu} HU`);
    assert.ok(sampleTF(bone, 300).a > 0.2 && sampleTF(bone, 1000).a > 0.8);
    const lung = presetTFHounsfield('lung');
    assert.equal(sampleTF(lung, -1000).a, 0, 'air outside the body');
    assert.equal(sampleTF(lung, 45).a, 0, 'soft tissue');
    assert.ok(sampleTF(lung, -800).a > 0, 'lung parenchyma');
    const soft = presetTFHounsfield('soft');
    assert.ok(sampleTF(soft, 45).a > sampleTF(soft, -100).a, 'organs over fat');
    for (const name of TF_PRESETS) assert.deepEqual(validateTF(presetTFHounsfield(name)), [], name);
  });

  it('an MR stretches its presets over the bulk, not over its brightest voxel', () => {
    const d = tfDomain(cineMr(), 'MR');
    assert.equal(d.hounsfield, false);
    assert.equal(defaultTFPreset(d), 'brain');
    assert.equal(d.lo, 0);
    assert.ok(d.hi >= 250 && d.hi < 300, `hi ${d.hi} should sit at the blood pool, not the 4000 artefact`);
    // the blood pool is drawn: on [0, 4000] it sat under every ramp
    assert.ok(sampleTF(presetTFFor('brain', d), 255).a > 0.5);
  });

  it('only CT can be Hounsfield: a padded MR is not', () => {
    const f = Float64Array.from(abdomenCt(), (v) => Math.max(v, -1000));
    assert.equal(tfDomain(f, 'MR').hounsfield, false);
    assert.equal(tfDomain(f, null).hounsfield, true, 'no modality: the values decide');
  });

  it('degenerate fields give a usable domain', () => {
    for (const f of [new Float64Array(0), new Float64Array(10), new Float64Array([5, 5, 5]), new Float64Array([NaN, 1])]) {
      const d = tfDomain(f);
      assert.ok(Number.isFinite(d.lo) && Number.isFinite(d.hi) && d.hi > d.lo, JSON.stringify(d));
    }
  });
});
