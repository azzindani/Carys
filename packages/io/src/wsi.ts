// Whole-slide VL + encapsulated documents (PS3.3 C.8.12.4 / C.8.12.7 +
// PS3.3 A.45 / A.59): SOP gates + tile-grid summary + document summary +
// teaching annotations (C2: display-only region/stain overlays).
// Pure: tables/bytes in, tables out. Digest: OHIF's sopClassDictionary
// (VL + encapsulated UIDs) and the SlideToolkit tile-grid idea (total
// matrix + origin + per-frame offsets locating tiles); the viewer/HTTP
// layers cut, the CPU math kept. Implicit-VR stays absent (dcm-read is
// explicit-only) — summaries read tag-level fields only, never pixels.

export const VL_MICROSCOPIC_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.77.1.2';
export const VL_SLIDE_COORD_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.77.1.3';
export const ENCAPSULATED_PDF_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.104.1';
export const ENCAPSULATED_CDA_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.104.2';

export function isVlSopClass(uid: string | null): boolean {
  return uid === VL_MICROSCOPIC_SOP_CLASS || uid === VL_SLIDE_COORD_SOP_CLASS;
}

export function isEncapsulatedSopClass(uid: string | null): boolean {
  return uid === ENCAPSULATED_PDF_SOP_CLASS || uid === ENCAPSULATED_CDA_SOP_CLASS;
}

/** Tile grid of a VL whole-slide file (all fields null when absent). */
export interface VlGrid {
  totalCols: number | null;
  totalRows: number | null;
  originX: number | null;
  originY: number | null;
  /** per-frame [row, col] offsets into the total matrix (may be empty). */
  tileOffsets: [number, number][];
  focusPlanes: number | null;
  opticalPaths: number | null;
}

/** Encapsulated document summary (bytes stay unread — metadata only). */
export interface EncapsulatedDoc {
  title: string | null;
  mimeType: string | null;
  byteLength: number;
}

const positive = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v) && v >= 0;

interface VlDs {
  number: (t: string) => number | null;
  numbers: (t: string) => number[];
  sequence: (t: string) => VlDs[];
}

/**
 * Read the tile grid from a VL dataset. Missing matrix tags yield nulls
 * (a VL file without a matrix is data, not an error) — only a wrong SOP
 * class throws (`not a VL whole-slide`).
 */
export function parseVlGrid(ds: VlDs & { text: (t: string) => string | null }): VlGrid {
  const sop = ds.text('00080016');
  if (!isVlSopClass(sop)) throw new Error(`not a VL whole-slide: ${sop}`);
  const totalCols = ds.number('00480006');
  const totalRows = ds.number('00480007');
  const origin = ds.sequence('00480008')[0];
  const offsets: [number, number][] = [];
  for (const item of ds.sequence('0048021A')) {
    const row = item.number('0048021E');
    const col = item.number('0048021F');
    if (row != null && col != null) offsets.push([row, col]);
  }
  return {
    totalCols: positive(totalCols) ? totalCols : null,
    totalRows: positive(totalRows) ? totalRows : null,
    originX: origin?.number('0048021E') ?? null,
    originY: origin?.number('0048021F') ?? null,
    tileOffsets: offsets,
    focusPlanes: ds.number('00480013'),
    opticalPaths: ds.sequence('00480105').length > 0
      ? ds.sequence('00480105').length
      : null,
  };
}

/** Grid label: "3×2 tiles · 2048×1536 total" — null when no matrix. */
export function vlGridLabel(grid: VlGrid): string | null {
  if (grid.totalCols == null || grid.totalRows == null) return null;
  const tiles = grid.tileOffsets.length > 0 ? ` · ${grid.tileOffsets.length} located` : '';
  return `${grid.totalCols}×${grid.totalRows} total${tiles}`;
}

interface DocDs {
  text: (t: string) => string | null;
  bytes: (t: string) => Uint8Array | null;
}

/**
 * Summarize an encapsulated document (PDF/CDA): title + MIME + byte
 * length. The bytes are never interpreted (no PDF/CDA parsers in scope)
 * — only a wrong SOP class throws (`not an encapsulated document`).
 */
