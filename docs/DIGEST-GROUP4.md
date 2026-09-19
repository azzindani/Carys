# Digest Group 4 — VolView full-clone protocol receipt

## VolView (Kitware/VolView) — TS + Vue 3 + Pinia, 596 src files / ~70,666 LOC
- Vite + Vuetify + vtk.js + itk-wasm + comlink + gl-matrix + polybool.
- PORTED (layering, NOT the VTK GPU path):
  - Provenance DataSource union + sourceIdentity + mergeCollections →
    `volume-core/datasource.ts` (layer.ts now imports it).
  - ProgressiveVolume interface + sole-owner ImageCache + onDelete fan-out →
    `volume-core/progressive.ts` (payload Volume, not vtkImageData).
  - indexToWorld/worldToIndex/sameSpace → `volume-core/imagespace.ts`.
  - Annotation factory (base + ruler/rect/polygon, store, rulerLength,
    removeForImage) → `volume-core/annotations.ts`.
  - Import chain (SKIP sentinel, runImportChain) → `io/import.ts`.
  - fillHoles verbatim (border flood, majority vote, locked) →
    `editor-seg/fillholes.ts`.
  - SegmentGroup conventions (Uint8, 0=bg, order/byValue, replaceLabelValue,
    createLabelmapFromVolume, toLabelMap) → `editor-seg/segments.ts`.
  - Noted for UI phase (no code yet): middle-slice canvas thumbnails,
    view<->data split, per-view slice/window configs, base-image/layer/seg
    heuristics, state-file serialize pattern, tables need NEW store
    (VolView has none — DICOM lists only).
- SKIPPED: volume-thumbnailer (offscreen vtkGenericRenderWindow), all
  components/vtk widgets, mappers/effects, custom resample/dicom WASM,
  cine worker pool, chunk state machine, processing engine, server/
  backend-contract/DICOMweb, state-file segment restore.
