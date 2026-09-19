# Bio-atlas & knowledge roadmap — beyond the viewer

Direction notes, started 2026-09-17, expanded same day. Research/education
prototype only — not a medical device. No diagnostic claims anywhere in this
doc are shipped as product behavior; every lane below inherits the repo rule
(PHASES + DIGEST entry, wire leg, golden hashes, 700 LOC cap) and the
`safety.ts` posture: fail-loud, never guess, quarantine education pixels
from measurement pixels.

Licenses were verified by live fetch on 2026-09-17 unless marked
**UNVERIFIED** — the 8-entry human paste-back on 2026-09-18 resolved every
UNVERIFIED row except the SPL SPDX mapping call (yours). One UNVERIFIED row
remains (SPL, §5 ledger); recheck it on the Slicer license page before
vendoring a single byte.

Reuse vocabulary used in §5: **DEPEND** (npm dependency — permissive
MIT/BSD/Apache only, never copyleft in the static bundle), **PORT**
(rewrite the algorithm into engine-pure TS with attribution — the
dicomParser UN-sequence port in `dcm-codec.test.ts` is the house pattern),
**REFERENCE** (read to inform design, golden-test behaviour against it),
**TOOLING** (dev/test scripts only, never shipped), **SIDECAR** (run
alongside in dev, never bundled — the AGPL/LGPL answer).

## 0. Governing principles (production-grade codebase, prototype knowledge)

1. **Pixels ≠ knowledge.** Measurement pixels (DICOM/OME/PDB-derived
   geometry) and educational overlays (atlas shapes, labels, teaching notes)
   live in separate modules, separate store slices, and separate screen
   regions with a visible "education overlay" badge. Mirrors `safety.ts`.
2. **Provenance per digest.** Every vendored asset ships a `SOURCES.json`:
   `{ source_url, retrieved_date, license_spdx, version_pin, entry_count }`.
   Same discipline as golden hashes — a digest without it fails review.
3. **License CI.** A test fails if any vendored asset lacks a license entry.
   Same muscle as the LOC gate and golden-hash pins.
4. **Versioned knowledge entries.** Every label/definition ships as
   `{ term, source, source_version, reviewed_by }` so clinicians later
   correct versioned entries instead of tribal-knowledge strings.
5. **No accuracy claims now.** Ship structure *names and shapes* from open
   atlases, never interpretation. The accuracy upgrade is a people step
   (expert review), and the codebase must already record *whose* knowledge
   each label came from.

## 1. Verified open sources (checked 2026-09-17)

| Source | Gives you | Format / access | License |
|---|---|---|---|
| Z-Anatomy | Full-body 3D: musculoskeletal, organs, vascular, nervous, lymphatic | `.blend` + FBX downloads (one-time FBX→glTF convert) | **CC-BY-SA 4.0** (repo LICENSE) |
| BodyParts3D (DBCLS) | ~1,500 structures, each tied to an FMA ontology term | OBJ downloads + archive mapping files | **CC-BY-4.0** (README §3, verified 2026-09-17) |
| Open Anatomy Project (BWH) | Brain (MRI), inner ear (CT), knee, head & neck, abdomen atlases | Web atlases + OABrowser prototype | Free/open per project statement — pin per-atlas terms at ingest |
| NIH 3D | 12,000+ models incl. NIAID allergy/immune collection (PDB/EMDB/AlphaFold-derived), GLB export, WebXR | Search, download, GLB export | Community portal, per-entry open terms — record per-model license at ingest |
| RCSB PDB | 260k structures + 1M computed models: viral capsids, spike proteins, antibodies | APIs + downloads | **CC0 public domain** for structure data; MotM illustrations CC-BY-4.0 |
| IDR – Image Data Resource (OME) | Real cell/microscopy screens (human, Drosophila, infection phenotypes) with ontology annotations | **JSON API + download, OME-Zarr native** — plugs into the existing OME-NGFF lane | Open reuse terms — confirm per-dataset license at ingest |
| Human Protein Atlas | Tissue/cell protein expression, IHC images | Downloadable data | **CC-BY-4.0** (licence page, pasted back 2026-09-18; third-party constraints apply per-source — Ensembl/GTEx/Tabula Sapiens/BioPlex/OpenCell/IUHPARDB/IntAct user-terms, UniProt/FANTOM/CPTAC/AlphaFold2/AlphaMissense CC-BY-4.0, TCDB CC BY-SA 3.0, MetabolicAtlas CC BY-SA 4.0, AlphaFold3 CC BY-NC-SA 4.0) — cite Uhlén 2015 + proteinatlas.org + versioned image/gene URL, contact contact@proteinatlas.org |
| AlphaFold DB | Predicted structures (EBI) | API + downloads | **Terms of Use + CC0-preferred FAIR roadmap** (EMBL-EBI paste-back 2026-09-18: 68% Terms/CC0, 22% CC-BY; DECIPHER/SureChEMBL restricted, AlphaFoldDB new — record per-model license at ingest) |
| BV-BRC | Bacterial/viral genomes, annotations, analysis tools | Website + API | **Citation-required open resource** (Olson 2022 NAR gkac1003, pasted back 2026-09-18; no closed license asserted — cite + acknowledge U24AI183849) |
| Allen Brain Map | Adult/emouse brain reference atlases, ISH/scRNA | Web + API | **Open-science shared** (open philosophy page, pasted back 2026-09-18; no closed license asserted — cite the atlas + Allen Institute) |

