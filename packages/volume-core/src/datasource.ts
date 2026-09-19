// Ported from VolView io/import/dataSource.ts + store/datasets.ts (TS, Apache-2).
// Provenance-first union: every import keeps its byte-provenance chain.
// CPU-only: no vtkImageData; payload is Volume. Skip: remote/archive/state.

export type DataSourceKind =
  | 'file' | 'uri' | 'archive' | 'chunk' | 'collection'
  | 'dicom-series' | 'nifti' | 'ome-zarr' | 'pdb' | 'seq-track';

export interface DataSource {
  kind: DataSourceKind;
  ref: string;
  label: string;
  parent?: DataSource;
}

/** Identity for idempotent re-import (VolView sourceIdentity). */
export function sourceIdentity(s: DataSource, extra?: string): string {
  return `${s.kind}:${s.ref}${s.parent ? '<' + sourceIdentity(s.parent) : ''}${extra ?? ''}`;
}

/** Merge collection sources with same identity (VolView mergeCollectionSources). */
export function mergeCollections(lists: DataSource[][]): DataSource[] {
  const seen = new Set<string>();
  const out: DataSource[] = [];
  for (const l of lists.flat()) {
    const id = sourceIdentity(l);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(l);
    }
  }
  return out;
}
