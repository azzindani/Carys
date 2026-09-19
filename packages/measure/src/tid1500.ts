// DICOM SR TID 1500 (Measurement Report) JSON model: template-shaped
// content sequence over the tracked measurements. This is the lossless
// interchange + reporting layer (same status as measurementsToSR), NOT a
// Part-10 binary writer — that needs a dataset encoder + UID allocation
// product call, documented at the call site.
//
// TID 1500 shape encoded here: Imaging Measurements container →
// Measurement Group per finding → Tracking Identifier + Finding Site +
// numeric measurement (SCOORD source). Code meanings use the DCMR
// well-known codes where they exist (121071 Finding, 121058 Finding Site,
// 112039 Tracking Identifier); measurement concepts carry the caller's
// label as Code Meaning with the CARYS designator (pre-rename files used OMNIVIEWER).
import type { Measurement } from './tracking.js';

export interface Tid1500Group {
  trackingUID: string;
  findingLabel: string;
  site: string;
  measurements: {
    kind: string;
    label: string;
    value: number;
    unit: string;
    plane: string;
    slice: number;
    points: [number, number][];
  }[];
}

function code(codeValue: string, designator: string, meaning: string): object {
  return { CodeValue: codeValue, CodingSchemeDesignator: designator, CodeMeaning: meaning };
}

/** Group tracked measurements by series+label into finding groups. */
export function groupForTid1500(rows: Measurement[]): Tid1500Group[] {
  const by = new Map<string, Measurement[]>();
  for (const m of rows) {
    const k = `${m.series}||${m.label}`;
    const g = by.get(k);
    if (g) g.push(m);
    else by.set(k, [m]);
  }
  return [...by.entries()].map(([k, ms], gi) => ({
    trackingUID: `carys.${gi + 1}`,
    findingLabel: k.split('||')[1] ?? k,
    site: ms[0]?.plane ?? 'axial',
    measurements: ms.map((m) => ({
      kind: m.kind, label: m.label,
      value: Math.round(m.value * 100) / 100, unit: m.unit,
      plane: m.plane, slice: m.slice, points: m.points,
    })),
  }));
}

/** TID 1500 Measurement Report as a JSON content tree. */
export function measurementsToTid1500(rows: Measurement[], seriesUID = 'unspecified'): object {
  const groups = groupForTid1500(rows);
  return {
    Modality: 'SR',
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.11',
    SeriesUID: seriesUID,
    ConceptNameCodeSequence: [code('126000', 'DCM', 'Imaging Measurement Report')],
    ContentSequence: [
      {
        RelationshipType: 'CONTAINS',
        ValueType: 'CONTAINER',
        ConceptNameCodeSequence: [code('126010', 'DCM', 'Imaging Measurements')],
        ContentSequence: groups.map((g) => ({
          RelationshipType: 'CONTAINS',
          ValueType: 'CONTAINER',
          ConceptNameCodeSequence: [code('125007', 'DCM', 'Measurement Group')],
          ContentSequence: [
            {
              RelationshipType: 'CONTAINS',
              ValueType: 'TEXT',
              ConceptNameCodeSequence: [code('112039', 'DCM', 'Tracking Identifier')],
              TextValue: g.trackingUID,
            },
            {
              RelationshipType: 'CONTAINS',
              ValueType: 'CODE',
              ConceptNameCodeSequence: [code('121071', 'DCM', 'Finding')],
              ConceptCodeSequence: [code(g.findingLabel, 'CARYS', g.findingLabel)],
            },
            ...g.measurements.map((m) => ({
              RelationshipType: 'CONTAINS',
              ValueType: 'NUM',
              ConceptNameCodeSequence: [code(m.kind, 'CARYS', m.label)],
              MeasuredValueSequence: [{
                NumericValue: m.value,
                MeasurementUnitsCodeSequence: [code(m.unit || '1', 'UCUM', m.unit || 'no units')],
              }],
              ContentSequence: [{
                RelationshipType: 'INFERRED FROM',
                ValueType: 'SCOORD',
                GraphicType: m.points.length > 2 ? 'POLYLINE' : m.points.length === 2 ? 'LINE' : 'POINT',
                GraphicData: m.points.flat(),
              }],
            })),
          ],
        })),
      },
    ],
  };
}
