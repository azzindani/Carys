import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cobbAngle, ellipseArea, ellipseStats, probePoint, roiStats } from '../roi.js';
import {
  createMeasurement, measurementsFromJSON, measurementsToCSV, measurementsToJSON,
  measurementsToSR, type Measurement,
} from '../tracking.js';
import { mulberry32, randInt } from './rng.js';

function testVol() {
  const nx = 8, ny = 7, nz = 5;
  const data = new Float64Array(nx * ny * nz);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  return {
    dims: [nx, ny, nz] as [number, number, number],
    spacing: [1, 2, 3] as [number, number, number],
    origin: [0, 0, 0] as [number, number, number],
    dtype: 'float64' as const, data,
  };
}

describe('roi + geometry', () => {
  it('roiStats exact on known block', () => {
    const s = roiStats(testVol(), 1, 1, 2, 2, 0);
    // voxels (1..2, 1..2, z=0): values i%251 with i = y*8+x
    const vals = [1 * 8 + 1, 1 * 8 + 2, 2 * 8 + 1, 2 * 8 + 2].map((i) => i % 251);
    assert.equal(s.count, 4);
    assert.equal(s.min, Math.min(...vals));
    assert.equal(s.max, Math.max(...vals));
    assert.ok(Math.abs(s.mean - vals.reduce((a, b) => a + b, 0) / 4) < 1e-9);
    assert.ok(s.std >= 0);
  });
  it('roiStats clamps + empty', () => {
    const s = roiStats(testVol(), -99, -99, 999, 999, 2);
    assert.equal(s.count, 8 * 7);
    const e = roiStats(testVol(), -9, -9, -5, -5, 0);
    assert.equal(e.count, 0);
    assert.ok(Number.isNaN(e.mean));
  });
  it('roiStats resolves planes: coronal + sagittal read the right voxels', () => {
    const v = testVol(); // 8×7×5, data[i] = i % 251
    const [nx, ny] = v.dims;
    // coronal slice y=2, x∈[1,2], z∈[0,1] → indices 2*56+z*8+x
    const c = roiStats(v, 1, 0, 2, 1, 2, 'coronal');
    const cVals = [1, 2].flatMap((x) => [0, 1].map((z) => (2 * nx * ny + z * nx + x) % 251));
    assert.equal(c.count, 4);
    assert.equal(c.min, Math.min(...cVals));
    assert.equal(c.max, Math.max(...cVals));
    assert.ok(Math.abs(c.mean - cVals.reduce((a, b) => a + b, 0) / 4) < 1e-9);
    // sagittal slice x=3, y∈[1,2], z∈[0,1] → indices z*56+y*8+3
    const s = roiStats(v, 1, 0, 2, 1, 3, 'sagittal');
    const sVals = [1, 2].flatMap((y) => [0, 1].map((z) => (z * nx * ny + y * nx + 3) % 251));
    assert.equal(s.count, 4);
    assert.equal(s.min, Math.min(...sVals));
    assert.equal(s.max, Math.max(...sVals));
    // default param stays axial: same call without plane matches axial
    assert.deepEqual(roiStats(v, 1, 1, 2, 2, 0), roiStats(v, 1, 1, 2, 2, 0, 'axial'));
  });
  it('ellipseArea exact', () => {
    assert.ok(Math.abs(ellipseArea(3, 4, 0.5, 0.5) - Math.PI * 3 * 4 * 0.25) < 1e-9);
    assert.equal(ellipseArea(0, 5, 1, 1), 0);
  });
  it('ellipseStats matches brute-force lattice on all three planes', () => {
    const v = testVol();
    const [nx, ny, nz] = v.dims;
    const cases = [
      { plane: 'axial' as const, slice: 2, cu: 3.5, cv: 3, ru: 2.5, rv: 2 },
      { plane: 'coronal' as const, slice: 3, cu: 4, cv: 2.5, ru: 3, rv: 1.5 },
      { plane: 'sagittal' as const, slice: 5, cu: 3, cv: 4, ru: 2, rv: 3 },
    ];
    for (const c of cases) {
      const got = ellipseStats(v, c.plane, c.slice, c.cu, c.cv, c.ru, c.rv);
      // independent oracle: walk the bbox, test the ellipse, read voxels
      // with per-plane index math written out (not shared with impl)
      const vals: number[] = [];
      const nu = c.plane === 'sagittal' ? ny : nx;
      const nv = c.plane === 'axial' ? ny : nz;
      for (let vv = Math.max(0, Math.floor(c.cv - c.rv)); vv <= Math.min(nv - 1, Math.ceil(c.cv + c.rv)); vv++) {
        for (let u = Math.max(0, Math.floor(c.cu - c.ru)); u <= Math.min(nu - 1, Math.ceil(c.cu + c.ru)); u++) {
          const du = (u - c.cu) / c.ru, dv = (vv - c.cv) / c.rv;
          if (du * du + dv * dv > 1) continue;
          const idx = c.plane === 'axial'
            ? c.slice * nx * ny + vv * nx + u
            : c.plane === 'coronal'
              ? c.slice * nx * ny + vv * nx + u
              : vv * nx * ny + u * nx + c.slice;
          vals.push(v.data[idx]!);
        }
      }
      assert.equal(got.count, vals.length, `${c.plane} count`);
      assert.ok(got.count > 0, `${c.plane} non-empty`);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      assert.ok(Math.abs(got.mean - mean) < 1e-9, `${c.plane} mean`);
      assert.equal(got.min, Math.min(...vals), `${c.plane} min`);
      assert.equal(got.max, Math.max(...vals), `${c.plane} max`);
      assert.ok(got.std >= 0 && Number.isFinite(got.std), `${c.plane} std`);
    }
  });
  it('ellipseStats clamps slices, clips borders, empties degenerate radii', () => {
    const v = testVol();
    const a = ellipseStats(v, 'axial', -99, 3, 3, 2, 2);
    const b = ellipseStats(v, 'axial', 0, 3, 3, 2, 2);
    assert.deepEqual(a, b, 'negative slice clamps to 0');
    const huge = ellipseStats(v, 'coronal', 3, 4, 2, 999, 999);
    assert.ok(huge.count > 0 && huge.count <= 8 * 5, 'giant ellipse clips to plane');
    for (const bad of [[0, 2], [2, 0], [-1, 2], [2, NaN]] as [number, number][]) {
      const e = ellipseStats(v, 'sagittal', 1, 3, 2, bad[0], bad[1]);
      assert.equal(e.count, 0, `radii ${bad} empty`);
      assert.ok(Number.isNaN(e.mean), `radii ${bad} NaN mean`);
    }
  });
  it('cobb: parallel 0, perpendicular 90', () => {
    assert.ok(cobbAngle([0, 0], [1, 0], [0, 1], [1, 1]) < 1e-9);
    assert.ok(Math.abs(cobbAngle([0, 0], [1, 0], [0, 0], [0, 1]) - 90) < 1e-9);
    assert.ok(Math.abs(cobbAngle([0, 0], [1, 1], [0, 0], [1, -1]) - 90) < 1e-9);
  });
  it('cobb bounded on 20 random quads', () => {
    const rng = mulberry32(31);
    for (let t = 0; t < 20; t++) {
      const p = (): [number, number] => [rng() * 10 - 5, rng() * 10 - 5];
      const g = cobbAngle(p(), p(), p(), p());
      assert.ok(g >= 0 && g <= 90, `case ${t}: ${g}`);
    }
  });
  it('probePoint hits and misses', () => {
    const v = testVol();
    assert.equal(probePoint(v, 0, 0, 0), 0);
    assert.equal(probePoint(v, 3, 2, 1), (1 * 56 + 2 * 8 + 3) % 251);
    assert.equal(probePoint(v, -1, 0, 0), null);
    assert.equal(probePoint(v, 8, 0, 0), null);
  });
});

