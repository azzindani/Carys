// Study-management domain types. A StudyRecord is the worklist row:
// identity (may be anonymized), provenance, geometry once loaded.

export type SourceKind = 'nifti' | 'dicom' | 'upload';

export interface StudyRecord {
  /** stable catalog key, e.g. 'brats-flair-seg' */
  key: string;
  patientName: string | null;
  patientID: string | null;
  studyUID: string | null;
  modality: string;
  seriesDescription: string | null;
  studyDate: string | null;
  source: SourceKind;
  files: string[];
  hasSeg: boolean;
  /** filled lazily once the volume is fetched */
  dims: [number, number, number] | null;
  spacing: [number, number, number] | null;
  voxels: number | null;
  bytes: number | null;
  anonymized: boolean;
}

export interface AnonymizeProfile {
  patientName: string;
  patientID: string;
  keepDates: boolean;
}

export const DEFAULT_PROFILE: AnonymizeProfile = {
  patientName: 'ANONYMIZED',
  patientID: 'ANON',
  keepDates: false,
};
