# Digest Group 6 — Neuroglancer full-clone protocol receipt

## Neuroglancer (google/neuroglancer) — TypeScript, 631 src files / ~156k LOC
- src/datasource + sliceview + chunk_manager + ui + layer + mesh/skeleton +
  webgl + kvstore + python integration.
- PORTED:
  - navigation_state (Position/Orientation/DisplayPose/NavigationState,
    makeLinked) + AXES_RELATIVE_ORIENTATION + FourPanelLayout +
    makeNavigationState/movePosition → `volume-core/navigation.ts`.
  - chunk_manager base/frontend (ChunkState, VISIBLE/PREFETCH/RECENT,
    CapacitySpec, tier-ordered queue) → `volume-core/chunks.ts`
    (backend worker/RPC collapsed to in-process LRU).
  - datasource registry (Provider/scheme dispatch, default + local) →
    `io/providers.ts` (precomputed/n5/zarr/nifti/file/http/https).
  - Coordinate spaces/scales/bounds noted (imagespace.ts already covers).
- SKIPPED: webgl/**, sliceview shaders/panels, perspective/volume rendering,
  rendered_data_panel, layer renderlayers, mesh/skeleton/annotation impl,
  worker_rpc + chunk_worker bundles, credentials/cloud kvstores, UI chrome,
  python/, tests/testdata.
