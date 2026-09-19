// DICOMweb (QIDO-RS / WADO-RS / STOW-RS) domain types.
// Transport-neutral: the client takes a fetch implementation so unit tests
// never touch the network and the app can inject auth.

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface DicomWebConfig {
  /** e.g. 'https://pacs.example/dicom-web' (no trailing slash) */
  baseUrl: string;
  /** required (never defaulted): engine must not bind the network global */
  fetchFn: FetchFn;
  /** added to every request: Authorization, custom headers */
  headers?: Record<string, string>;
  limit?: number;
}

export class DicomWebError extends Error {
  readonly status: number;
  readonly operation: string;
  constructor(operation: string, status: number, message: string) {
    super(`${operation} failed (${status}): ${message}`);
    this.name = 'DicomWebError';
    this.status = status;
    this.operation = operation;
  }
}

export interface StudySummary {
  studyUID: string;
  patientName: string | null;
  patientID: string | null;
  studyDate: string | null;
  studyDescription: string | null;
  modalities: string[];
  seriesCount: number | null;
  instanceCount: number | null;
}

export interface SeriesSummary {
  studyUID: string;
  seriesUID: string;
  modality: string | null;
  seriesNumber: number | null;
  seriesDescription: string | null;
  instanceCount: number | null;
}

export interface InstanceSummary {
  studyUID: string;
  seriesUID: string;
  instanceUID: string;
  instanceNumber: number | null;
  sliceLocation: string | null;
  rows: number | null;
  cols: number | null;
}

export interface MultipartPart {
  headers: Record<string, string>;
  contentType: string;
  contentLocation: string | null;
  body: Uint8Array;
}
