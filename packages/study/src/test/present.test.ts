import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GSPS_SOP_CLASS, PRESENT_FORMAT, PRESENT_FORMAT_LEGACY, buildPresentState, parsePresentState,
  presentStateDiff, presentStateToJSON, type PresentInput,
} from '../present.js';

const VIEW = {
  axial: { zoom: 1.5, x: 10, y: -4 },
  coronal: { zoom: 1, x: 0, y: 0 },
  sagittal: { zoom: 2, x: -8, y: 8 },
};

const snap = (): PresentInput => ({
  series: 'lung-ct-dicom',
  studyUID: '1.2.3',
  seriesUID: '1.2.3.4',
  dims: [4, 4, 4],
  spacing: [1, 1, 2],
  slices: { axial: 2, coronal: 1, sagittal: 3 },
  wl: { width: 400, center: 40 },
  preset: 'custom',
  lut: 'Fire',
  invert: true,
  proj: 'slice',
  slab: 9,
  oblA: 0.1,
  oblB: -0.05,
  oblPlane: 'axial',
  view: { ...VIEW, axial: { ...VIEW.axial }, coronal: { ...VIEW.coronal }, sagittal: { ...VIEW.sagittal } },
  annotations: [{
    id: 'm-1', kind: 'length', label: 'Length 1', plane: 'axial', slice: 2,
    points: [[10, 20], [30, 40]], value: 43.3, unit: 'mm',
    series: 'lung-ct-dicom', createdAt: '2026-09-16T00:00:00.000Z',
  }],
  generatedAt: '2026-09-16T00:00:00.000Z',
});

describe('presentation state', () => {
  it('round-trips WL + slices + zoom/pan + annotations with byte-stable key order', () => {
    const json = presentStateToJSON(buildPresentState(snap()));
    assert.ok(json.indexOf('"format"') < json.indexOf('"series"'), 'envelope first');
    assert.ok(json.indexOf('"view"') < json.indexOf('"annotations"'), 'viewport before annotations');
    const back = parsePresentState(json);
    assert.deepEqual(back, buildPresentState(snap()));
    assert.equal(back.format, PRESENT_FORMAT);
    assert.equal(back.gspsSOPClass, GSPS_SOP_CLASS);
    assert.deepEqual(back.wl, { width: 400, center: 40 });
    assert.deepEqual(back.view.axial, { zoom: 1.5, x: 10, y: -4 });
    assert.equal(back.annotations.length, 1);
    assert.deepEqual(back.annotations[0]!.points, [[10, 20], [30, 40]]);
  });
  it('hostile input fails loud with named errors', () => {
    const parses: Array<[string, RegExp]> = [
      ['{nope', /bad-json/],
      ['[1,2]', /bad-present/],
      ['null', /bad-present/],
      [JSON.stringify({ ...JSON.parse(presentStateToJSON(buildPresentState(snap()))), format: 'omniviewer-repro/1' }), /bad-present/],
      [JSON.stringify({ format: PRESENT_FORMAT_LEGACY }), /bad-present: missing/],
      [JSON.stringify({ format: PRESENT_FORMAT }), /bad-present: missing/],
      [presentStateToJSON(buildPresentState(snap())).replace('"width": 400', '"width": "wide"'), /bad-present/],
      [presentStateToJSON(buildPresentState(snap())).replace('"zoom": 1.5', '"zoom": 99'), /bad-present/],
    ];
    for (const [text, re] of parses) assert.throws(() => parsePresentState(text), re, text.slice(0, 60));
    const builds: Array<[Partial<PresentInput>, RegExp]> = [
      [{ series: '' }, /bad-present-input/],
      [{ dims: [4, 4] as unknown as [number, number, number] }, /bad-present-input/],
      [{ slices: { axial: -1, coronal: 1, sagittal: 3 } }, /bad-present-input/],
      [{ wl: { width: NaN, center: 40 } }, /bad-present-input/],
      [{ view: { ...snap().view, axial: { zoom: 99, x: 0, y: 0 } } }, /bad-present-input/],
      [{ annotations: [{ ...snap().annotations[0]!, series: 'other' }] }, /bad-present-input/],
      [{ annotations: [{ ...snap().annotations[0]!, kind: 'volume' as 'length' }] }, /bad-present-input/],
    ];
    for (const [patch, re] of builds) assert.throws(() => buildPresentState({ ...snap(), ...patch }), re);
  });
  it('save/load diff is empty on restore, names drift otherwise', () => {
    const saved = buildPresentState(snap());
    const loaded = parsePresentState(presentStateToJSON(saved));
    assert.deepEqual(presentStateDiff(saved, loaded), []);
    const moved: typeof loaded = { ...loaded, view: { ...loaded.view, axial: { zoom: 1, x: 0, y: 0 } } };
    const d = presentStateDiff(saved, moved);
    assert.ok(d.some((m) => m.startsWith('view')), `drift names view: ${d}`);
    const dropped: typeof loaded = { ...loaded, annotations: [] };
    const d2 = presentStateDiff(saved, dropped);
    assert.ok(d2.some((m) => m.startsWith('annotations.length')), `drift names annotations: ${d2}`);
  });
});
