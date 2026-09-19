# Digest Group 15 — view receipts (VR, slab, layout, hanging, cine, report)

## Volume rendering (`render-cpu/vr.ts` + `tf.ts`, 8 + 3 + 7 tests)
- Front-to-back CPU raymarch with early termination; AABB phase-locked bounds
  cut render 8.9s → 0.1s. Transfer-function presets (bone/soft/lung/brain/xray)
  validated + sampled exactly; monotonic-density property test (denser never
  renders darker); bounded render bit-matches unbounded.
- Oracle tests pin slab/VR against an independent implementation on 72 random
  volumes; thickness-1 equals the slice; trilinear exact on linear fields.

## Thick slab + oblique (`slab.ts`, `oblique.ts`, 8 tests)
- MIP/MinIP/mean projection over 2–64 slices; oblique reslice via trilinear
  basis with zero-angle bit-match to the orthogonal slice. Paint gated to
  orthogonal Slice mode (oblique/MIP edits refuse with a toast).

## Layout + crosshair sync (`render-cpu/layout.ts`, 4 tests)
- Pure geometry behind the dock switch: per-plane slice counts, clamped
  indices, voxel→slice mapping (axial→z, coronal→y, sagittal→x), visible panes
  for 3-up vs single-plane. Select-click on any plane jumps the other two
  (Sync toggle); geometry unit-tested, chrome thin by design.

## Hanging protocols (`study/hanging.ts`, 3 tests)
- First-match rules over modality + body-part text: ct-lung (axial/lung),
  ct-bone, ct-angio (coronal MIP), ct/mr defaults, mr-brain. Unknown input
  falls back without throwing. Catalog series carry modality/body-part, so
  every open auto-hangs (status names the protocol); the dock selector is a
  manual override that stays in sync via `ui.hang`.

## 4D cine (`io` nt/readFrame + `measure/frameDiff`, 3 + 1 tests)
- `readHeader` reports `nt` (dim[4], default 1); bounds-checked `readFrame`
  tiles the file exactly (cardiac 240×256×10×30 proven: last frame differs
  from first — motion captured). `cardiac-4d-cine` keeps raw bytes in session
  (skips the vol cache), Frame slider swaps decoded frames, Δ-vs-baseline
  readout (mean + changed fraction) verified live in Chromium.

## STL import (`render-cpu/stl.ts`, 4 tests)
- Binary (size-match sniff) + ASCII readers → soup TriMesh with computed flat
  normals; named `StlError` on garbage/truncation; `fitMeshToBox` normalizes
  imports into the open series viewBox. Upload pins the mesh across repaints
  until src/threshold/method/series change.

## Validator + report (`study/report.ts`, 3 tests; `#/report` route)
- Structural validation (dims/spacing/length/NaN-scan/anisotropy warn) plus a
  standalone printable HTML builder with full escaping (malicious labels
  asserted harmless). ReportView lists live issues + mask stats + measurements
  with a download button; reachable from the top bar.

## Deliberately out
- GPU raycasting, rotating MIP, WASM marching-cubes, protein/cell viewer tabs,
  OME tile display (chunks read, no viewer), real-PACS conformance.
