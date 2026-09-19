// DICOM JSON model (QIDO-RS responses, WADO-RS metadata):
// { "00100010": { "vr": "PN", "Value": [{ "Alphabetic": "DOE^JOHN" }] } }
import type { InstanceSummary, SeriesSummary, StudySummary } from './types.js';

export type JsonElement = { vr: string; Value?: unknown[]; BulkDataURI?: string };
export type JsonDataset = Record<string, JsonElement>;

function raw(ds: JsonDataset, tag: string): unknown[] | undefined {
  return ds[tag]?.Value;
}

function firstString(ds: JsonDataset, tag: string): string | null {
  const v = raw(ds, tag)?.[0];
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const a = o['Alphabetic'];
    if (typeof a === 'string') return a;
  }
  return null;
}

function firstNumber(ds: JsonDataset, tag: string): number | null {
  const v = raw(ds, tag)?.[0];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function allStrings(ds: JsonDataset, tag: string): string[] {
  return (raw(ds, tag) ?? []).flatMap((v) => (typeof v === 'string' ? [v] : []));
}

const T = {
  studyUID: '0020000D',
  seriesUID: '0020000E',
  instanceUID: '00080018',
  patientName: '00100010',
  patientID: '00100020',
  studyDate: '00080020',
  studyDescription: '00081030',
  seriesDescription: '0008103E',
  modality: '00080060',
  modalitiesInStudy: '00080061',
  seriesNumber: '00200011',
  instanceNumber: '00200013',
  sliceLocation: '00201041',
  rows: '00280010',
  cols: '00280011',
  numSeries: '00201206',
  numInstances: '00201208',
  numSeriesInStudy: '00201206',
};

export function studyFromJson(ds: JsonDataset): StudySummary {
  const mods = allStrings(ds, T.modalitiesInStudy);
  if (mods.length === 0) {
    const m = firstString(ds, T.modality);
    if (m) mods.push(m);
  }
  return {
    studyUID: firstString(ds, T.studyUID) ?? '',
    patientName: firstString(ds, T.patientName),
    patientID: firstString(ds, T.patientID),
    studyDate: firstString(ds, T.studyDate),
    studyDescription: firstString(ds, T.studyDescription),
    modalities: mods,
    seriesCount: firstNumber(ds, T.numSeries),
    instanceCount: firstNumber(ds, T.numInstances),
  };
}

export function seriesFromJson(ds: JsonDataset): SeriesSummary {
  return {
    studyUID: firstString(ds, T.studyUID) ?? '',
    seriesUID: firstString(ds, T.seriesUID) ?? '',
    modality: firstString(ds, T.modality),
    seriesNumber: firstNumber(ds, T.seriesNumber),
    seriesDescription: firstString(ds, T.seriesDescription),
    instanceCount: firstNumber(ds, T.numInstances),
  };
}

export function instanceFromJson(ds: JsonDataset): InstanceSummary {
  return {
    studyUID: firstString(ds, T.studyUID) ?? '',
    seriesUID: firstString(ds, T.seriesUID) ?? '',
    instanceUID: firstString(ds, T.instanceUID) ?? '',
    instanceNumber: firstNumber(ds, T.instanceNumber),
    sliceLocation: firstString(ds, T.sliceLocation),
    rows: firstNumber(ds, T.rows),
    cols: firstNumber(ds, T.cols),
  };
}
