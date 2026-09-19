// DICOMweb client: QIDO-RS search, WADO-RS retrieve, STOW-RS store.
// Transport-neutral via injected fetch; every failure is a DicomWebError.
import { instanceFromJson, seriesFromJson, studyFromJson, type JsonDataset } from './json-model.js';
import { boundaryFromContentType, parseMultipartRelated, partsOfType } from './multipart.js';
import { buildStowBody, parseStowResponse, type StowItem } from './stow.js';
import {
  DicomWebError,
  type DicomWebConfig, type FetchFn, type InstanceSummary, type SeriesSummary, type StudySummary,
} from './types.js';

export interface StudyQuery {
  patientName?: string;
  patientID?: string;
  studyDate?: string;
  modality?: string;
  accession?: string;
  limit?: number;
  offset?: number;
}

function params(q: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export class DicomWebClient {
  private readonly base: string;
  private readonly fetchFn: FetchFn;
  private readonly headers: Record<string, string>;
  private readonly limit: number;

  constructor(cfg: DicomWebConfig) {
    this.base = cfg.baseUrl.replace(/\/+$/, '');
    if (!/^https?:\/\//.test(this.base)) throw new DicomWebError('config', 0, `baseUrl must be http(s): ${cfg.baseUrl}`);
    this.fetchFn = cfg.fetchFn;
    this.headers = { ...(cfg.headers ?? {}) };
    this.limit = cfg.limit ?? 50;
  }

  get baseUrl(): string {
    return this.base;
  }

  private async request(path: string, init: RequestInit, op: string): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        ...init,
        headers: { ...this.headers, ...(init.headers as Record<string, string> | undefined) },
      });
    } catch (e) {
      throw new DicomWebError(op, 0, `network: ${(e as Error).message}`);
    }
    if (!res.ok) throw new DicomWebError(op, res.status, res.statusText || 'request failed');
    return res;
  }

  private async getJson<T>(path: string, accept: string, op: string): Promise<T> {
    const res = await this.request(path, { headers: { Accept: accept } }, op);
    try {
      return (await res.json()) as T;
    } catch {
      throw new DicomWebError(op, res.status, 'invalid JSON response');
    }
  }

  // ---------- QIDO-RS ----------

  async searchStudies(q: StudyQuery = {}): Promise<StudySummary[]> {
    const data = await this.getJson<JsonDataset[]>(
      `/studies${params({
        PatientName: q.patientName, PatientID: q.patientID, StudyDate: q.studyDate,
        Modality: q.modality, AccessionNumber: q.accession,
        limit: q.limit ?? this.limit, offset: q.offset,
      })}`,
      'application/dicom+json',
      'QIDO studies',
    );
    if (!Array.isArray(data)) throw new DicomWebError('QIDO studies', 200, 'expected a JSON array');
    return data.map(studyFromJson);
  }

  async searchSeries(studyUID: string): Promise<SeriesSummary[]> {
    const data = await this.getJson<JsonDataset[]>(
      `/studies/${encodeURIComponent(studyUID)}/series${params({ limit: this.limit })}`,
      'application/dicom+json',
      'QIDO series',
    );
    if (!Array.isArray(data)) throw new DicomWebError('QIDO series', 200, 'expected a JSON array');
    return data.map(seriesFromJson);
  }

  async searchInstances(studyUID: string, seriesUID: string): Promise<InstanceSummary[]> {
    const data = await this.getJson<JsonDataset[]>(
      `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances${params({ limit: this.limit })}`,
      'application/dicom+json',
      'QIDO instances',
    );
    if (!Array.isArray(data)) throw new DicomWebError('QIDO instances', 200, 'expected a JSON array');
    return data.map(instanceFromJson);
  }

  // ---------- WADO-RS ----------

  /** Full-instance retrieve: returns raw Part-10 bytes per instance. */
  async retrieveInstances(studyUID: string, seriesUID: string, uids: string[]): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    for (const uid of uids) {
      const res = await this.request(
        `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances/${encodeURIComponent(uid)}`,
        { headers: { Accept: 'multipart/related; type="application/dicom"' } },
        'WADO instance',
      );
      const ct = res.headers.get('content-type') ?? '';
      const buf = new Uint8Array(await res.arrayBuffer());
      if (ct.includes('multipart/related')) {
        const parts = partsOfType(parseMultipartRelated(buf, boundaryFromContentType(ct)), 'application/dicom');
        if (parts.length === 0) throw new DicomWebError('WADO instance', res.status, 'no application/dicom part');
        out.push(parts[0]!.body);
      } else {
        out.push(buf); // single-part response
      }
    }
    return out;
  }

  /** Instance metadata as JSON model datasets. */
  async retrieveMetadata(studyUID: string, seriesUID: string, uid: string): Promise<JsonDataset[]> {
    const data = await this.getJson<JsonDataset[]>(
      `/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(seriesUID)}/instances/${encodeURIComponent(uid)}/metadata`,
      'application/dicom+json',
      'WADO metadata',
    );
    if (!Array.isArray(data)) throw new DicomWebError('WADO metadata', 200, 'expected a JSON array');
    return data;
  }

  // ---------- STOW-RS ----------

  async storeInstances(items: StowItem[]): Promise<{ stored: string[]; failed: { uid: string; reason: string }[] }> {
    const { body, contentType } = buildStowBody(items);
    const res = await this.request(
      '/studies',
      {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: body as unknown as BodyInit,
      },
      'STOW store',
    );
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return { stored: items.map((_, i) => `#${i}`), failed: [] };
    return parseStowResponse(await res.json());
  }
}
