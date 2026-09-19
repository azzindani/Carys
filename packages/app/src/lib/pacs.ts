import { DicomWebClient } from '@carys/dicomweb';
import { parseDicomSlice, sortSlices, stackPixelSpacing, stackToVolume, stackZGap } from '@carys/io';
import { SERIES } from './catalog';
import { loadDicomSeries, loadNii } from './loaders';
import { session } from './session';
import type { Volume } from './types';

export interface PacsEndpoint {
  id: string;
  name: string;
  baseUrl: string;
}

const KEY = 'carys.pacs.endpoints';
/** Endpoints written before the Carys rename — read once, then saved under the new key. */
const KEY_LEGACY = 'omniviewer.pacs.endpoints';

export function listEndpoints(): PacsEndpoint[] {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(KEY_LEGACY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as PacsEndpoint[];
    return Array.isArray(arr) ? arr.filter((e) => e?.baseUrl) : [];
  } catch {
    return [];
  }
}

export function saveEndpoint(ep: PacsEndpoint): PacsEndpoint[] {
  const all = listEndpoints().filter((e) => e.id !== ep.id);
  const next = [...all, ep];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* private mode: endpoints stay in memory */ }
  return next;
}

export function removeEndpoint(id: string): PacsEndpoint[] {
  const next = listEndpoints().filter((e) => e.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  return next;
}

export function pacsClient(baseUrl: string): DicomWebClient {
  // Chrome binds the transport; engine only ever calls the injected fn.
  return new DicomWebClient({ baseUrl, fetchFn: (url, init) => fetch(url, init) });
}

/** Pull a full series via WADO-RS instances and stack it like local DICOM. */
export async function pullSeriesVolume(
  client: DicomWebClient, studyUID: string, seriesUID: string, signal?: AbortSignal,
): Promise<Volume> {
  const instances = await client.searchInstances(studyUID, seriesUID);
  if (instances.length === 0) throw new Error('series has no instances');
  const order = instances
    .slice()
    .sort((a, b) => (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0))
    .map((i) => i.instanceUID);
  const bufs = await client.retrieveInstances(studyUID, seriesUID, order);
  const parsed = bufs.map((b) => parseDicomSlice(b.buffer as ArrayBuffer));
  const byLoc = new Map(parsed.map((s) => [s.slice, s.meta.sliceLocation ?? s.meta.instanceNumber ?? 0]));
  const slices = sortSlices(parsed.map((s) => s.slice))
    .sort((a, b) => (byLoc.get(a) ?? 0) - (byLoc.get(b) ?? 0));
  const locs = parsed.map((s) => s.meta.sliceLocation).filter((v): v is number => v != null).sort((a, b) => a - b);
  let zgap = stackZGap(parsed[0]!.meta);
  if (locs.length > 1) {
    const gaps = locs.slice(1).map((v, i) => Math.abs(v - locs[i]!));
    gaps.sort((a, b) => a - b);
    const med = gaps[Math.floor(gaps.length / 2)]!;
    if (med > 0 && Number.isFinite(med)) zgap = med;
  }
  const ps = stackPixelSpacing(parsed[0]!.meta) ?? [1, 1];
  const stacked = stackToVolume(slices);
  const n = stacked.dims[0] * stacked.dims[1] * stacked.dims[2];
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) data[i] = stacked.data[i];
  void signal;
  return { dims: stacked.dims, data, spacing: [ps[1]!, ps[0]!, zgap] };
}

/** Resolve any catalog key to a volume: cache, local files, or PACS pull. */
export async function resolveVolume(key: string, signal?: AbortSignal): Promise<Volume> {
  const cached = session.getVol(key);
  if (cached) return cached;
  const spec = SERIES[key];
  if (!spec) throw new Error(`unknown series: ${key}`);
  let vol: Volume;
  if (spec.remote) {
    vol = await pullSeriesVolume(pacsClient(spec.remote.endpoint), spec.remote.studyUID, spec.remote.seriesUID, signal);
  } else if (spec.dicom?.length) {
    vol = (await loadDicomSeries(spec.dicom, { signal })).vol;
  } else if (spec.img?.length) {
    vol = await loadNii(spec.img[0]!, { signal });
  } else {
    throw new Error('empty series — upload or pull it first');
  }
  session.cacheVol(key, vol);
  return vol;
}