## 1b. Reusable open-source code (verified 2026-09-17 from LICENSE files)

| Repo | Reuse for | License | Digest mode |
|---|---|---|---|
| dicomParser (cornerstonejs) | Already PORTed (UN-sequence handling) — keep as REFERENCE for edge cases | **MIT** | PORT → REFERENCE |
| dcmjs (dcmjs-org) | DICOM JSON model, SEG/RTSTRUCT patterns — REFERENCE only | **MIT** (`License.txt` via GitHub API, © 2017 Steve Pieper, verified 2026-09-18) | REFERENCE |
| cornerstone3D | 2D canvas viewports, annotation state machine, MPR math — study before writing our own canvas tools | **MIT** | REFERENCE |
| OHIF Viewers | Hanging protocols, worklist UX, measurement UX — REFERENCE only (React/enterprise weight, we stay static TS) | **MIT** | REFERENCE |
| NiiVue | WebGL2 volume mesh rendering, 30+ format reader patterns, 3D cursor math | **BSD-2-Clause** | REFERENCE (DEPEND only if the bundle stays static-safe) |
| itk-wasm | Registration, resampling, segmentation filters — the WASM strategy answer (runs client-side, no backend) | **Apache-2.0** | TOOLING first, DEPEND later via WASM bundles |
| Mol* (molstar) | Molecular/cryo-EM rendering, superposition math, pocket pockets patterns; BinaryCIF parser | **MIT** | REFERENCE, PORT selected algorithms |
| neuroglancer | Petascale tiled-viewport architecture, precomputed chunk format — the scale blueprint for >500MB lanes | **Apache-2.0** | REFERENCE (architecture, not code) |
| viv | OME-TIFF/OME-NGFF deck.gl layers — compare against our CPU pyramid lane | **MIT** | REFERENCE |
| zarrita.js | Zarr JS reader — compare/PORT chunk-decode patterns | **MIT** | REFERENCE → PORT |
| pydicom | **TOOLING gold**: generate/error-inject every DICOM fixture, cross-validate our parser on real files; `pynetdicom` for PACS-conformance scripts | **MIT** (pynetdicom 3.0.4 MIT confirmed — pasted back 2026-09-18, © 2012-2021 Munger + contributors) | TOOLING (never shipped) |
| MONAI | Training/inference patterns for the *future* ML lane (see §2X) — never inference in the viewer | **Apache-2.0** | REFERENCE, SIDECAR only |
| napari | Plugin-architecture + 5D viewer UX patterns — REFERENCE for our tiled/5D work | **BSD-3-Clause** | REFERENCE |
| OpenSlide | Vendor WSI format decode (SVS/NDPI/…) — the full-pyramid answer behind our representative-tile stub | **LGPL-2.1** — **SIDECAR ONLY**, never bundled (copyleft) | SIDECAR → PORT clean-room decode behind our `jpeg-*` error style |
| Orthanc | Local PACS for DICOMweb conformance testing (we are a client — test against the real server) | **GPLv3+ server** (© CHU Liège / Osimis / UCLouvain, pasted back 2026-09-18; plugins/viewers may be AGPLv3+; cite Jodogne 2018 JDI + 2022 Stone viewer) — **SIDECAR ONLY** | SIDECAR (docker service in dev, never shipped) |

Copyleft rule: AGPL/LGPL services (Orthanc, OpenSlide) run as sidecars in
dev/test and are never bundled or linked into the static TS. Permissive
licenses (MIT/BSD/Apache) are eligible for DEPEND or PORT with attribution
in DIGEST entries.

## 1c. Second-wave open sources (verified 2026-09-17 from LICENSE files)