function sampleRows(): Measurement[] {
  return [
    createMeasurement('length', 'axial', 10, [[0, 0], [3, 4]], 5, 'mm', 's1'),
    createMeasurement('angle', 'axial', 11, [[0, 0], [1, 1], [2, 0]], 90, 'deg', 's1'),
    createMeasurement('probe', 'axial', 12, [[5, 5]], 123, 'HU', 's"2'),
  ];
}

describe('tracking export', () => {
  it('ids unique, labels defaulted', () => {
    const [a, b] = sampleRows();
    assert.notEqual(a!.id, b!.id);
    assert.match(a!.label, /Length/);
    assert.ok(!Number.isNaN(Date.parse(a!.createdAt)));
  });
  it('CSV header + escaping', () => {
    const csv = measurementsToCSV(sampleRows());
    const lines = csv.trim().split('\n');
    assert.equal(lines.length, 4);
    assert.ok(lines[0]!.startsWith('id,kind,label'));
    assert.ok(lines[3]!.includes('"s""2"'), 'quotes escaped');
    assert.ok(lines[1]!.includes('0:0;3:4'), 'points serialized');
  });
  it('JSON round-trip + validation', () => {
    const rows = sampleRows();
    const back = measurementsFromJSON(measurementsToJSON(rows));
    assert.equal(back.length, 3);
    assert.equal(back[0]!.value, 5);
    assert.throws(() => measurementsFromJSON('{}'), /array/);
    assert.throws(() => measurementsFromJSON('[ {"id":1} ]'), /invalid/);
  });
  it('SR model shape', () => {
    const sr = measurementsToSR(sampleRows(), '9.9') as {
      Modality: string; SeriesUID: string; ContentSequence: { ValueType: string; MeasuredValueSequence: { NumericValue: number }[] }[];
    };
    assert.equal(sr.Modality, 'SR');
    assert.equal(sr.SeriesUID, '9.9');
    assert.equal(sr.ContentSequence.length, 3);
    assert.equal(sr.ContentSequence[0]!.ValueType, 'NUM');
    assert.equal(sr.ContentSequence[0]!.MeasuredValueSequence[0]!.NumericValue, 5);
  });
  it('empty export valid', () => {
    assert.ok(measurementsToCSV([]).startsWith('id,'));
    assert.equal(measurementsFromJSON('[]').length, 0);
  });
  it('csv rows carry their values back (30 tables)', () => {
    const rng = mulberry32(32);
    for (let t = 0; t < 30; t++) {
      const n = randInt(rng, 0, 8);
      const rows: Measurement[] = Array.from({ length: n }, (_, i) =>
        createMeasurement('length', 'axial', i, [[i, i], [i + 1, i]], i * 1.5, 'mm', 's'));
      const lines = measurementsToCSV(rows).trim().split('\n');
      assert.equal(lines.length, n + 1, `case ${t}`);
      // every value survives the CSV round trip verbatim in its row
      rows.forEach((r, i) => {
        assert.ok(lines[i + 1]!.includes(String(r.value)), `case ${t} row ${i}: ${r.value} missing`);
        assert.ok(lines[i + 1]!.includes(`${i}:${i};${i + 1}:${i}`), `case ${t} row ${i} points`);
      });
    }
  });
});
