import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyWindowLevel, voiRange, PRESETS } from '../lut.js';
import { parseLocusString, locusString } from '../locus.js';
import { applyTransforms } from '../gosling.js';
import { moduleKey, MODULE_TYPES } from '../extension.js';

describe('lut', () => {
  it('maps below/above window to 0/255 and midpoint near 128', () => {
    const wl = PRESETS.CT_Brain;
    const { lo, hi } = voiRange(wl);
    assert.equal(applyWindowLevel(lo - 10, wl), 0);
    assert.equal(applyWindowLevel(hi + 10, wl), 255);
    const mid = applyWindowLevel(wl.center, wl);
    assert.ok(mid >= 127 && mid <= 128, `mid=${mid}`);
  });
});

describe('locus', () => {
  it('round-trips chr:start-end (1-based)', () => {
    const l = parseLocusString('chr7:1,000-2,000');
    assert.deepEqual(l, { chr: 'chr7', start: 999, end: 2000 });
    assert.equal(locusString(l!), 'chr7:1000-2000');
  });
  it('rejects garbage', () => {
    assert.equal(parseLocusString('hello'), null);
  });
});

describe('gosling transforms', () => {
  it('filter oneOf keeps matching rows', () => {
    const rows = [{ c: 'a', v: 1 }, { c: 'b', v: 2 }];
    const out = applyTransforms(rows, [{ type: 'filter', field: 'c', oneOf: ['a'] }]);
    assert.deepEqual(out, [{ c: 'a', v: 1 }]);
  });
});

describe('extension', () => {
  it('namespaces module keys', () => {
    assert.equal(
      moduleKey('x', MODULE_TYPES.VIEWPORT, 'main'),
      'x.viewportModule.main',
    );
  });
});