| Source | Gives you | License | Digest mode |
|---|---|---|---|
| RDKit | Cheminformatics: SMILES parse, ligand depictions, fingerprints | **BSD-3-Clause** | TOOLING (ligand fixture prep for the pocket lane) + REFERENCE |
| TorchIO | Medical-image preprocessing/augmentation patterns (normalization, resampling, patch sampling) | **Apache-2.0** | REFERENCE (loader/normalization audit) |
| pyradiomics | Radiomics feature *definitions* (first-order, shape, texture) | **BSD-3-Clause** (© 2017 Harvard Medical School, pasted back 2026-09-18) | REFERENCE → CSV-import lane (viewer shows imported features, never computes diagnostic claims) |
| ITK (C++) | Registration, resampling, segmentation algorithms | **Apache-2.0** | REFERENCE (itk-wasm is the execution path; see §1b) |
| TotalSegmentator | >100 anatomical structures segmented from CT/MR | **Apache-2.0** | SIDECAR (run model offline → import masks as editable masks with provenance card) |
| nnU-Net | Self-configuring medical segmentation framework | **Apache-2.0** | SIDECAR (same import pattern as TotalSegmentator) |
| CellProfiler | HCS pipelines: cell measurement columns, quality metrics | **BSD-3-Clause** (`LICENSE` via GitHub API, © 2003–2021 Broad Institute, verified 2026-09-18) | REFERENCE (brushing/feature-column patterns) |
| dcm2niix | DICOM→NIfTI conversion, the stack-geometry reference implementation | **BSD-3-Clause** (© 2014-2025 Rorden, pasted back 2026-09-18; bundled deps carry own licenses: NIfTI PD, ujpeg MIT, miniz PD, OpenJPEG/Jasper/CharLS BSD, zlib-license) | TOOLING (parity-check our stack geometry on pinned samples) |
| pynetdicom | DICOM networking (C-ECHO/FIND/STORE) in Python | **MIT** (© 2012-2021 Munger + contributors, pasted back 2026-09-18) | TOOLING (live-server handshake scripts, see T1) |
| dcmjs | DICOM JSON model, SEG/RTSTRUCT patterns | **MIT** (`License.txt` via GitHub API, © 2017 Steve Pieper, verified 2026-09-18) | REFERENCE |

## 2. Idea lanes

### A — Anatomy overlays (the "digest open 3D" pipeline)

- **A1 · Anatomy overlay v1 (suggested first lane).** Z-Anatomy FBX→glTF
  digest of 2–3 systems (skeletal + muscular first) as static assets;
  viewer tab with per-system toggles; click-a-structure → FMA term + name
  + provenance footer; wire leg + goldens. Proves the whole
  digest→provenance→viewer pipeline; every later atlas becomes a repeat.
  Z-Anatomy mesh digest DEFERRED at the 2026-09-18 closeout (A1 shipped on BodyParts3D instead).
- **A2 · BodyParts3D skeleton + FMA tree.** SHIPPED 2026-09-17 (47 structures, tree.json, leg 34) — original scope: Structure search box with IS-A
  / HAS-PART tree from FMA terms; selecting a term highlights the matching
  mesh in A1. Engine-pure lookup module, snapshot-tested against a pinned
  term subset.
- **A3 · Open Anatomy brain + inner ear.** SHIPPED 2026-09-17 (SPL label table 335 rows + brain-regions service + atlas search + 2 SPL-named tract presets, leg 34 A3) — original scope: MRI/CT-derived atlases as the
  neuro companion to the tract-ROI lane (waypoints already exist) — atlas
  regions as *named waypoint presets*, clearly badged education-only. License: Slicer-License-B page-verified, SPDX mapping owed (UNVERIFIED row).
- **A4 · Cross-section teaching atlas.** SHIPPED 2026-09-17 (plane-atlas cards + tune-dock PlaneAtlasCard + leg 1c) — original scope: Axial slice diagrams paired with
  the MPR planes (Ax/Cor/Sag + oblique): "what plane am I looking at"
  teaching aid for students, driven by the existing plane state.

### M — Microbiology / pathogens

- **M1 · PDB pathogen structure set (CC0, cheapest win).** Curated
  viral-capsid + spike-variant + antibody set extending the existing PDB
  wire; variant↔residue linking lane already built carries the
  "what changed" story.
- **M2 · Infection-screen images via IDR.** SHIPPED 2026-09-17 (idr0083 organoid catalog entry + organoid-context bundle + cohort case + self-test reuse, legs 8e/35/36) — original scope: Host-cell context (IDR OME-Zarr
  over the existing pyramid viewport + brushing) paired with M1 pathogen
  structures — cell context + pathogen structure in one teaching story. Pixels stay remote + blosc-gated.
- **M3 · BV-BRC linkage.** Genome/annotation lookup for studied pathogens;
  license confirmed citation-required open (Olson 2022, pasted back 2026-09-18). DEFERRED at the 2026-09-18
  closeout — a future API-shaped digest starts license-cleared (portal refused automated fetch, needs an API walk
  before bytes).
- **M4 · Mechanism collections.** SHIPPED 2026-09-17 (celiac + allergen on the E2 pattern, legs 30c/35) — original scope: NIH 3D-style curated sets (allergy,
  celiac/HLA-DQ8) as teaching bundles: structure + pathway note +
  provenance card each.

