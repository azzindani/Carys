import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writePart10, type DcmElement } from '../dcm-write.js';
import { readDataset } from '../dcm-read.js';
import {
  RTDOSE_SOP_CLASS, RTPLAN_SOP_CLASS, doseStats, dvhLabel,
  isRtDoseSopClass, isRtPlanSopClass, parseRtDose, parseRtPlan,
} from '../rt.js';

const item = (els: DcmElement[]): { elements: DcmElement[] } => ({ elements: els });

/** RTPLAN: label + 1 fraction group (2 beam refs) + 2 beams + 1 dose ref. */
function planFile(): ArrayBuffer {
  return writePart10(RTPLAN_SOP_CLASS, '1.2.9.1', [
    { tag: [0x0008, 0x0016], vr: 'UI', value: RTPLAN_SOP_CLASS },
    { tag: [0x0008, 0x0060], vr: 'CS', value: 'RTPLAN' },
    { tag: [0x300a, 0x0002], vr: 'SH', value: 'Prostate-78Gy' },
    { tag: [0x300a, 0x0003], vr: 'LO', value: 'Prostate VMAT' },
    { tag: [0x300a, 0x000a], vr: 'CS', value: 'CURATIVE' },
    {
      tag: [0x300a, 0x0070], vr: 'SQ', value: [item([
        { tag: [0x300a, 0x0071], vr: 'IS', value: 1 },
        { tag: [0x300a, 0x0078], vr: 'IS', value: 39 },
        {
          tag: [0x300a, 0x0080], vr: 'SQ', value: [item([
            { tag: [0x300a, 0x00c0], vr: 'IS', value: 1 },
            { tag: [0x300a, 0x0086], vr: 'DS', value: '198.5' },
          ]), item([
            { tag: [0x300a, 0x00c0], vr: 'IS', value: 2 },
            { tag: [0x300a, 0x0086], vr: 'DS', value: '201.5' },
          ])],
        },
      ])],
    },
    {
      tag: [0x300a, 0x00b0], vr: 'SQ', value: [item([
        { tag: [0x300a, 0x00c0], vr: 'IS', value: 1 },
        { tag: [0x300a, 0x00c2], vr: 'LO', value: 'Arc1' },
        { tag: [0x300a, 0x00c4], vr: 'CS', value: 'STATIC' },
        { tag: [0x300a, 0x00c6], vr: 'CS', value: 'PHOTON' },
        {
          tag: [0x300a, 0x0111], vr: 'SQ', value: [item([
            { tag: [0x300a, 0x0112], vr: 'IS', value: 0 },
            { tag: [0x300a, 0x0114], vr: 'DS', value: '6' },
            { tag: [0x300a, 0x011e], vr: 'DS', value: '181.0' },
            { tag: [0x300a, 0x0130], vr: 'DS', value: '900' },
          ])],
        },
      ]), item([
        { tag: [0x300a, 0x00c0], vr: 'IS', value: 2 },
        { tag: [0x300a, 0x00c2], vr: 'LO', value: 'Arc2' },
        { tag: [0x300a, 0x00c6], vr: 'CS', value: 'PHOTON' },
        {
          tag: [0x300a, 0x0111], vr: 'SQ', value: [item([
            { tag: [0x300a, 0x0112], vr: 'IS', value: 0 },
            { tag: [0x300a, 0x0114], vr: 'DS', value: '6' },
            { tag: [0x300a, 0x011e], vr: 'DS', value: '179.0' },
          ])],
        },
      ])],
    },
    {
      tag: [0x300a, 0x0010], vr: 'SQ', value: [item([
        { tag: [0x300a, 0x0012], vr: 'IS', value: 1 },
        { tag: [0x300a, 0x0026], vr: 'DS', value: '78.0' },
      ])],
    },
  ]);
}

