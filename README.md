# Carys — single CPU-only spatial viewer (prototype)

**Location:** this repository — nothing outside it.
**Rule for this prototype:** no Docker, no GPU, no backend. Static TypeScript + Web Workers + WASM. Preview via Cloudflare quick tunnel from this sandbox.

## Vision

One tool, one selection model, many loaders:

```
DICOM / NIfTI / OME-Zarr / PDB/mmCIF / FASTA / VCF  →  core volume/atom/cell model  →  CPU render  →  Canvas2D
```

Multimodal = features, not apps:
- voxel ↔ residue ↔ cell share one annotation model (mask + label + measurement)
- same brush, same undo, same export (NIfTI / STL / CSV / PNG / HTML report)
- sequence ↔ 3D highlight, channel ↔ cell table, baseline ↔ follow-up diff

## Why CPU-only

- Sandbox here has 4 vCPU, 15 GiB RAM, no GPU — so the prototype must run there.
- Clinical / field / classroom machines are the same: weak GPU, strong need.
- Proven: Papaya (pure JS orthogonal viewer), ITK-WASM (SIMD + thread pool, still CPU), tiled OME-Zarr slicing.

## Packages (monorepo under `packages/`)

```
packages/
  io/          DICOM series sort, NIfTI, OME-Zarr chunks, PDB/mmCIF, FASTA/VCF parsers
  volume-core/ dims/spacing/origin/dtype, spatial index, selection model
  render-cpu/  MPR reslice, MIP/minIP, software raycast, marching-cubes (WASM), tile slicer
  editor-seg/  threshold, region-grow, watershed, connected-components, brush + undo
  measure/     length, angle, volume, histogram, profile line
  testkit/     test-only: locates samples/ fixtures, decides skip vs fail
  ui/          4-pane layout, tracks, toolbar, report export (static only)
```

## Repos to digest (in order)

1. `rii-mango/Papaya + Daikon + NIFTI-Reader-JS` — CPU volume model to copy
2. `niivue/niivue + CACTAS` — NIfTI/mesh/overlay handling, drawing extension
3. `cornerstonejs/cornerstone3D + @itk-wasm/dicom` — `readImageDicomFileSeries`, tools
4. `Kitware/VolView` — architecture only (skip its GPU path)
5. `hms-dbmi/viv + vizarr` — OME-Zarr loader (replace deck.gl layer with CPU slicer)
6. `google/neuroglancer` — 4-pane linked navigation pattern
7. `molstar/molstar + pdbe-molstar + rcsb-molstar` — sequence→3D selection, superposition
8. `nglviewer/ngl` — simpler fallback reference for small proteins
9. `igvteam/igv.js + jbrowse-components + gosling.js` — genome tracks (Phase 2)

See `docs/` for architecture, CPU rendering recipe, phases, and tunnel preview.

## Run (dev)

```bash
npm run ci       # what CI runs: build + typecheck + lint + unit + markers + app build
npm run verify   # the full gate: adds e2e and REQUIRES samples/ (see below)
npm run lint     # eslint, type-aware; --max-warnings 0
npm run audit:a11y # axe-core WCAG 2.1 A/AA over every route, both breakpoints
npm run test:unit  # unit suites; fixture-backed ones skip without samples/
npm run serve    # static root on :8000
# open http://localhost:8000/packages/ui/  (shell)
```

### Fixtures and what runs without them

`samples/` is ~343MB of vendored imaging, mounted rather than committed
(`samples/.gitkeep`). A clean clone has none, so:

- **`npm run ci` / `npm run test:unit`** — suites that need a fixture **skip**,
  and the run prints the skip count. Green here means green, not "nothing ran":
  a skip is reported as a skip, never as a pass.
- **`npm run verify`** — sets `CARYS_REQUIRE_SAMPLES=1`, which turns a missing
  fixture into a **failure**. Use it before a release, with samples mounted; a
  half-populated `samples/` fails loudly instead of quietly thinning coverage.

`@carys/testkit` is the one place that decides which of the two you get.

## Run (production Docker)

```bash
docker build -t carys:latest .
docker run --rm -p 8080:80 \
  -v /path/to/samples:/usr/share/nginx/html/samples:ro \
  carys:latest
# open http://localhost:8080/packages/ui/
```

Multi-stage image (pinned `node:20` build, `nginx:1.27` serve, non-root
`nginx` user, healthcheck). Samples are never baked in — mount read-only.
No GPU, no backend, no secrets in the image.

The build layer runs `tsc -b`, lint, the unit suites, `typecheck:app` and the
app build, all without `samples/` (`.dockerignore` drops it). CI builds the
image on every push so that layer cannot rot.

## Privacy note

Default dev model here (`muse-spark-1.3-contributor`) trains on prompts. Prototype with mock / public data (e.g. OpenNeuro, PDB 4HHB, OME-NGFF samples). No patient data, rotate any keys after.
