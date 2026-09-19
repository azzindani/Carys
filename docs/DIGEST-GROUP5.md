# Digest Group 5 — Viv + Vizarr full-clone protocol receipt

## Viv (hms-dbmi/viv) — TS strict + JS + GLSL, pnpm monorepo
- packages/loaders (TS), layers/views/viewers (JS/JSX + deck.gl 9.3), zod
  OME-XML, geotiff + zarrita, MAX_CHANNELS=10.
- PORTED (loader shape + cache; deck.gl replaced with CPU slicer):
  - PixelSource/PixelData/Selection/Labels/dtype → `volume-core/viv.ts`.
  - getChannelStats (0.05%/99.95%) + padContrastLimits + GLSL channel math
    on CPU (compositeChannelsViv) + DTYPE_VALUES + hexToRGB/defaults +
    guessTileSize/isInterleaved/resolveScale/fitImage → `viv.ts`.
  - RootAttrs/OMERO windows → `io/ome-meta.ts` parseOmeroMeta.
- SKIPPED: XRLayer/volume-layer/bitmap-layer WebGL, TileLayer orchestration,
  extensions shaders, views/viewers JSX, 3D, lens, DEPRECATED bioformats,
  Pool/worker perf path, companion multifile, sites/apps/tests.

## Vizarr (hms-dbmi/vizarr) — TS/React 18 + deck.gl 9.1, ~3,953 core lines
- jotai state, zarrita + cogeotiff, quick-lru, mathe.gl, vite/vitest.
- PORTED (NGFF/store plumbing Viv lacks):
  - classifySource routing + resolveAttrs v0.5 unwrap + getNgffAxes →
    `io/ome-classify.ts`.
  - parseOmeroMeta/defaultMeta, hexToRGB/defaults, loadMultiscales open,
    ZarrPixelSource selection build, calcDataRange/contrast, tile-size,
    fitImageToViewport (2D) → covered in `viv.ts` + `ome-meta.ts`.
- SKIPPED: Viv layer subclasses, GridLayer picking, LabelLayer GLSL,
  ome-tiff-store (520+ lines), ref:// branch, jpeg2k CDN, plate drill-down,
  anywidget bridge, Menu/LayerController UI, modelMatrix 3D.
