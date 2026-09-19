import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { histogram, volumeStats } from '../histogram.js';
import { findLUT, ColorTable, TABLE_GRAYSCALE } from '../colortable.js';
import { isValidOrientationString } from '../orientation.js';
import { makeNavigationState, movePosition, FOUR_PANEL_DEFAULT } from '../navigation.js';
import { bpPerPixel, toPixels, toBP, lociOverlap } from '../locus.js';
import { applyTransforms } from '../gosling.js';
import type { Volume } from '../types.js';

const vol = (data: number[]) =>
  ({
    dims: [data.length, 1, 1], spacing: [1, 1, 1], origin: [0, 0, 0],
    dtype: 'uint8', data: Uint8Array.from(data),
  }) as unknown as Volume;

describe('histogram', () => {
  it('counts bins and reports min/max', () => {
    const { hist, min, max } = histogram([0, 0, 255, 255], 2);
    assert.equal(min, 0);
    assert.equal(max, 255);
    assert.equal(hist[0], 2);
    assert.equal(hist[1], 2);
  });
  it('volumeStats mean', () => {
    assert.equal(volumeStats(vol([0, 10, 20])).mean, 10);
  });
});

describe('colortable', () => {
  it('finds known tables, falls back to grayscale', () => {
    assert.equal(findLUT('Grayscale').name, TABLE_GRAYSCALE.name);
    assert.equal(findLUT('nope').name, TABLE_GRAYSCALE.name);
  });
  it('ColorTable writes 256-entry arrays', () => {
    const ct = new ColorTable('Grayscale', true);
    assert.equal(ct.LUTarrayR.length, 256);
  });
});

describe('orientation', () => {
  it('validates Papaya orientation strings', () => {
    assert.equal(isValidOrientationString('XYZ+--'), true);
    assert.equal(isValidOrientationString('bogus'), false);
  });
});

describe('navigation', () => {
  it('moves linked position, keeps zoom; default has 4 panes', () => {
    const s = makeNavigationState([1, 2, 3], 2);
    const s2 = movePosition(s, [4, 5, 6]);
    assert.deepEqual(s2.position.center, [4, 5, 6]);
    assert.equal(s2.zoom, 2);
    assert.equal(Object.keys(FOUR_PANEL_DEFAULT).length, 4);
  });
});

describe('locus math', () => {
  it('bp<->pixel round-trips', () => {
    const locus = { chr: 'chr1', start: 0, end: 1000 };
    const bpp = bpPerPixel(locus, 100);
    assert.equal(bpp, 10);
    assert.equal(toPixels(500, locus, bpp), 50);
    assert.equal(toBP(50, locus, bpp), 500);
  });
  it('overlap detects shared intervals', () => {
    assert.equal(
      lociOverlap({ chr: 'chr1', start: 0, end: 10 }, { chr: 'chr1', start: 5, end: 15 }),
      true,
    );
    assert.equal(
      lociOverlap({ chr: 'chr1', start: 0, end: 5 }, { chr: 'chr2', start: 0, end: 5 }),
      false,
    );
  });
});

describe('gosling transforms', () => {
  it('log transform maps field to new field', () => {
    const out = applyTransforms([{ v: 100 }], [{ type: 'log', field: 'v', newField: 'lv' }]);
    assert.ok(Math.abs((out[0]!['lv'] as number) - 2) < 1e-9);
  });
  it('concat joins fields', () => {
    const out = applyTransforms(
      [{ a: 'chr1', b: 5 }],
      [{ type: 'concat', fields: ['a', 'b'], newField: 'c', separator: ':' }],
    );
    assert.equal(out[0]!['c'], 'chr1:5');
  });
});
