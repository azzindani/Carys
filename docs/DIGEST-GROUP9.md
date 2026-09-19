# Digest Group 9 — genome trio full-clone protocol receipt (Phase 2 staged)

## igv.js (igvteam/igv.js) — JS ESM, 274 files / ~61,900 lines
- Browser god-object + track views + reference frames + parsers + adapters.
- PORTED (logic only, no Canvas/DOM):
  - TrackBase config + factory map + registerTrackClass + create/load/add
    → `volume-core/tracks.ts` (TrackConfig, registry, preprocess).
  - parseLocusString + Locus + ReferenceFrame math → `volume-core/locus.ts`.
  - GFF3/GTF + BED + lineReader + inferFileFormat(ext) → `io/genome.ts`
    (FASTA/VCF already in seq.ts).
  - igv.d.ts as TrackConfig interface seed.
- SKIPPED: all Canvas/SVG/DOM, BAM/CRAM/bigWig/TDF/HDF5, htsget/services,
  specialty tracks, sessions/ROI, HGVS, vendor/demos/css, test harness
  (vectors useful as fixtures).

## Gosling.js (gosling-lang/gosling.js) — TS, ~25,868 src lines
- Grammar + compiler + Pixi marks + fetchers + React editor.
- PORTED (shape only, Canvas2D later):
  - SingleTrack core + Channel shorthand + Json/Csv data →
    `volume-core/gosling.ts` (GoslingSpec/Track/Channel/Data).
  - Transforms filter/log/concat → applyTransforms.
- SKIPPED: HiGlass, tiles/server fetchers, circular/polar, linking/brush,
  overlays/templates, responsive, themes/editor, embellishments.

## jbrowse-components (GMOD) — TS/React monorepo, 9,596 files
- Survey only (too large for full read): core Plugin/PluginManager +
  Track/Display/View/Adapter types + session mixins noted.
- PORTED: TypeRecord registry + Plugin install + TrackType/DisplayType
  shapes → `volume-core/tracks.ts` PluginRegistry.
- SKIPPED: everything else (RPC, shaders, adapters, views, session, products).
