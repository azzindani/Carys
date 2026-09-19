# Repos to digest — what to steal from each

Digest = read for the interface/pattern, then re-implement against `volume-core`. Do not fork whole apps.

1. **rii-mango/Papaya, Daikon, NIFTI-Reader-JS** — CPU orthogonal viewer; overlay model; pure-JS DICOM/NIfTI parsing. Steal: volume + overlay + LUT.
2. **niivue/niivue, niivue-vscode, CACTAS** — voxel+mesh+tracts in one scene; drawing/segmentation extension. Steal: format coverage + draw tools.
3. **cornerstonejs/cornerstone3D, @itk-wasm/dicom** — series reading, annotation/segmentation tools framework. Steal: tool API + worker execution.
4. **Kitware/VolView** — zero-install client architecture (TS + ITK-WASM, no server). Steal: layering, not VTK GPU path.
5. **hms-dbmi/viv, vizarr, avivator** — OME-TIFF/OME-NGFF chunk loading as composable layers. Steal: loader + cache.
6. **google/neuroglancer** — arbitrary cross-sections + mesh/skeleton, 4-pane linked views, precomputed/Zarr/N5 sources. Steal: navigation + datasource abstraction.
7. **molstar/molstar, pdbe-molstar, rcsb-molstar, VSCoding-Sequence** — mmCIF/PDB parsing, sequence↔3D selection, superposition/ligand presets, minimal embed. Steal: selection model.
8. **nglviewer/ngl** — compact WebGL protein viewer + density volumes + trajectories. Steal: small-protein fast path.
9. **igvteam/igv.js, GMOD/jbrowse-components, gosling-lang/gosling.js** — embeddable genome tracks, modular tracks, declarative grammar. Steal: track model for Phase 2.
10. **OHIF/viewers (monorepo pattern)** — `extensions/* + platform/*` layout, cornerstone + vtk extension split. Steal: monorepo organization.

First Muse job: "read repos 1–4, propose `volume-core` interfaces; then implement adapters against them." Second job: repos 5–8 behind the same interfaces.
