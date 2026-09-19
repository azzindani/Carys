import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hangingProtocol, hangingIds, HANGING_RULES } from '../hanging.js';

describe('hanging protocols', () => {
  it('modality + body part select exact protocol, layout, preset, proj', () => {
    const cases: [string, string, string, string, string][] = [
      ['CT', 'lung_ct series', 'ct-lung', 'axial', 'CT_Lung'],
      ['ct', 'CHEST screening', 'ct-lung', 'axial', 'CT_Lung'],
      ['CT', 'skull fracture', 'ct-bone', 'tri', 'CT_Bone'],
      ['CT', 'cardiac angio', 'ct-angio', 'coronal', 'CT_AAA'],
      ['CT', 'abdomen routine', 'ct-default', 'tri', 'CT_SoftTissue'],
      ['MR', 'brats flair tumor', 'mr-brain', 'tri', 'MR_T2Brain'],
      ['MR', 'knee', 'mr-default', 'tri', 'MR_Default'],
      ['MG', 'tomo CC', 'mg-tomo', 'coronal', 'auto'],
    ];
    for (const [mod, desc, protocol, layout, preset] of cases) {
      const h = hangingProtocol(mod, desc);
      assert.equal(h.protocol, protocol, desc);
      assert.equal(h.layout, layout, desc);
      assert.equal(h.preset, preset, desc);
    }
    assert.equal(hangingProtocol('CT', 'cardiac angio').proj, 'mip');
    assert.equal(hangingProtocol('MR', 'knee').proj, 'slice');
  });
  it('unknown modality, empty and garbage input fall back to default without throwing', () => {
    for (const [mod, desc] of [['PT', 'skull'], ['', ''], ['CT', ''], ['??', '??'], ['mr', '']] as [string, string][]) {
      const h = hangingProtocol(mod, desc);
      assert.equal(h.protocol, mod.toUpperCase() === 'MR' ? 'mr-default' : mod.toUpperCase() === 'CT' ? 'ct-default' : 'default', `${mod}/${desc}`);
    }
    assert.deepEqual(hangingProtocol('US', 'liver'), { protocol: 'default', layout: 'tri', preset: 'auto', proj: 'slice' });
  });
  it('rule table is ordered, ids unique, presets valid', () => {
    const ids = hangingIds();
    assert.deepEqual([...new Set(ids)], ids);
    assert.equal(ids[ids.length - 1], 'default');
    for (const r of HANGING_RULES) {
      assert.ok(['tri', 'axial', 'coronal', 'sagittal'].includes(r.choice.layout), r.id);
      assert.ok(['slice', 'mip', 'minip', 'mean'].includes(r.choice.proj), r.id);
    }
  });
});
