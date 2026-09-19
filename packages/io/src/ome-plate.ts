// NGFF plate/well navigation (OME-NGFF 0.4 §plate): a plate root's .zattrs
// lists rows/columns/wells, each well lists its fields (images). Pure
// metadata — chunk fetching stays in omezarr.ts; the viewer resolves
// plate -> well -> image URLs with these. v0.5 {ome:} envelopes unwrapped.
// Absent keys give null (not a plate/well); present-but-malformed throws
// OmePlateError.
import { resolveAttrs } from './ome-classify.js';

export class OmePlateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmePlateError';
  }
}

export interface PlateWellRef {
  path: string;
  rowIndex: number;
  columnIndex: number;
}

export interface PlateMeta {
  name?: string;
  rows: string[];
  columns: string[];
  wells: PlateWellRef[];
}

export interface WellMeta {
  images: string[];
}

function strArray(v: unknown, what: string): string[] {
  if (!Array.isArray(v)) throw new OmePlateError(`${what} must be an array`);
  return v.map((e) => {
    const n = (e as { name?: unknown })?.name;
    if (typeof n !== 'string') throw new OmePlateError(`${what} entries need string names`);
    return n;
  });
}

/** Parse plate .zattrs (null when no plate key). */
export function parsePlateAttrs(attrs: unknown): PlateMeta | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const a = resolveAttrs(attrs as Record<string, unknown>);
  const p = (a as { plate?: unknown }).plate;
  if (p === undefined) return null;
  if (!p || typeof p !== 'object') throw new OmePlateError('plate must be an object');
  const rec = p as Record<string, unknown>;
  const rows = strArray(rec['rows'], 'plate.rows');
  const columns = strArray(rec['columns'], 'plate.columns');
  const rawWells = rec['wells'];
  if (!Array.isArray(rawWells)) throw new OmePlateError('plate.wells must be an array');
  const wells: PlateWellRef[] = rawWells.map((w) => {
    const r = w as { path?: unknown; rowIndex?: unknown; columnIndex?: unknown };
    if (typeof r?.path !== 'string') throw new OmePlateError('plate.wells[] needs a string path');
    if (!Number.isInteger(r.rowIndex) || !Number.isInteger(r.columnIndex)) {
      throw new OmePlateError(`well ${r.path} needs integer row/column indices`);
    }
    if ((r.rowIndex as number) < 0 || (r.rowIndex as number) >= rows.length ||
      (r.columnIndex as number) < 0 || (r.columnIndex as number) >= columns.length) {
      throw new OmePlateError(`well ${r.path} indices out of range`);
    }
    return { path: r.path, rowIndex: r.rowIndex as number, columnIndex: r.columnIndex as number };
  });
  const name = (rec['name'] as string | undefined) ?? undefined;
  if (name !== undefined && typeof name !== 'string') throw new OmePlateError('plate.name must be a string');
  return { name, rows, columns, wells };
}

/** Parse well .zattrs (null when no well key). */
export function parseWellAttrs(attrs: unknown): WellMeta | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const a = resolveAttrs(attrs as Record<string, unknown>);
  const w = (a as { well?: unknown }).well;
  if (w === undefined) return null;
  if (!w || typeof w !== 'object') throw new OmePlateError('well must be an object');
  const images = (w as { images?: unknown }).images;
  if (!Array.isArray(images)) throw new OmePlateError('well.images must be an array');
  const paths = images.map((im) => {
    const p = (im as { path?: unknown })?.path;
    if (typeof p !== 'string' || p === '') throw new OmePlateError('well.images[] needs a non-empty path');
    return p;
  });
  if (paths.length === 0) throw new OmePlateError('well.images is empty (nothing to open)');
  return { images: paths };
}

/** Human well label from indices: rows[ri] + columns[ci] (e.g. A + 01). */
export function plateWellLabel(plate: PlateMeta, well: PlateWellRef): string {
  return `${plate.rows[well.rowIndex]}${plate.columns[well.columnIndex]}`;
}

/** Find a well by row/column name or 0-based index. */
export function findWell(
  plate: PlateMeta, row: string | number, column: string | number,
): PlateWellRef | null {
  const ri = typeof row === 'number' ? row : plate.rows.indexOf(row);
  const ci = typeof column === 'number' ? column : plate.columns.indexOf(column);
  if (ri < 0 || ci < 0) return null;
  return plate.wells.find((w) => w.rowIndex === ri && w.columnIndex === ci) ?? null;
}

/** Slash-safe URL join for zarr paths (protocols and leading slashes kept). */
export function joinZarrUrl(base: string, ...parts: string[]): string {
  const b = base.replace(/\/+$/g, '');
  const ps = parts.map((s) => s.replace(/^\/+|\/+$/g, '')).filter((s) => s !== '');
  return [b, ...ps].join('/');
}

/** Full image URL for a well's field (default first). */
export function wellImageUrl(plateBase: string, well: PlateWellRef, meta: WellMeta, index = 0): string {
  const img = meta.images[index];
  if (img === undefined) throw new OmePlateError(`well has no image ${index}`);
  return joinZarrUrl(plateBase, well.path, img);
}
