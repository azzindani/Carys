# Digest Group 2 — full-clone protocol receipt

## NiiVue (niivue/niivue) — TypeScript ES2020, 311 src files / ~73,665 LOC
- Monorepo npm workspaces packages/*. Test images/meshes dominate file count
  (539 png, 139 html, 116 gz, 112 json). Core lib packages/niivue/src 3.2MB.
- PORTED (CPU-only, zero GL):
  - Volume dispatcher: NVImage.new branch table + ImageType ext map +
    ParsedVolumeData → `volume-core/nvimage.ts` (NiiVolume, ImageType,
    parseImageType) + `io/formats.ts` (loaderHint, isMeshFile).
  - Mesh model: NVMesh CPU fields + nvmesh-types.ts + NVMeshLayer +
    offsetPt0 surface-vs-fiber rule → `volume-core/mesh.ts`.
  - Drawing (biggest steal): rle.ts PackBits, undo.ts ring, PenTool
    Bresenham + drawPoint, FloodFillTool BFS 6/18/26 + intensity bounds,
    ShapeTool rect/ellipse, masks.ts interpolation, DrawingManager,
    facade signatures → `editor-seg/drawing.ts`.
  - Scene: NVDocument/DocumentData, Scene, NVConfigOptions drawing subset,
    SLICE_TYPE/PEN_TYPE → `volume-core/document.ts`.
- SKIPPED: shader-srcs.ts (2,489 lines GLSL), GL bootstrap, all renderers
  (Volume/Slice/Mesh/Scene/UIElement), 12,516-line Niivue God-class body,
  interaction/navigation, Zarr streaming (staged), desktop/uikit/docs/demos.

## CACTAS (mpsych/CACTAS) — JavaScript + Python, ~4,566 hand lines
- JS annotator UI (846) + Python UNet/RF experiments (~3,309) + 86 notebooks.
  No TypeScript in repo.
- PORTED:
  - Brush stroke: pointwise paint + one-undo-per-stroke + stroke array →
    drawPt; gap fix via NiiVue drawPenLine Bresenham (CACTAS leaves dotted
    gaps on fast drags).
  - Flood fill: builtin two-pass BFS (0.3–1.5ms) — never _grow() O(n²)
    (66–259ms, 100x slower). Symmetric [seed-tol, seed+tol] window
    (CACTAS asymmetric window treated as bug).
  - Undo: RLE ring, push on stroke-end/fill, cap depth, clear on new volume.
  - Mask ops: binarize, PROPER 3D connected-components (CACTAS cv call on
    flat volume is dimensionally wrong), Jaccard (compare.py/util.py).
  - Neighbor table di/dj/dk 6-neigh.
- SKIPPED: vendored niivue.umd.js/opencCV.js/nouislider (APIs only),
  Pusher collab, WL slider DOM, view modes, all _EXPERIMENTS training
  (unet.py, generator 1,410 lines, LOOCV, metrics, 86 notebooks), yml envs,
  hdf5 weights, dead/broken TODOs (merge, kidneys colormap, flat CC).