/** RTDOSE: 4x4x2 16-bit grid, scaling 0.01, 1 DVH row (ROI 1). */
function doseFile(
  opts: { bits?: 16 | 32; scaling?: number; frames?: number; offsets?: string[] } = {},
): ArrayBuffer {
  const bits = opts.bits ?? 16;
  const frames = opts.frames ?? 2;
  const n = 16 * frames;
  const px = bits === 16 ? new Uint8Array(n * 2) : new Uint8Array(n * 4);
  const dv = new DataView(px.buffer);
  for (let i = 0; i < n; i++) {
    if (bits === 16) dv.setUint16(i * 2, (i * 100) % 7000, true);
    else dv.setUint32(i * 4, (i * 100) % 7000, true);
  }
  return writePart10(RTDOSE_SOP_CLASS, '1.2.9.2', [
    { tag: [0x0008, 0x0016], vr: 'UI', value: RTDOSE_SOP_CLASS },
    { tag: [0x0008, 0x0060], vr: 'CS', value: 'RTDOSE' },
    { tag: [0x0028, 0x0010], vr: 'US', value: 4 },
    { tag: [0x0028, 0x0011], vr: 'US', value: 4 },
    { tag: [0x0028, 0x0008], vr: 'IS', value: frames },
    { tag: [0x0028, 0x0100], vr: 'US', value: bits },
    { tag: [0x0028, 0x0101], vr: 'US', value: bits },
    { tag: [0x0028, 0x0103], vr: 'US', value: 0 },
    { tag: [0x0028, 0x0002], vr: 'US', value: 1 },
    { tag: [0x0028, 0x0004], vr: 'CS', value: 'MONOCHROME2' },
    { tag: [0x0020, 0x0032], vr: 'DS', value: ['0', '0', '0'] },
    { tag: [0x0028, 0x0030], vr: 'DS', value: ['2.5', '2.5'] },
    { tag: [0x3004, 0x000c], vr: 'DS', value: opts.offsets ?? Array.from({ length: frames }, (_, i) => String(i * 2.5)) },
    { tag: [0x3004, 0x000e], vr: 'DS', value: String(opts.scaling ?? 0.01) },
    { tag: [0x3004, 0x0002], vr: 'CS', value: 'GY' },
    { tag: [0x3004, 0x0004], vr: 'CS', value: 'PHYSICAL' },
    { tag: [0x3004, 0x000a], vr: 'CS', value: 'PLAN' },
    {
      tag: [0x3004, 0x0050], vr: 'SQ', value: [item([
        { tag: [0x3004, 0x0056], vr: 'IS', value: 10 },
        { tag: [0x3004, 0x0070], vr: 'DS', value: '5.0' },
        { tag: [0x3004, 0x0072], vr: 'DS', value: '70.0' },
        { tag: [0x3004, 0x0074], vr: 'DS', value: '60.0' },
        {
          tag: [0x3004, 0x0060], vr: 'SQ', value: [item([
            { tag: [0x3006, 0x0084], vr: 'IS', value: 1 },
          ])],
        },
      ])],
    },
    {
      tag: [0x3004, 0x0010], vr: 'SQ', value: [item([
        { tag: [0x3006, 0x0084], vr: 'IS', value: 1 },
        { tag: [0x3004, 0x0012], vr: 'DS', value: '70.0' },
      ])],
    },
    { tag: [0x7fe0, 0x0010], vr: 'OB', value: px },
  ]);
}

