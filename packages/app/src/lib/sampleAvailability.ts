// Which catalog entries this deployment can open. samples/ is never
// committed (samples/.gitkeep), so a fresh clone has none of the files; the
// phantom generators write stand-ins for some entries and the rest need real
// data. The worklist probes each entry's first file once and says which is
// which, instead of listing studies that fail only when opened.
import type { SeriesSpec } from './types';

/** The file an entry's availability is judged by, or null for entries with
 *  no file on this server (uploads live in memory, PACS pulls on demand). */
export function probeFile(spec: SeriesSpec): string | null {
  if (spec.source === 'upload' || spec.remote) return null;
  return spec.img?.[0] ?? spec.dicom?.[0] ?? null;
}

/** HEAD every entry's probe file: true when it is served. A server that
 *  answers a missing file with its HTML page counts as missing. */
export async function probeSamples(
  series: Record<string, SeriesSpec>, signal?: AbortSignal,
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  await Promise.all(Object.entries(series).map(async ([key, spec]) => {
    const file = probeFile(spec);
    if (!file) { out.set(key, true); return; }
    try {
      const res = await fetch(file, { method: 'HEAD', signal });
      out.set(key, res.ok && !(res.headers.get('content-type') ?? '').startsWith('text/html'));
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      out.set(key, false);
    }
  }));
  return out;
}

/** What fills a missing entry: its generator, or real data. */
export function missingHint(spec: SeriesSpec): { label: string; title: string } {
  return spec.gen
    ? { label: `npm run ${spec.gen}`, title: `Not in samples/ yet: npm run ${spec.gen} writes a synthetic stand-in (no patient data)` }
    : { label: 'needs real data', title: 'Not in samples/, and no generator writes it: samples/.gitkeep says where the public data comes from' };
}