### C — Cells / histology / microscopy

- **C1 · IDR datasets as first-class demo content.** Pinned IDR screens as
  fixtures for the OME-Zarr path (pyramid viewport, 5D sliders, brushing);
  ontology annotations ride along as cell-table columns. Catalog now 4 entries (M2 organoid).
- **C2 · WSI teaching annotations.** SHIPPED 2026-09-17 (model + demo set + Inspector table, leg 9f) — original scope: Extension of the VL lane: overlay
  *teaching* annotations (region names, stain info) on whole-slide tiles —
  annotation display only, never detection/grading claims.
- **C3 · Protein-expression views.** HPA-backed tissue/cell expression
  panels (CC-BY-4.0, pasted back 2026-09-18 — cite Uhlén 2015 + proteinatlas.org; third-party Ensembl/GTEx/TCGA
  user-terms apply per-gene). DEFERRED at the 2026-09-18 closeout — tabular digest waits for a future lane.

### N — Neuro

- **N1 · Allen Brain Map reference overlay.** Region outlines + gene
  expression context for brain volumes (open-science shared, pasted back 2026-09-18 — cite the atlas).
  DEFERRED at the 2026-09-18 closeout — outline digest waits for a future lane.
- **N2 · Atlas-guided tract presets.** SHIPPED 2026-09-17 (3 presets + 3D picker, leg 6; A3 adds 2 SPL-named bundles → 5 total) — original scope: A3 regions + existing tract-ROI
  filter: named bundles ("corticospinal waypoint preset") for teaching
  tractography without claiming patient-specific validity.

### K — Knowledge spine (serves every lane above)

- **K1 · Ontology term service.** One engine-pure module serving
  FMA/Uberon/TA2 terms with version pins; every label in A/M/C/N resolves
  through it so renames propagate and provenance is uniform.
- **K2 · Glossary popovers.** SHIPPED 2026-09-17 (glossaryCard + card, leg 34) — original scope: Click any structure/term → definition +
  source + version. The read-side of K1; pure UI over pinned data.
- **K3 · Teaching-file worklists.** SHIPPED 2026-09-17 (`cohorts.ts` + worklist section + leg 36) — original scope: Curated public-case lists (samples +
  open archives) as DICOMDIR-style worklist entries — the existing
  worklist/read-status flow reused for education cohorts.
- **K4 · Self-test mode.** SHIPPED 2026-09-17 (`selftest.ts` 93-question bank + seeded shuffle + `#/learn` deck, leg 37; M2 adds 3 organoid questions) — original scope: Student quiz over A1/K2 content (name the
  structure); attempts logged to the existing audit trail. Zero diagnostic
  surface by construction.

### R — Reference data for existing lanes

- **R1 · Phantom/QC dataset bundle.** SHIPPED 2026-09-17 (phantom-qc.dcm foundry fixture + rescale-to-HU safety test, xval agrees) — original scope: Pinned public phantom scans so
  `phantomCheck` + orientation gates test against real bytes, not hand
  rolls.
- **R2 · Compression corpora.** SHIPPED 2026-09-17 (jls-lossless.dcm CharLS + rle-lossless.dcm hand-packed + off-disk decode tests, xval 34/36 with 2 documented scale notes + 1 odd-reject) — original scope: Pinned JPEG-LS / JPEG-2000 / RLE samples
  per transfer syntax so codec lanes keep bit-exact fixtures (same pattern
  as the 7 CharLS fixtures that proved leg 9g). JPEG-2000 stays out (no encoder here).
- **R3 · pydicom cross-validation corpus (TOOLING).** pydicom reads every
  repo sample + every hand-rolled wire-leg file in CI-side tooling; any
  tag/geometry disagreement with our parser fails loudly. Same muscle as
  golden hashes, zero bundle cost.
- **R4 · Orthanc conformance rig (SIDECAR).** Local Orthanc in docker for
  DICOMweb QIDO/WADO/STOW conformance beyond the mock PACS (GPLv3+ server confirmed, pasted back 2026-09-18);
  the existing `pacs-verify.mjs` pattern extended to a real server. Never shipped.

### T — Reusable-repo TOOLING and test rigs (no bundle cost)

- **T1 · pynetdicom handshake scripts.** SHIPPED 2026-09-18 (`test/e2e/dimse-echo.py`: pynetdicom 3.0.4 MIT
  loopback C-ECHO 0x0000, `test:dimse` wired; live-server C-FIND/C-STORE against the Orthanc sidecar stays next).
  Scripts live in `test/`, never in `packages/`.
- **T2 · pydicom fixture foundry.** Generate + error-inject DICOM fixtures
  (odd lengths, implicit VR, truncated sequences, every transfer syntax)
  with pydicom instead of hand-rolling bytes; hand-rolled stays for the
  minimal boundary cases, pydicom for breadth.
