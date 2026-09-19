// C1 IDR catalog: pinned IDR OME-Zarr screens as first-class demo
// content. Hand-authored from the IDR JSON API + the EBI S3 bucket listing
// (not invented): each entry names the IDR study, the store URL, and what
// the viewer can and cannot do with it given the CPU-only codec rule.
//
// Ledger row: idr-catalog, CC0-1.0 (bucket metadata) + per-study terms,
// mode digest, lane C1, status shipped. Store *pixels* stay remote (no
// vendoring: idr0048A alone is tens of MB per chunk-set); what ships is
// the pinned catalog + the open path. Prototype scope: teaching pixels,
// never diagnosis.
//
// Codec reality (verified 2026-09-17 against live .zarray docs):
// every IDR v0.4/v0.1 store probed uses blosc/lz4 chunks, which the CPU
// reader rejects by name (P0 toolchain lane owns that). The catalog says
// so per entry — the UI offers the store, the open path fails loud with
// the decoder's own named error, and the SOURCES sidecar records why.

/** One pinned IDR screen entry. */
export interface IdrCatalogEntry {
  /** Short key used by the UI + wire leg (e.g. 'idr0048A'). */
  id: string;
  /** IDR study/project name, e.g. 'idr0048A'. */
  study: string;
  /** Human title for the picker (from IDR project metadata). */
  title: string;
  /** Store base URL (the viewer opens `${url}/0` style roots via openUrl). */
  storeUrl: string;
  /** Chunk codec measured from the live .zarray doc. */
  codec: string;
  /** True when the CPU reader can decode it today (none/gzip/zlib only). */
  decodable: boolean;
  /** Ontology-flavored annotation note (teaching context, not a claim). */
  annotation: string;
}

export const IDR_CATALOG: IdrCatalogEntry[] = [
  {
    id: 'idr0048A',
    study: 'idr0048A',
    title: 'idr0048A · multichannel fluorescence (t/c/z/y/x pyramid)',
    storeUrl: 'https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0048A/9846151.zarr/0',
    codec: 'blosc/lz4',
    decodable: false,
    annotation: '3-channel fluorescence timepoint; channel roles from IDR metadata',
  },
  {
    id: 'idr0083-organoids',
    study: 'idr0083-lamers-sarscov2',
    title: 'idr0083 · SARS-CoV-2 infected intestinal organoids (hSIOs-2, single-channel EM-scale tile)',
    storeUrl: 'https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0083A/9822152.zarr',
    codec: 'blosc/lz4',
    decodable: false,
    annotation: 'Host-cell context for the M1 spike entries: 144384×93184 single channel at ~1nm/px; image 9822152 probed 2026-09-17 (sibling field 9822151 has no v0.4 mirror). Pairs with DISEASE_BUNDLES ace2-entry/antibody-block (M2).',
  },
  {
    id: 'idr0013A',
    study: 'idr0013A',
    title: 'idr0013A · screening plate well (t/y/x, HCS layout)',
    storeUrl: 'https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0013A/3451.zarr',
    codec: 'blosc/lz4',
    decodable: false,
    annotation: 'High-content screening plate; wells resolve through the plate path',
  },
  {
    id: 'idr0001HeLa',
    study: 'idr0001A (v0.1 mirror)',
    title: 'idr0001A · HeLa screen field (v0.1 store)',
    storeUrl: 'https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.1/179706.zarr',
    codec: 'blosc/lz4',
    decodable: false,
    annotation: 'HeLa morphology screen field (plate1_1_013, well 92)',
  },
];

/** Digest pin recorded when an IDR entry opens (catalog version, not pixels). */
export const IDR_DIGEST_ID = 'idr-catalog';
export const IDR_DIGEST_PIN = 'IDR-API-2026-09-17-v0.4+0083';

/** Look up a catalog entry by UI id. Null on unknown (caller stays loud). */
export function idrById(id: string): IdrCatalogEntry | null {
  return IDR_CATALOG.find((e) => e.id === id) ?? null;
}
