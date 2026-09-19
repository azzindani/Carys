import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { viewCacheKey, type ViewParams } from '../view-cache.js';

const base: ViewParams = {
  series: 's', plane: 'axial', slice: 5, wlW: 400, wlC: 50, lut: 'Grayscale',
  proj: 'slice', slab: 9, oblA: 0, oblB: 0, invert: false,
};

describe('view cache key', () => {
  it('stable for identical inputs, unique per pixel-changing input', () => {
    assert.equal(viewCacheKey(base), viewCacheKey({ ...base }));
    const varied: [keyof ViewParams, unknown][] = [
      ['slice', 6], ['wlW', 401], ['wlC', 51], ['lut', 'Fire'],
      ['proj', 'mip'], ['slab', 10], ['oblA', 0.01], ['invert', true],
      ['frame', 2], ['compare', 'other'], ['series', 's2'], ['plane', 'coronal'],
    ];
    for (const [k, v] of varied) {
      assert.notEqual(viewCacheKey(base), viewCacheKey({ ...base, [k]: v }), String(k));
    }
  });
  it('non-finite numbers degrade to nan, never crash', () => {
    const k = viewCacheKey({ ...base, wlW: NaN });
    assert.ok(k.includes('Wnan'));
  });
});
