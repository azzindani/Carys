# Digest Group 7 — Mol* set full-clone protocol receipt

## Mol* (molstar/molstar) v5.11.0 — TypeScript, ~12,871 files
- src: mol-data, mol-math, mol-io, mol-model, mol-model-formats, mol-script,
  mol-theme (+ mol-gl/geo/repr/canvas/plugin skipped).
- PORTED:
  - mol-data/int + db lite → `volume-core/ordered.ts`.
  - AtomicHierarchy (label_/auth_ 1:1) + Model/Structure/Unit →
    `volume-core/structure.ts`.
  - Location/Loci/Bundle trio → `volume-core/loci.ts` (serializable bundle).
  - MolQL shape + PDBe predicate folding → `volume-core/molql.ts`
    (runMolQuery; full parser deferred).
  - Theme palettes as pure fns → `volume-core/theme.ts`.
  - MinimizeRmsd signature + PDBe sequence-alignment flow →
    `volume-core/superpose.ts` (centroid approx; EVD upgrade = Week 4).
- SKIPPED: mol-gl/geo/repr/canvas, plugin/state, servers, apps, extensions,
  volume model, writers, non-CIF readers, BinaryCIF encode, bonds/rings,
  symmetry/lookup3d.

## Wrappers
- pdbe-molstar (~9,680 lines, TS): InitParams/spec, web-component embed,
  QueryHelper, visual.* verbs, superposition server flow →
  InitParams shape in `embed.ts`, predicate folding in `molql.ts`.
- rcsb-molstar (~4,141 lines, TS): Viewer/LigandViewer, ModelLoader,
  Target DTO, selection verbs, subscribeToSelection →
  `target.ts` (Target/SelectTarget/normalizeTarget) + `embed.ts`
  (ViewerProps/defaults).
- VSCoding-Sequence (468 lines, TS): VSCode webview + Viewer.create().then
  load idiom → reference only (standalone-bundle embed pattern).
