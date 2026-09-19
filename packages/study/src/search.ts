import type { StudyRecord } from './types.js';

export interface WorklistQuery {
  text: string;
  modalities: Set<string>;
  source: 'all' | 'nifti' | 'dicom' | 'upload';
  hasSeg: boolean | null;
  sort: 'name' | 'voxels' | 'modality';
  dir: 'asc' | 'desc';
}

export const EMPTY_QUERY: WorklistQuery = {
  text: '',
  modalities: new Set(),
  source: 'all',
  hasSeg: null,
  sort: 'name',
  dir: 'asc',
};

function haystack(r: StudyRecord): string {
  return [r.key, r.patientName, r.patientID, r.modality, r.seriesDescription, r.studyUID]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Multi-token AND search over the row haystack. */
export function matchesText(r: StudyRecord, text: string): boolean {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = haystack(r);
  return tokens.every((t) => hay.includes(t));
}

export function filterWorklist(rows: StudyRecord[], q: WorklistQuery): StudyRecord[] {
  const out = rows.filter((r) => {
    if (!matchesText(r, q.text)) return false;
    if (q.modalities.size > 0 && !q.modalities.has(r.modality)) return false;
    if (q.source !== 'all' && r.source !== q.source) return false;
    if (q.hasSeg !== null && r.hasSeg !== q.hasSeg) return false;
    return true;
  });
  const dir = q.dir === 'asc' ? 1 : -1;
  out.sort((a, b) => {
    if (q.sort === 'voxels') return ((a.voxels ?? -1) - (b.voxels ?? -1)) * dir;
    if (q.sort === 'modality') return a.modality.localeCompare(b.modality) * dir || a.key.localeCompare(b.key) * dir;
    return a.key.localeCompare(b.key) * dir;
  });
  return out;
}

/** Facet counts for the filter chips. */
export function modalityFacets(rows: StudyRecord[]): { modality: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.modality, (m.get(r.modality) ?? 0) + 1);
  return [...m.entries()].map(([modality, count]) => ({ modality, count })).sort((a, b) => b.count - a.count);
}