- **T3 · itk-wasm filter bench.** Resampling/registration/segmentation
  filters evaluated as WASM sidecars against our CPU implementations
  (resliceOblique, fusion, livewire) — timing + numeric-agreement reports,
  no bundle change until a filter wins.
  DEFERRED at the 2026-09-18 closeout.
- **T4 · MONAI sidecar evals (research-only).** Segmentation/classification
  models run in Python sidecars over pinned public data; the viewer shows
  *imported* masks with full provenance, never runs inference. Any future
  in-viewer ML needs its own QMS lane — this lane only proves the import
  path and the quarantine UI.
  DEFERRED at the 2026-09-18 closeout.

### V — Viewer capability upgrades (REFERENCE-led, engine-pure)

- **V1 · Cornerstone-studied annotation tools.** SHIPPED 2026-09-18 (annotations.ts lifecycle + proximity pick, 6/6 parity goldens; MIT verified from the live LICENSE) — original scope: Read cornerstone3D's
  annotation state machine, then implement length/angle/ellipse/Cobb
  natively in our engine-pure style — behaviour-parity goldens against
  documented cornerstone behaviour where testable.
- **V2 · NiiVue-studied 3D cursor + mesh render.** SHIPPED 2026-09-18 (cursor3d.ts + SurfaceView overlay + leg 41; BSD-2 verified from the live LICENSE) — original scope: 3D cursor math and mesh
  patterns inform our `#ro-3d` lane; PORT only engine-pure math with
  attribution.
- **V3 · Neuroglancer precomputed translator (TOOLING).** SHIPPED 2026-09-18 (gen-precomputed.mjs + precomputed.test.ts 3/3; spec read live from volume.md) — original scope: Convert a pinned
  public volume to neuroglancer-precomputed once, to validate our tiled
  streaming lane's chunk math against the petascale reference design.
- **V4 · Viv/zarrita chunk-decode comparison.** SHIPPED 2026-09-18 (test-only zarrita 0.7.5 over vendored cells_demo: all chunks byte-equal both levels) — original scope: Behaviour-compare our OME
  pyramid lane against viv rendering + zarrita chunk decode on the same
  pinned IDR dataset (C1); disagreements become goldens.
- **V5 · OpenSlide-backed WSI pyramid (SIDECAR → PORT).** Full vendor-WSI
  (SVS/NDPI) pyramids decoded via OpenSlide sidecar in tooling; the
  viewer keeps its representative-tile stub until a clean-room PORT lands
  behind our `jpeg-*` error style.
  DEFERRED at the 2026-09-18 closeout.

### D — Data reuse: more open datasets to digest

- **D1 · OpenNeuro set expansion.** SHIPPED 2026-09-18 (ds000001 T1 + BOLD-f0 crops, CC0, catalog + leg 40) — original scope: More pinned OpenNeuro series across
  modalities as fixtures for MPR/fusion/compare lanes (same pattern as
  `samples/lung_ct_01.dcm` + the `dcm-codec` boundary test).
- **D2 · OME-NGFF public samples.** Pinned multiscale Zarr fixtures for
  the pyramid viewport + 5D + brushing lanes beyond hand-rolled bytes.
- **D3 · EMDB map + PDB model pairs.** Map-fit lane graduates from the
  hand-rolled 48³ blob to real EMDB/PDB pairs with published FSC curves
  as the agreement golden (CCP4/MRC parse still required first).
- **D4 · TCIA collections (license-checked).** Pinned TCIA series for
  oncology lanes (RECIST/delta/fusion) — confirm per-collection terms at
  ingest, record in SOURCES.json.
- **D5 · NIH 3D mechanism bundles.** SHIPPED 2026-09-18 (capsid print pairing + allergen-scaffold bundle → 7 bundles, per-model license in provenance, no new bytes) — original scope: Allergy/celiac collections as
  teaching bundles (feeds M4) — per-model license recorded at ingest.
- **D6 · Allen Brain + HPA expression matrices.** Tabular expression data
  as cell-table columns for the neuro/cell lanes (licenses confirmed CC-BY-4.0 + open-shared 2026-09-18).
  DEFERRED at the 2026-09-18 closeout — matrix digest waits for a future lane.

### X — Cross-cutting platform ideas

- **X1 · Digest registry.** SHIPPED 2026-09-17 (DIGESTS.json 7 rows + sources.test gate walk; D1 added the 7th 2026-09-18) — original scope: `DIGESTS.json` at repo root: every digest in
  one machine-readable index (source, license, pin, entry count, lane
  that consumed it) — SOURCES.json per dir + one global view for the
  license-CI gate to walk.