export function parseEncapsulatedDoc(ds: DocDs & { text: (t: string) => string | null }): EncapsulatedDoc {
  const sop = ds.text('00080016');
  if (!isEncapsulatedSopClass(sop)) throw new Error(`not an encapsulated document: ${sop}`);
  return {
    title: ds.text('00420010'),
    mimeType: ds.text('00420012'),
    byteLength: ds.bytes('00420011')?.length ?? 0,
  };
}

/** Document label: "PDF · 12,408 bytes" — MIME short name + length. */
export function encapsulatedDocLabel(doc: EncapsulatedDoc, sopClassUID: string | null): string {
  const kind = sopClassUID === ENCAPSULATED_PDF_SOP_CLASS ? 'PDF'
    : sopClassUID === ENCAPSULATED_CDA_SOP_CLASS ? 'CDA' : 'document';
  const mime = doc.mimeType ? ` · ${doc.mimeType}` : '';
  return `${kind}${doc.title ? ` · ${doc.title}` : ''} · ${doc.byteLength.toLocaleString()} bytes${mime}`;
}

/**
 * C2 teaching annotation: one display-only overlay region on a VL tile.
 * Coordinates are tile pixels (representative-tile space, never slide
 * microns — the full pyramid stays out, so slide-space claims would be
 * guesses). `stain` names the preparation when known (H&E, IHC, …);
 * empty string = unstained/unknown, never inferred.
 */
export interface WsiAnnotation {
  /** Stable key, e.g. 'crypts'. */
  id: string;
  /** Region display name, e.g. 'Colonic crypts'. */
  region: string;
  /** Stain label, e.g. 'H&E'; '' = unknown. */
  stain: string;
  /** Tile-pixel rect, inclusive [x0,y0,x1,y1]. */
  rect: [number, number, number, number];
  /** One teaching sentence about the region. */
  note: string;
}

/** Fail-loud annotation check: bad rects/labels throw, never half-render. */
export function validateWsiAnnotation(raw: unknown): WsiAnnotation {
  const bad = (why: string): Error => new Error(`bad-wsi-annotation: ${why}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('top level must be an object');
  const r = raw as Record<string, unknown>;
  for (const k of ['id', 'region', 'note'] as const) {
    if (!r[k] || typeof r[k] !== 'string') throw bad(`${k} must be a non-empty string`);
  }
  if (typeof r.stain !== 'string') throw bad('stain must be a string (possibly empty)');
  const rect = r.rect as unknown;
  if (!Array.isArray(rect) || rect.length !== 4 || rect.some((v) => !Number.isInteger(v) || (v as number) < 0)) {
    throw bad('rect must be 4 non-negative ints [x0,y0,x1,y1]');
  }
  const [x0, y0, x1, y1] = rect as [number, number, number, number];
  if (x1 < x0 || y1 < y0) throw bad(`rect inverted: [${x0},${y0},${x1},${y1}]`);
  return { id: r.id as string, region: r.region as string, stain: r.stain as string, rect: [x0, y0, x1, y1], note: r.note as string };
}

/** Validate a list (empty allowed — a tile with no annotations is data). */
export function validateWsiAnnotations(raw: unknown): WsiAnnotation[] {
  if (!Array.isArray(raw)) throw new Error('bad-wsi-annotation: list must be an array');
  const ids = new Set<string>();
  for (const a of raw) {
    const v = validateWsiAnnotation(a);
    if (ids.has(v.id)) throw new Error(`bad-wsi-annotation: duplicate id ${JSON.stringify(v.id)}`);
    ids.add(v.id);
  }
  return raw as WsiAnnotation[];
}

/**
 * Clip an annotation rect to tile bounds (cols×rows). Returns null when
 * the rect misses the tile entirely — the overlay skips it loudly via
 * the caller's skipped count, never draws a sliver silently.
 */
export function clipWsiRect(
  rect: [number, number, number, number], cols: number, rows: number,
): [number, number, number, number] | null {
  const [x0, y0, x1, y1] = rect;
  const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0);
  const cx1 = Math.min(cols - 1, x1), cy1 = Math.min(rows - 1, y1);
  if (cx1 < cx0 || cy1 < cy0) return null;
  return [cx0, cy0, cx1, cy1];
}

/** Annotation label: "Colonic crypts · H&E" (stain omitted when unknown). */
export function wsiAnnotationLabel(a: WsiAnnotation): string {
  return a.stain ? `${a.region} · ${a.stain}` : a.region;
}
