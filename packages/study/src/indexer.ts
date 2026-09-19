import type { DicomFileMeta } from '@carys/io';
import type { SourceKind, StudyRecord } from './types.js';

export interface CatalogEntry {
  img?: string[];
  seg?: string[];
  dicom?: string[];
}

function guessModality(key: string, meta: DicomFileMeta | null): string {
  if (meta?.modality) return meta.modality;
  const k = key.toLowerCase();
  if (k.includes('ct') || k.includes('covid') || k.includes('lung')) return 'CT';
  if (k.includes('mr') || k.includes('flair') || k.includes('prostate')) return 'MR';
  if (k.includes('cardiac')) return 'MR';
  if (k.includes('skull')) return 'CT';
  return 'OT';
}

function kindOf(entry: CatalogEntry): SourceKind {
  return entry.dicom ? 'dicom' : 'nifti';
}

/** Build one worklist row per catalog entry; geometry fills in lazily. */
export function buildRecord(key: string, entry: CatalogEntry, meta: DicomFileMeta | null = null): StudyRecord {
  const files = [...(entry.img ?? []), ...(entry.seg ?? []), ...(entry.dicom ?? [])];
  return {
    key,
    patientName: meta?.patientName ?? null,
    patientID: meta?.patientID ?? null,
    studyUID: meta?.studyUID ?? null,
    modality: guessModality(key, meta),
    seriesDescription: meta?.seriesDescription ?? null,
    studyDate: meta?.studyDate ?? null,
    source: kindOf(entry),
    files,
    hasSeg: (entry.seg?.length ?? 0) > 0,
    dims: null,
    spacing: null,
    voxels: null,
    bytes: null,
    anonymized: false,
  };
}

/** Fill geometry + identity from a fetched volume and first-slice meta. */
export function enrichRecord(
  rec: StudyRecord,
  geo: { dims: [number, number, number]; spacing?: [number, number, number] },
  meta: DicomFileMeta | null = null,
): StudyRecord {
  const [nx, ny, nz] = geo.dims;
  return {
    ...rec,
    dims: geo.dims,
    spacing: geo.spacing ?? null,
    voxels: nx * ny * nz,
    patientName: meta?.patientName ?? rec.patientName,
    patientID: meta?.patientID ?? rec.patientID,
    studyUID: meta?.studyUID ?? rec.studyUID,
    modality: meta?.modality ?? rec.modality,
    seriesDescription: meta?.seriesDescription ?? rec.seriesDescription,
    studyDate: meta?.studyDate ?? rec.studyDate,
  };
}

/** Human file-size for the worklist. */
export function fmtBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