- **X2 · Fixture foundry docs.** SHIPPED 2026-09-17 (`docs/FIXTURE-FOUNDARY.md`: 4 rungs + encoder gaps + xval contract) — original scope: One page documenting the fixture ladder:
  hand-rolled bytes → pydicom-generated (T2) → pinned public data
  (D1–D6) → live-server conformance (R4). Each lane states which rung it
  proved on.
- **X3 · Teaching cohorts as worklists.** SHIPPED 2026-09-17 (difficulty ordering + D-chips + residency-ladder cohort + leg 36 E3) — original scope: K3 generalized: any pinned
  public dataset becomes a worklist cohort with read-status + audit
  trail — the education PACS without a server.
- **X4 · Attribution page.** SHIPPED 2026-09-17 (ATTRIBUTION_ROWS + provenance/attribution tables in the HTML report + ReportView digest card + parity coverage, leg 24 X4) — original scope: Auto-generated from the digest registry:
  every reused repo/dataset with license + link, rendered in-app and in
  the report — the production-grade provenance story made visible.

### E — Education / teaching (the clinician-handoff surface)

- **E1 · Plane-anatomy trainer.** SHIPPED 2026-09-17 (plane-trainer drills + LearnView card + legs 38, audit on planetrainer) — original scope: MPR sliders drive labeled diagrams
  (A4): students scroll a volume and learn what each plane cuts.
  Attempts logged to the audit trail (K4 pattern).
- **E2 · Mechanism-of-disease bundles.** SHIPPED 2026-09-17 (`bundles.ts` + `#/learn` + leg 35). M4 generalized: structure (M1)
  + cell context (M2/C1) + pathway note + quiz (K4) as one teaching
  unit with a provenance card per piece.
- **E3 · Case-based teaching cohorts.** SHIPPED 2026-09-17 (difficulty 1-3 + easy-first validator + residency-ladder + D-chips + leg 36 E3) — original scope: K3/X3 focused: curated public
  cases with questions ordered by difficulty, read-status tracking per
  student cohort — the residency-teaching use case.
- **E4 · Measurement trainer.** SHIPPED 2026-09-17 (measure-trainer cases + LearnView card + leg 39, audit on measuretrainer) — original scope: Known-answer public cases where students
  measure (RECIST/delta lanes) and compare against published values —
  tolerance-banded, never pass/fail on diagnosis.

### Q — Quality / QC for labs (extends `safety.ts`, never diagnosis)

- **Q1 · Phantom trending.** SHIPPED 2026-09-17 (qc-registry phantomTrend + worklist QC tab + leg 36b) — original scope: Q-panel over time: phantomCheck results
  logged per scan date, drift charted — the scanner-QC use case for
  physicists, pure numbers + tolerance bands.
- **Q2 · Dose registry view.** SHIPPED 2026-09-17 (doseRegistry + QC tab, unrecorded rates) — original scope: summarizeDose aggregated across a
  worklist cohort: CTDIvol/DLP distributions, "not recorded" rates —
  audit support, never dose estimation (same rule as the single helper).
- **Q3 · Compression audit.** SHIPPED 2026-09-17 (compressionAudit + QC tab, unvalidated rate) — original scope: compressionWarning aggregated per series
  in a cohort: which series are lossy/unvalidated before a read starts.
- **Q4 · De-identification report card.** SHIPPED 2026-09-17 (deidReportCard + QC tab, ready counts) — original scope: Burned-pixel + PS3.15 profile
  results per series as an exportable checklist before data leaves the
  lab (pairs with the deidentify lane).

### F — Field / low-resource (offline-first, same static bundle)

- **F1 · Offline teaching pack.** SHIPPED 2026-09-17 (`docs/OFFLINE-PACK.md`: what works offline + pack recipe + provenance) — original scope: Pinned digests (A1 meshes + K1 terms +
  M1 structures + quiz) as one downloadable bundle that runs from
  `file://` — the Open-Anatomy-Senegal use case, zero backend needed.
- **F2 · Print-ready teaching sheets.** SHIPPED 2026-09-17 (teachingSheetHtml + ReportView Sheet button + leg 24 F2, answers never on the sheet) — original scope: Report lane extended: structure
  diagram + labels + quiz as printable HTML — classrooms without
  reliable screens.
- **F3 · Low-bandwidth mode.** SHIPPED 2026-09-17 (CellsView Low-BW switch pins smallest level + status teaches + leg 8b2) — original scope: Smallest-pyramid-first loading (C1/V4
  math) as an explicit toggle with byte counters surfaced — every
  streamed byte already counted by the tiled-volume lane.

### G — Genomics / proteomics linking (extends built lanes)

- **G1 · GTF CDS translation.** SHIPPED 2026-09-18 (translateGtfCds + GTF upload + transcript picker + leg 28c) — original scope: The documented follow-up of the
  codon-map lane: real transcript alignment (GTF CDS → codon
  translation) so variant↔residue links need no caller-supplied map.
