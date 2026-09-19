import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findWell, joinZarrUrl, OmePlateError, parsePlateAttrs, parseWellAttrs,
  plateWellLabel, wellImageUrl,
} from '../ome-plate.js';

const PLATE = {
  plate: {
    name: 'demo',
    rows: [{ name: 'A' }, { name: 'B' }],
    columns: [{ name: '01' }, { name: '02' }],
    wells: [
      { path: 'A/01', rowIndex: 0, columnIndex: 0 },
      { path: 'B/02', rowIndex: 1, columnIndex: 1 },
    ],
  },
};

const WELL = { well: { images: [{ path: '0' }, { path: '1' }] } };

describe('ome-plate', () => {
  it('parses plate + well metadata, labels and resolves image URLs', () => {
    const plate = parsePlateAttrs(PLATE)!;
    assert.equal(plate.name, 'demo');
    assert.deepEqual(plate.rows, ['A', 'B']);
    assert.deepEqual(plate.columns, ['01', '02']);
    assert.equal(plate.wells.length, 2);
    // v0.5 envelope unwraps the same way
    assert.deepEqual(parsePlateAttrs({ ome: PLATE })?.wells.length, 2);
    const well = parseWellAttrs(WELL)!;
    assert.deepEqual(well.images, ['0', '1']);
    const w = findWell(plate, 'B', '02')!;
    assert.equal(w.path, 'B/02');
    assert.equal(plateWellLabel(plate, w), 'B02');
    assert.equal(findWell(plate, 0, 0)!.path, 'A/01');
    assert.equal(findWell(plate, 'Z', '01'), null);
    assert.equal(findWell(plate, 'A', '02'), null); // no such well listed
    assert.equal(wellImageUrl('/s/plate.zarr', w, well), '/s/plate.zarr/B/02/0');
    assert.equal(wellImageUrl('/s/plate.zarr/', w, well, 1), '/s/plate.zarr/B/02/1');
    assert.deepEqual(joinZarrUrl('/a/', '/b/', 'c'), '/a/b/c');
  });
  it('absent keys give null, malformed metadata is loud (table)', () => {
    assert.equal(parsePlateAttrs({}), null);
    assert.equal(parsePlateAttrs(null), null);
    assert.equal(parseWellAttrs({ multiscales: [] }), null);
    const badPlates: Array<[string, unknown]> = [
      ['plate-not-object', { plate: 42 }],
      ['rows-not-array', { plate: { rows: {}, columns: [], wells: [] } }],
      ['row-no-name', { plate: { rows: [{}], columns: [], wells: [] } }],
      ['wells-not-array', { plate: { rows: [], columns: [], wells: {} } }],
      ['well-no-path', { plate: { rows: [{ name: 'A' }], columns: [{ name: '01' }], wells: [{ rowIndex: 0, columnIndex: 0 }] } }],
      ['well-bad-index', { plate: { rows: [{ name: 'A' }], columns: [{ name: '01' }], wells: [{ path: 'x', rowIndex: 'a', columnIndex: 0 }] } }],
      ['well-out-of-range', { plate: { rows: [{ name: 'A' }], columns: [{ name: '01' }], wells: [{ path: 'x', rowIndex: 5, columnIndex: 0 }] } }],
      ['name-not-string', { plate: { name: 7, rows: [], columns: [], wells: [] } }],
    ];
    for (const [name, attrs] of badPlates) {
      assert.throws(() => parsePlateAttrs(attrs), (e: unknown) => e instanceof OmePlateError, name);
    }
    const badWells: Array<[string, unknown]> = [
      ['well-not-object', { well: 3 }],
      ['images-not-array', { well: { images: {} } }],
      ['image-no-path', { well: { images: [{}] } }],
      ['images-empty', { well: { images: [] } }],
    ];
    for (const [name, attrs] of badWells) {
      assert.throws(() => parseWellAttrs(attrs), (e: unknown) => e instanceof OmePlateError, name);
    }
    const plate = parsePlateAttrs(PLATE)!;
    assert.throws(
      () => wellImageUrl('/s', plate.wells[0]!, parseWellAttrs(WELL)!, 9),
      (e: unknown) => e instanceof OmePlateError,
    );
  });
});
