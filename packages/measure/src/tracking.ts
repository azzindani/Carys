// Measurement tracking: records, CSV/JSON export, and a simplified DICOM
// SR JSON model (TID-1500-style content sequence, JSON representation).
// Real Part-10 SR encoding is domain 8 territory; this is the lossless
// interchange + reporting layer.

export type MeasureKind = 'length' | 'angle' | 'probe' | 'roi' | 'ellipse' | 'cobb';

export interface Measurement {
  id: string;
  kind: MeasureKind;
  label: string;
  /** plane coords: axial [x,y], coronal [x,z], sagittal [y,z] */
  plane: 'axial' | 'coronal' | 'sagittal';
  slice: number;
  points: [number, number][];
  value: number;
  unit: string;
  series: string;
  createdAt: string;
}

let seq = 0;

export function makeId(): string {
  seq++;
  return `m-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export function createMeasurement(
  kind: MeasureKind,
  plane: Measurement['plane'],
  slice: number,
  points: [number, number][],
  value: number,
  unit: string,
  series: string,
): Measurement {
  const n = seq + 1;
  const defaults: Record<MeasureKind, string> = {
    length: `Length ${n}`, angle: `Angle ${n}`, probe: `Probe ${n}`,
    roi: `ROI ${n}`, ellipse: `Ellipse ${n}`, cobb: `Cobb ${n}`,
  };
  return {
    id: makeId(), kind, label: defaults[kind], plane, slice, points,
    value, unit, series, createdAt: new Date().toISOString(),
  };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function measurementsToCSV(rows: Measurement[]): string {
  const head = 'id,kind,label,plane,slice,points,value,unit,series,createdAt';
  const lines = rows.map((m) => [
    m.id, m.kind, m.label, m.plane, m.slice,
    m.points.map((p) => `${p[0]}:${p[1]}`).join(';'),
    Math.round(m.value * 100) / 100, m.unit, m.series, m.createdAt,
  ].map(csvCell).join(','));
  return [head, ...lines].join('\n') + '\n';
}

export function measurementsToJSON(rows: Measurement[]): string {
  return JSON.stringify(rows, null, 2);
}

/** Simplified SR content sequence (one NUM item per measurement). */
export function measurementsToSR(rows: Measurement[], seriesUID = 'unspecified'): object {
  return {
    Modality: 'SR',
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.11',
    SeriesUID: seriesUID,
    ContentSequence: rows.map((m) => ({
      RelationshipType: 'CONTAINS',
      ValueType: 'NUM',
      ConceptNameCodeSequence: [{ CodeValue: m.kind, CodingSchemeDesignator: 'CARYS', CodeMeaning: m.label }],
      MeasuredValueSequence: [{
        NumericValue: Math.round(m.value * 100) / 100,
        MeasurementUnitsCodeSequence: [{ CodeValue: m.unit, CodingSchemeDesignator: 'UCUM' }],
      }],
      ContentSequence: [{
        RelationshipType: 'INFERRED FROM',
        ValueType: 'SCOORD',
        GraphicType: m.points.length > 2 ? 'POLYLINE' : 'POINT',
        GraphicData: m.points.flat(),
      }],
    })),
  };
}

export function measurementsFromJSON(text: string): Measurement[] {
  const arr = JSON.parse(text) as Measurement[];
  if (!Array.isArray(arr)) throw new Error('expected a JSON array');
  for (const m of arr) {
    if (typeof m.id !== 'string' || typeof m.kind !== 'string' || !Array.isArray(m.points)) {
      throw new Error('invalid measurement row');
    }
  }
  return arr;
}