- **G2 · RDKit ligand depictions (TOOLING).** 2D ligand structures +
  fingerprints for the pocket lane's ligands, pre-rendered offline —
  viewer shows images + provenance, never a chemistry engine.
  DEFERRED at the 2026-09-18 closeout.
- **G3 · Radiomics CSV import.** SHIPPED 2026-09-18 (`measure/radiomics.ts`: pyradiomics BSD-3-Clause
  first-order + shape allowlist, offline CSV → tagged Measurement rows, Inspector Radiomics button + leg 42;
  computation never in-viewer).
- **G4 · Expression-annotated residues.** HPA/Allen matrices (D6, licenses confirmed 2026-09-18) joined
  to residue chips: "this variant's gene is highly expressed in X"
  context from pinned tabular data. DEFERRED at the 2026-09-18 closeout (matrix join waits for a future lane).

### I — Interoperability (hospital-adjacent, still no backend)

- **I1 · dcm2niix parity (TOOLING).** SHIPPED 2026-09-18 (`foundry.py parity`: dcm2niix v1.0.20220720 over
  all 6 sample prefixes — sort order + dims + spacing + z-origins agree, `parity` wired; SeriesUID-split grouping
  is the documented divergence, never failure).
- **I2 · TID1500 import.** SHIPPED 2026-09-17 (tid1500-import + Inspector TID-in + legs 29b, SR-import tags survive re-export) — original scope: The export lane's mirror: read outside
  measurement SRs into our measurement rows (provenance-tagged) —
  round-trip proof with our own exports first.
- **I3 · FHIR Observation export (TOOLING).** Measurements → FHIR-shaped
  JSON offline for EHR-adjacent demos; needs a terminology product call
  (LOINC mapping) before anything ships.
- **I4 · Teaching-PACS profile.** Orthanc sidecar (R4, GPLv3+ confirmed) preloaded with
  pinned teaching cohorts (K3/X3): one docker command = a classroom
  PACS the viewer already talks to.

## 5. Reuse ledger (repo → lane; the single-repo rule made visible)

Every digest lands with the lane that proves it — no speculative
vendoring. Ledger columns: repo/dataset, license, mode, consuming lane,
status. Seed rows (status: proposed unless noted):

