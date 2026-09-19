# Digest Group 18 — vizarr pyramid levels (third new-repo digest)

## vizarr (hms-dbmi/vizarr, on disk from an earlier clone round)
- Surveyed `src/utils.ts loadMultiscales` + `ZarrPixelSource.ts`: the operative
  pattern is opening EVERY `datasets[]` entry (`Promise.all` over paths, one
  array per pyramid level) and selecting per-tile by zoom. Our store read
  `datasets[0]` only and rejected any scale > 0. Skipped: deck.gl layers,
  OME-TIFF branch, plate/well loading, zarrita itself.

## Ported: multi-level `OmeZarrStore`
- `parseMultiscales` returns all dataset paths (first kept as `arrayPath`
  for compatibility); `open()` fetches every level's `.zarray`; the store
  holds `levels[]` with per-level meta/compressor; `meta`/`arrayPath`/
  `compressor` getters preserve the level-0 API untouched.
- `getTile` renders at `r.s`; chunk cache keys are level-prefixed (same
  coords on two levels shared one key before — wrong data, now isolated);
  out-of-range levels and chunk fetches throw the existing named errors.
- Proven: synthetic 2-level store (4×4 L0, floor-mean 2×2 L1) — per-level
  tiles byte-exact, same-coords chunks decode independently with one fetch
  each, s=2 rejected. All pre-existing single-level tests pass unmodified.
- Cells tab: level selector (L0/L1 with dims) appears for multi-level
  stores; canvas repaints at the level's shape. Browser-verified: L1 shows
  32×32 with 10 chunks cached (8 L0 + 2 L1).

## Deliberately out
- Zoom-driven automatic level picking (manual selector; `resolveScale`
  exists in volume-core for it), blosc/zstd chunks (named rejection stands),
  OME-TIFF, plates/wells, real store URL (demo store is synthetic, labeled).