describe('rtplan + rtdose', () => {
  it('SOP gates accept PLAN/DOSE, reject everything else', () => {
    assert.ok(isRtPlanSopClass(RTPLAN_SOP_CLASS));
    assert.ok(!isRtPlanSopClass(RTDOSE_SOP_CLASS));
    assert.ok(!isRtPlanSopClass(null));
    assert.ok(isRtDoseSopClass(RTDOSE_SOP_CLASS));
    assert.ok(!isRtDoseSopClass(RTPLAN_SOP_CLASS));
    assert.ok(!isRtDoseSopClass(null));
    assert.throws(() => parseRtPlan(readDataset(planFile()).sequence('300A00B0')[0]!), /not an RTPLAN|undefined|void/i);
  });
  it('plan summary: label, fractions, beams with meterset + control-point geometry', () => {
    const plan = parseRtPlan(readDataset(planFile()));
    assert.equal(plan.label, 'Prostate-78Gy');
    assert.equal(plan.name, 'Prostate VMAT');
    assert.equal(plan.intent, 'CURATIVE');
    assert.equal(plan.fractionsPlanned, 39);
    assert.equal(plan.beams.length, 2);
    assert.deepEqual([plan.beams[0]!.number, plan.beams[0]!.name], [1, 'Arc1']);
    assert.equal(plan.beams[0]!.radiationType, 'PHOTON');
    assert.equal(plan.beams[0]!.energy, 6);
    assert.equal(plan.beams[0]!.gantryAngle, 181);
    assert.equal(plan.beams[0]!.meterset, 198.5);
    assert.equal(plan.beams[1]!.meterset, 201.5);
    assert.equal(plan.beams[0]!.ssd, 900);
    assert.equal(plan.beams[1]!.ssd, null); // absent SSD stays null
    assert.deepEqual(plan.prescriptionDoses, [78]);
  });
  it('dose grid decodes 16-bit to Gy with geometry + DVH + ROI doses', () => {
    const g = parseRtDose(readDataset(doseFile()));
    assert.equal(g.rows, 4);
    assert.equal(g.cols, 4);
    assert.equal(g.frames, 2);
    assert.deepEqual(g.imagePosition, [0, 0, 0]);
    assert.deepEqual(g.pixelSpacing, [2.5, 2.5]);
    assert.deepEqual(g.gridOffsets, [0, 2.5]);
    assert.equal(g.doseGridScaling, 0.01);
    assert.equal(g.doseUnits, 'GY');
    assert.equal(g.data[0], 0);
    assert.equal(g.data[1], 1); // 100 * 0.01
    assert.equal(g.data[31], 31); // 3100 * 0.01
    assert.equal(g.dvhs.length, 1);
    assert.deepEqual(
      [g.dvhs[0]!.roiNumber, g.dvhs[0]!.minDose, g.dvhs[0]!.meanDose, g.dvhs[0]!.maxDose, g.dvhs[0]!.bins],
      [1, 5, 60, 70, 10],
    );
    assert.deepEqual(g.roiDoses, [{ roiNumber: 1, dose: 70 }]);
    assert.equal(dvhLabel(g.dvhs), '1 ROI(s) · max 70 Gy');
    const st = doseStats(g);
    assert.equal(st.min, 0);
    assert.equal(st.max, 31);
    assert.ok(Math.abs(st.mean - 15.5) < 1e-9);
    assert.equal(st.hotVoxel, 31);
  });
  it('32-bit grids decode; junk scaling/offsets fail loud', () => {
    const g32 = parseRtDose(readDataset(doseFile({ bits: 32 })));
    assert.equal(g32.data[1], 1);
    assert.throws(() => parseRtDose(readDataset(doseFile({ scaling: 1e9 }))), /rtdose-scaling/);
    // offsets built for 2 frames but the header declares 3: count mismatch
    assert.throws(() => parseRtDose(readDataset(doseFile({ frames: 3, offsets: ['0', '2.5'] }))), /rtdose-offsets/);
    // writer-junk scaling is caught even when offsets match
    assert.throws(() => parseRtDose(readDataset(doseFile({ scaling: 1e7 }))), /rtdose-scaling/);
  });
  it('missing geometry/scaling/pixels fail loud with rtdose-* names', () => {
    const noScaling = readDataset(doseFile());
    // strip scaling via a hand-built minimal dataset: no DoseGridScaling
    const bare = writePart10(RTDOSE_SOP_CLASS, '1.2.9.3', [
      { tag: [0x0008, 0x0016], vr: 'UI', value: RTDOSE_SOP_CLASS },
      { tag: [0x0028, 0x0010], vr: 'US', value: 2 },
      { tag: [0x0028, 0x0011], vr: 'US', value: 2 },
      { tag: [0x0028, 0x0100], vr: 'US', value: 16 },
      { tag: [0x0028, 0x0002], vr: 'US', value: 1 },
      { tag: [0x0028, 0x0004], vr: 'CS', value: 'MONOCHROME2' },
      { tag: [0x0020, 0x0032], vr: 'DS', value: ['0', '0', '0'] },
      { tag: [0x0028, 0x0030], vr: 'DS', value: ['1', '1'] },
      { tag: [0x3004, 0x000c], vr: 'DS', value: ['0'] },
      { tag: [0x7fe0, 0x0010], vr: 'OB', value: new Uint8Array(8) },
    ]);
    assert.throws(() => parseRtDose(readDataset(bare)), /rtdose-no-scaling/);
    assert.equal(noScaling.text('00080016'), RTDOSE_SOP_CLASS);
    assert.equal(dvhLabel([]), null);
    assert.throws(() => doseStats({ ...parseRtDose(readDataset(doseFile())), data: new Float32Array(0) }), /rtdose-empty-grid/);
  });
});
