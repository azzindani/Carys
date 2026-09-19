# Digest Group 3 — full-clone protocol receipt

## Cornerstone3D (cornerstonejs/cornerstone3D) — TypeScript, 3,486 files
- pnpm + lerna monorepo: core, tools, dicomImageLoader, nifti-volume-loader,
  adapters, metadata, polymorphic-segmentation, labelmap-interpolation, ai.
- PORTED (interfaces + pure math, zero VTK/GPU):
  - Tool API: addTool registry, ToolGroup (addTool/setToolActive/Passive/
    Enabled/Disabled), MouseBindings/KeyboardBindings, ToolModes →
    `volume-core/tools.ts` (extended with modes, viewports, registry).
  - Worker contract: registerWorker + executeTask + transferList →
    `volume-core/worker.ts` WorkerManager.
  - Series sort: scanNormal = row×col, dist = dot(refIPP-ipp, normal),
    zSpacing fallback chain → `io/dicom-series.ts` sortSlicesByPosition +
    zSpacing.
  - Image/volume model: imageId scheme, slope/intercept/WW/WC, scalarData
    layout → stackVolumes + DicomSeriesOptions/Result.
  - Decode subset: transfer-syntax route, little-endian/RLE, sign-shift +
    min/max + modality scale (Daikon already covers pixel math).
  - VOI: toLowHighRange + preset names as ww/wc → `lut.ts` voiRange,
    windowLevelFromRange, CT_SoftTissue/Lung/AAA + MR_T2Brain presets.
  - State shapes noted for UI phase: annotation FORUID->toolName,
    segmentation id->labelmap+segments.
- SKIPPED: all RenderingEngine/viewports (VTK), drawingSvg, event
  dispatchers, streaming loaders, WASM codecs (JPEG-LS/2000/HTJ2K),
  docs/ai/codemods, e2e.

## ITK-Wasm (InsightSoftwareConsortium/ITK-Wasm) — C++20 + TS + Python, 5,909
- pnpm monorepo + pixi native + CMake/Docker toolchains; per-pipeline
  generated TS/Python bindings from --interface-json.
- PORTED (no C++/Wasm builds):
  - interface-types verbatim shapes → `volume-core/itk.ts` (ItkImage,
    ItkImageType, BinaryFile, PixelType, ComponentType, Pipeline I/O).
  - readImageDicomFileSeries contract: {inputImages, singleSortedSeries}
    -> chunk 8 -> runTasks -> stackImages -> {outputImage, sortedFilenames}
    → `io/dicom-series.ts` readDicomSeries.
  - WorkerPool (poolSize, runTasks->{promise,runId}, cancel) →
    `volume-core/worker.ts` WorkerPool + defaultPoolSize
    (hardwareConcurrency/2).
  - Pipeline args convention (--memory-io, positional 0/1) noted in itk.ts.
  - stack-images slab stitch → stackVolumes.
- SKIPPED: Docker/Emscripten/WASI toolchains, C++ pipelines, GDCM/DCMTK,
  Python runtime, .wasm binaries, demos, codegen CLI.