| Reuse | License | Mode | Lane | Status |
|---|---|---|---|---|
| dicomParser UN-sequence handling | MIT | PORT | shipped (`dcm-codec.test.ts` documents the port) | SHIPPED |
| CharLS JPEG-LS encoder (via imagecodecs) | BSD-style (CharLS) | TOOLING | leg 9g 7 bit-exact fixtures | SHIPPED |
| Viv resolution-pick + brushing | MIT | REFERENCE | `ome-view.ts`, `cells.ts` | SHIPPED |
| OHIF SOP dictionary (BTO/VL/doc) | MIT | REFERENCE | `tomo.ts`, `wsi.ts` | SHIPPED |
| Daikon dictionary.js (300A/3004) | MIT (repo convention; pin at next touch) | REFERENCE | `rt.ts` | SHIPPED |
| Cornerstone USHelpers/calibrated units | MIT | REFERENCE | `us.ts` | SHIPPED |
| ChimeraX fitmap idea | UCSF terms (idea-level only, no code) | REFERENCE | `mapfit.ts` | SHIPPED |
| igv.js + Mol* linking idea | MIT | REFERENCE | `codon-map.ts` | SHIPPED |
| Z-Anatomy meshes | CC-BY-SA 4.0 | digest | A1 | DEFERRED (closeout 2026-09-18: A1 shipped on BodyParts3D) |
| BodyParts3D skeleton (47 structures) + FMA tree | CC-BY-4.0 (README §3, verified 2026-09-17) | digest | A1/A2/K1 | SHIPPED |
| SPL brain labels (335) | Slicer-License-B page-verified, SPDX owed (UNVERIFIED row) | digest | A3 | SHIPPED |
| RCSB PDB pathogen set | CC0-1.0 (SOURCES verified 2026-09-17) | digest | M1 | SHIPPED |
| IDR screens (idr0083 organoids) | CC-BY-4.0 (IDR footer, verified 2026-09-17) | digest | M2 | SHIPPED |
| IDR catalog (4 entries) | CC0-1.0 | digest | C1 | SHIPPED |
| nih3D-style mechanism bundles (celiac, allergen) | CC0-1.0 (PDB) | digest | M4 | SHIPPED |
| OpenNeuro ds000001 pair (T1 + BOLD-f0 crops) | CC0-1.0 (dataset_description.json License, verified 2026-09-18) | digest | D1 | SHIPPED |
| Allen Brain regions | open-science shared (past-verify page, pasted back 2026-09-18) | digest | N1 | DEFERRED (closeout 2026-09-18) |
| HPA expression | CC-BY-4.0 (licence page, pasted back 2026-09-18; third-party terms apply) | digest | C3/G4 | DEFERRED (closeout 2026-09-18) |
| BV-BRC genomes | citation-required open (Olson 2022, pasted back 2026-09-18) | digest | M3 | DEFERRED (closeout 2026-09-18) |
| RDKit depictions | BSD-3 | TOOLING | G2 | DEFERRED (closeout 2026-09-18) |
| pydicom fixtures + cross-validation | MIT | TOOLING | T2/R3 | SHIPPED |
| pynetdicom handshakes | MIT (pasted back 2026-09-18) | TOOLING | T1 | SHIPPED |
| dcm2niix parity | BSD-3-Clause (pasted back 2026-09-18) | TOOLING | I1 | SHIPPED |
| Orthanc sidecar | GPLv3+ server (© CHU Liège / Osimis / UCLouvain; plugins/viewers may be AGPLv3+; cite Jodogne 2018 + 2022) | SIDECAR | R4/I4 | SIDECAR-only (never bundled) |
| OpenSlide sidecar | LGPL-2.1 | SIDECAR | V5 | DEFERRED (closeout 2026-09-18) |
| itk-wasm filters | Apache-2.0 | TOOLING→DEPEND | T3 | DEFERRED (closeout 2026-09-18) |
| TotalSegmentator/nnU-Net masks | Apache-2.0 | SIDECAR | §1c import pattern | DEFERRED (closeout 2026-09-18) |
| MONAI evals | Apache-2.0 | SIDECAR | T4 | DEFERRED (closeout 2026-09-18) |
| pyradiomics definitions | BSD-3-Clause (pasted back 2026-09-18) | REFERENCE | G3 | SHIPPED |
| TorchIO normalization patterns | Apache-2.0 (wheel METADATA verified 2026-09-18) | REFERENCE | loader audit | SHIPPED |
| cornerstone3D annotation machine | MIT (LICENSE verified 2026-09-18) | REFERENCE | V1 | SHIPPED |
| NiiVue 3D cursor/mesh | BSD-2 (LICENSE verified 2026-09-18) | REFERENCE | V2 | SHIPPED |
| neuroglancer precomputed | Apache-2.0 (spec verified 2026-09-18) | TOOLING | V3 | SHIPPED |
| viv/zarrita chunk decode | MIT (zarrita 0.7.5, verified 2026-09-18) | REFERENCE→PORT | V4 | SHIPPED |
| napari 5D/plugin patterns | BSD-3 (LICENSE verified 2026-09-18) | REFERENCE | 5D work | SHIPPED |
| CellProfiler columns | BSD-3-Clause (LICENSE verified 2026-09-18) | REFERENCE | brushing patterns | SHIPPED |

Rule: a ledger row moves proposed → SHIPPED only in the lane change that
proves it (PHASES + DIGEST entry name the row). The license-CI gate (§3)
walks this table: any digest asset without a matching row fails `test:unit`.

## 3. What the codebase must carry now (before any clinician arrives)

- `SOURCES.json` schema + validator (one per digest dir).
- License-gate test: vendored bytes without a license entry fail `test:unit`.
- Overlay quarantine: education overlays render through a single badged
  component; measurement canvases never import it.
- Knowledge-entry shape `{ term, source, source_version, reviewed_by }`
  adopted everywhere a label ships, so expert review is an update path,
  not a rewrite.
- Report sidecar carries digest pins (extends the reproducibility sidecar
  lane: seriesUID + slice + WL + method + digest pin).

## 4. Suggested ship order

1. Codebase prerequisites (§3: schema + license gate + quarantine + entry
   shape) — small, unlocks everything.
2. **A1** anatomy overlay v1 (proves digest→provenance→viewer).
3. **K1** ontology term service (A1 labels resolve through it).
4. **M1** PDB pathogen set (CC0 = zero license risk, reuses PDB wire).
5. **C1** IDR demo fixtures (reuses OME-Zarr lanes).
6. A2/A3/A4, M2/M4, C2, N2, K2/K3/K4, R1–R4 in priority order with
   medical collaborators; M3/C3/N1 after human license verification.
7. **T1–T4** tooling rigs in parallel anytime (no bundle cost, unblock
   R3/R4 + fixture breadth immediately — T2 first).
8. **V1–V5** viewer upgrades after the lanes they inform (V1 with
   annotation work, V4 with C1, V5 after the VL lane).
9. **D1–D6** dataset digests per consuming lane (never speculative —
   each digest lands with the lane that proves it).
10. **X1–X4** platform pieces when the registry pays for itself (X1 with
    the second digest, X4 before any external demo).
