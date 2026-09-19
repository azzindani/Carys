import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importRadiomicsCsv, importRadiomicsRows, RADIOMICS_FEATURES } from '../radiomics.js';

const CSV = [
  'label,original_firstorder_Mean,original_shape_Volume_mm3',
  'nodule-A,42.5,1250',
  'nodule-B,-100,300.25',
].join('\n');

describe('G3 radiomics CSV import', () => {
  it('imports features as tagged rows with units + kinds', () => {
    const rows = importRadiomicsCsv(CSV, 's1');
    assert.equal(rows.length, 4);
    assert.ok(rows.every((m) => m.series === 's1'));
    assert.ok(rows.every((m) => m.label.endsWith('· radiomics import')));
    const mean = rows.find((m) => m.label.includes('nodule-A') && m.label.includes('Mean'))!;
    assert.equal(mean.value, 42.5);
    assert.equal(mean.unit, 'HU');
    assert.equal(mean.kind, 'probe');
    const vol = rows.find((m) => m.label.includes('Volume_mm3'))!;
    assert.equal(vol.value, 1250);
    assert.equal(vol.unit, 'mm3');
    assert.equal(vol.kind, 'roi');
    assert.deepEqual(RADIOMICS_FEATURES.length, 6);
  });
  it('quoted labels + all six features parse', () => {
    const csv = ['label,' + RADIOMICS_FEATURES.join(','), '"mass, left",1,2,3,4,5,6'].join('\n');
    const rows = importRadiomicsCsv(csv, 's1');
    assert.equal(rows.length, 6);
    assert.ok(rows[0]!.label.startsWith('mass, left'));
  });
  it('misshaped CSV fails loud with named errors', () => {
    assert.throws(() => importRadiomicsCsv('', 's1'), /radiomics-import/);
    assert.throws(() => importRadiomicsCsv('label\n', 's1'), /at least one data row/);
    assert.throws(() => importRadiomicsCsv('name,original_firstorder_Mean\nx,1', 's1'), /label column/);
    assert.throws(() => importRadiomicsCsv('label,original_firstorder_Median\nx,1', 's1'), /unknown feature/);
    assert.throws(() => importRadiomicsCsv('label\nx', 's1'), /no feature columns/);
    assert.throws(() => importRadiomicsCsv('label,original_firstorder_Mean\n,1', 's1'), /empty label/);
    assert.throws(() => importRadiomicsCsv('label,original_firstorder_Mean\nx,lots', 's1'), /not finite/);
    assert.throws(() => importRadiomicsCsv(CSV, ''), /series/);
  });
  it('object rows share the contract (unknown columns + NaN loud)', () => {
    const rows = importRadiomicsRows([{ label: 'n', original_firstorder_Minimum: -900 }], 's1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.value, -900);
    assert.throws(() => importRadiomicsRows([{ label: 'n', nope: 1 }], 's1'), /unknown feature/);
    assert.throws(() => importRadiomicsRows([{ label: '' }], 's1'), /label/);
    assert.throws(() => importRadiomicsRows('x', 's1'), /array/);
  });
});
