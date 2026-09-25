import { DicomWebClient } from '@carys/dicomweb';
import { groupDicomStacks, parseDicomFrames, type ParsedDicomSlice } from '@carys/io';
import { SERIES } from './catalog';
import { loadDicomSeries, volumeFromStack } from './formatLoaders';
import { loadNii } from './loaders';
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

/**
 * Pull a full series via WADO-RS and stack it exactly like local DICOM
 * (io/dicom-stack.ts): ordered by position, spaced by position, placed in
 * the patient. A series that holds more than one stack (a localizer riding
 * along) opens its largest.
 */
export async function pullSeriesVolume(
  client: DicomWebClient, studyUID: string, seriesUID: string, signal?: AbortSignal,
  key?: string,
): Promise<Volume> {
  const instances = await client.searchInstances(studyUID, seriesUID);
  if (instances.length === 0) throw new Error('series has no instances');
  const order = instances
    .slice()
    .sort((a, b) => (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0))
    .map((i) => i.instanceUID);
  const bufs = await client.retrieveInstances(studyUID, seriesUID, order);
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const parts: ParsedDicomSlice[] = [];
  for (const b of bufs) {
    // A multipart/related body part is a view into the whole response:
    // `b.buffer` would hand the parser every boundary and header too, so
    // copy out exactly this instance's bytes.
    const own = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    for (const p of parseDicomFrames(own)) parts.push(p);
  }
  const stack = groupDicomStacks(parts)[0];
  if (!stack) throw new Error('series has no decodable images');
  if (key) session.seriesMeta.set(key, { meta: stack.meta, warnings: stack.warnings.map((w) => w.message) });
  return volumeFromStack(stack);
}

/** Resolve any catalog key to a volume: cache, local files, or PACS pull. */
export async function resolveVolume(key: string, signal?: AbortSignal): Promise<Volume> {
  const cached = session.getVol(key);
  if (cached) return cached;
  const spec = SERIES[key];
  if (!spec) throw new Error(`unknown series: ${key}`);
  let vol: Volume;
  if (spec.remote) {
    vol = await pullSeriesVolume(pacsClient(spec.remote.endpoint), spec.remote.studyUID, spec.remote.seriesUID, signal, key);
  } else if (spec.dicom?.length) {
    vol = (await loadDicomSeries(spec.dicom, { signal, pick: spec.stackIndex })).vol;
  } else if (spec.img?.length) {
    vol = await loadNii(spec.img[0]!, { signal });
  } else {
    throw new Error('empty series — upload or pull it first');
  }
  session.cacheVol(key, vol);
  return vol;
}
