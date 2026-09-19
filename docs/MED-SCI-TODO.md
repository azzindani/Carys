# Carys — Medical / Science Todo

Prototype only — research/education, not a medical device.
Clinical use needs validation + QMS + regulatory clearance.

Rule: `data/carys/` only. CPU-only, static TS + Workers. Docs land
with the feature (PHASES + DIGEST entry), every new UI ships with a wire
leg in `test/e2e/wire.mjs`, render math pinned by golden hashes.
Coding standards in `docs/CODING-STANDARDS.md` hold (700 LOC cap, tokens
in `:root` only, fail-loud named errors, single store, no new ids without
a consumer).

## P0 — Compatibility unlocks

- [ ] Vendor WASM codec toolchain (openjpeg, charls, numcodecs)
- [x] Add JPEG-LS decoder ← SHIPPED 2026-09-16 (pre-existing `jpeg-ls.ts` CharLS port debugged + wired (...4.80) with 7 bit-exact reference fixtures + pipeline/2-frame/boundary tests + wire leg 9g proven end-to-end; ...4.81 near-lossless stays loud)
- [ ] Add JPEG-2000 decoder (replace named error)
- [ ] Add 12-bit baseline + SOF2 progressive support
- [ ] Add blosc / zstd OME-Zarr chunk support
- [x] Add TRK/TRX dps/dpv sidecar consumer ← SHIPPED 2026-09-15 (TRK n_scalars/n_props stored + TRX dps/data_per_streamline decoded with length checks, first scalar rides FiberSet for tractProfile, `#ro-3d` shows scalar name)
- [x] Add DICOMDIR + multiframe US cine + Doppler support ← SHIPPED 2026-09-16 (DICOMDIR: `io/dicomdir.ts` STUDY/SERIES/IMAGE tree + file-id resolution + worklist DICOMDIR multi-select with series picker + wire leg 9b on hand-rolled bytes proven end-to-end; US cine + Doppler: `io/us.ts` region rows (0018,6011) + cine timing + native YBR fold, pixel pipeline decodes 3-sample color to luma, `.dcm` uploads replay frame-order on the cine rail with file-rate seeding, tag browser names cine + regions + types + wire leg 9c proven end-to-end; PALETTE COLOR + implicit-VR regions + encapsulated US stay loud named errors)
- [x] Add mammography tomosynthesis support ← SHIPPED 2026-09-16 (`io/tomo.ts` BTO + breast-projection SOP gate + imager-spacing/z-interval resolvers on every stack path; BTO uploads stack file-order with laterality/view status + tomo tag row + MG coronal/auto hanging + wire leg 9d proven end-to-end; per-projection geometry + slab MIP presets stay out)
- [x] Add RTPLAN / RTDOSE adapters ← SHIPPED 2026-09-16 (`io/rt.ts` plan summary + Gy dose-grid decode + DVH rows; SOP-first uploads — plan as series row, dose as Gy volume with max/mean status + RT tag rows + wire leg 9e proven end-to-end; MLC/control-point motion/MU verification stay out)
- [x] Add whole-slide DICOM VL + Encapsulated PDF/CDA ← SHIPPED 2026-09-16 (`io/wsi.ts` VL SOP gate + tile-grid summary + document summary; SOP-first uploads — slide opens representative tile with grid status, document lands as metadata row + RT-style tag rows + wire leg 9f proven end-to-end; full pyramids + document rendering stay out)

## P0 — Radiology read parity

- [x] True oblique / double-oblique MPR with rotate handles ← SHIPPED 2026-09-15 (tilt plane picker Ax/Cor/Sag + Obl A/B ride oblPlane; paint/measure/mask-tint centers generalized per plane; wire leg 31; drag-rotate handles stay out — sliders are the handles)
- [x] Measure-on-oblique-plane (length, angle, ellipse, rect, Cobb) ← SHIPPED 2026-09-15 (`measure/oblique-measure.ts` + `MprPanes` frame-aware tap path, wire leg 25; e2e run BLOCKED — no browser libs in sandbox)
- [x] Paint / brush on oblique plane, or loud guard if still blocked ← SHIPPED 2026-09-15 (`editor-seg/oblique-paint.ts` frame splat + stroke + `stampFrameAt`/`strokeFrameTo`; paint+erase ride the tilt on every plane, grow stays orthogonal-loud; wire leg 32)
- [x] Baseline ↔ follow-up compare view (synced scroll + subtraction) ← SHIPPED 2026-09-15 (`render-cpu/fusion.ts` checker/alpha/subtract + tune-dock Compare picker, wire leg 26; same sliders drive both volumes; registration-quality is caller contract)
- [x] Lesion delta table (Δ long axis, Δ volume, % change) ← SHIPPED 2026-09-15 (`measure/delta.ts` label pairing + volumeDelta + CSV, `#deltainfo` + `#delta-csv` in Inspector, compare-series as follow-up)
- [x] Dual-volume fusion view (PET-CT / MR: checkerboard, alpha, SUV window) ← SHIPPED 2026-09-15 (same fusion path; SUV window stays out — needs rescale-slope units product call)
- [x] GSPS Presentation State save/load (WL + pan/zoom + annotations) ← SHIPPED 2026-09-16 (`study/present.ts` `carys-present/1` JSON shape (legacy `omniviewer-present/1` still accepted on read) + tune-dock Present/Open + wire leg 33; Part-10 binary writer stays out — needs retained per-slice SOP Instance UIDs)

## P1 — Quantification / oncology

- [x] RECIST 1.1 pair (long + short axis, target sum, nadir) ← SHIPPED 2026-09-15 (`measure/recist.ts` targetSum + assessRecist CR/PR/SD/PD, 7 tests; nodal <10mm nuance + non-targets stay out, documented)
- [x] Volume-doubling time ← SHIPPED 2026-09-15 (`measure/recist.ts` volumeDoublingTime, Infinity on no-growth, fail-loud inputs)
- [x] Lung-RADS / BI-RADS templates ← SHIPPED 2026-09-15 (`measure/oncology.ts` size-ladder lookup tables, research/education only — not a device, never replaces judgment)
- [x] DICOM SR TID1500 export (measurements, not just HTML/CSV) ← SHIPPED 2026-09-15 (`measure/tid1500.ts` template-shaped JSON: Imaging Measurements → groups → Tracking ID + Finding + NUM/SCOORD, `#meas-tid1500` button, wire leg 29; Part-10 binary writer stays out — needs encoder + UID allocation)
- [x] Curved planar reformat (CPR) + centerline length for vessels ← SHIPPED 2026-09-15 (`render-cpu/cpr.ts` centerlineLength + curvedReformat with trilinear stations; centerline tracing UI stays out — caller-supplied polyline)
- [x] Multi-label SEG roundtrip (segments table, color/name/category) ← SHIPPED 2026-09-15 (`editor-seg/multilabel.ts` + Multi-Lbl seg op + `#seginfo` table + SEG import/export preserving labels, wire leg 27; per-segment colors stay out — single red tint)
- [x] RTSTRUCT full fidelity (holes, contour preservation) ← SHIPPED 2026-09-15 (donut-hole roundtrip test pins even-odd fill; writer already emits per-island CLOSED_PLANAR loops)
- [x] Smart scissors / livewire + level-set refine ← SHIPPED 2026-09-15 (`editor-seg/livewire.ts` sliceGradient + livewirePath Dijkstra + levelSetRefine Chan-Vese pass; UI wiring stays next)
- [x] Tract ROI filtering (waypoint / exclusion + along-tract profiles) ← SHIPPED 2026-09-15 (`render-cpu/tract-roi.ts` filterTracts + tractProfile, sphere waypoints/exclusions + resampled scalar profiles; bundle atlases stay out)

## P1 — Microscopy / HCS science

- [x] OME-NGFF multiscale pyramid-aware streaming viewport ← SHIPPED 2026-09-16 (`io/ome-view.ts` coarsest-cover pick + exact band plan; CellsView auto-level with `#ro-level` chip + progressive banded composite + epoch guard; manual pick leaves auto; wire leg 8b)
- [x] Channel unmixer + per-channel LUT ← SHIPPED 2026-09-15 (`volume-core/unmix.ts` channelGainOffset + flatfieldCorrect + borderBackground; per-channel UI LUT stays next)
- [x] Flatfield / background subtract ← SHIPPED 2026-09-15 (same `unmix.ts`: darkfield + gain + bg with clamp-at-0, border-median estimator)
- [x] Cell-table ↔ viewport brushing at scale ← SHIPPED 2026-09-16 (`volume-core/cells.ts` label + stats + lookup; CellsView Cells switch + `#cellinfo` rows ↔ canvas outline, ≤256px labeling tile; wire leg 8c)
- [x] OME-TIFF 5D TCZYX (dimension sliders, not first-plane only) ← SHIPPED 2026-09-15 (`io/ome-dims.ts` selectPlane + planeExtents + physicalSizes, `loadOmeTiff5D`, vendored `samples/tczyx.ome.tif` 2×2×3; upload-path sliders stay next)
- [x] Use OME-XML PhysicalSize for scale bar in TIFF/Zarr ← SHIPPED 2026-09-15 (`physicalSizes` parses X/Y/Z µm, nulls junk — never guessed; scale-bar wiring stays next)

## P1 — Protein / genome linking

- [x] Superposition RMSD view (`superpose.ts` → UI) ← SHIPPED 2026-09-15 (protein dock RMSD button: minimizeRmsd self-check wired + `#ro-pocket` readout; cross-model comparison needs a second model — stays next)
- [x] Ligand pocket query ← SHIPPED 2026-09-15 (`volume-core/pocket.ts` CA-contact exposed-cleft finder + Pockets button selecting the largest, wire leg 30; PDB parser now keeps atomName for CA detection)
- [x] Cryo-EM map fit stub ← SHIPPED 2026-09-16 (`volume-core/mapfit.ts` centroid-translation dock + trilinear per-residue inclusion + spread-diagnostic correlation; protein EM-map upload over the NIfTI reader + `#ro-mapfit` chip; wire leg 30b on a hand-rolled 48³ blob proven 46/46; MRC/CCP4 parse + 6D rotation search stay out)
- [x] VCF allele depth + BAM pileup in `#/tracks` ← SHIPPED 2026-09-15 (`io/vcf-depth.ts` DP/AD parsing + depth histogram, `.vcf` upload with DP%/labels, wire leg 28; BAM pileup stays out — BGZF + index is its own project)
- [x] Variant ↔ protein residue linking (`seq.ts` + `sequence.ts`) ← SHIPPED 2026-09-16 (`io/codon-map.ts` caller-supplied intervals → chain+seqId + tracks Codon-map upload with `#ro-codonmap` + residue chips → `linkBus` one-shot handoff → protein selects the residue; wire leg 28b; backend alignment stays out)
- [x] GTF CDS translation (G1 follow-up above) ← SHIPPED 2026-09-18 (`translateGtfCds`: GTF CDS rows → per-transcript codon maps, splice-aware + strand-aware + partial-codon reporting; GTF upload + transcript picker in `#/tracks`, entries become the codon map, chips read transcript-ordinal residues; wire leg 28c; residues labeled transcript-ordinal so the seqId mismatch is visible, never silent)
- [x] OpenNeuro ds000001 pair (D1) ← SHIPPED 2026-09-18 (T1 64³ + BOLD-f0 64×64×33 center crops, CC0 verified 2026-09-18 from the live dataset_description.json; SOURCES sidecar + DIGESTS row + frozen header goldens + catalog entries + wire leg 40; MPR/fusion/compare lanes' second real-modality pair)
- [x] I1 dcm2niix parity + T1 DIMSE handshake + G3 radiomics import ← SHIPPED 2026-09-18 (parity PASS all 6 prefixes; C-ECHO 0x0000 loopback; 6-feature CSV import + Inspector button + leg 42; texture/C-FIND stay next)
- [x] CellProfiler-studied shape columns (brushing REFERENCE) ← SHIPPED 2026-09-18 (perimeter/extent/formFactor/aspect on CellStat, BSD-3 verified; rows render P+F + leg 8c step; eccentricity/solidity stay out)
- [x] Neuroglancer-precomputed translator (V3 TOOLING) ← SHIPPED 2026-09-18 (gen-precomputed.mjs over cells_demo bytes → info + raw chunks; 3/3 byte-agreement with our tiled lane; output gitignored, sharded/mesh/jpeg stay out)
- [x] NiiVue-studied 3D cursor (V2 REFERENCE) ← SHIPPED 2026-09-18 (projectCursor/cursorAxes engine-pure, 5/5 parity goldens vs shipped projectors; SurfaceView accent overlay on the synced tap + leg 41; occlusion + world units stay out)
- [x] Cornerstone-studied annotations (V1 REFERENCE) ← SHIPPED 2026-09-18 (annotation lifecycle + proximity pick ported engine-pure from the live LengthTool source, MIT verified; 6/6 parity goldens; calibration/scheduler concerns stay out)
- [x] Zarrita chunk-decode comparison (V4 TOOLING) ← SHIPPED 2026-09-18 (test-only zarrita 0.7.5 + FileSystemStore over vendored cells_demo: every chunk byte-equal both levels + seam tile agrees; io stays dependency-free; disagreements would become goldens)
- [x] Closeout: 9 deferred lanes (Z-Anatomy, M3, C3, N1, D6, G4, G2, T3, T4, V5, §1c) ← CLOSED 2026-09-18 (all license-cleared, none started as digests — ledger rows proposed → DEFERRED, reopen per lane on demand; SPL SPDX mapping is the single open license call)

## P1 — Medical-grade workflow / safety

- [x] Worklist → read → sign flow (MPPS status, double-read lock) ← SHIPPED 2026-09-15 (`study/readstatus.ts` unread→reading→read→signed+locked with audited unlock; per-row Read/Sign/Unlock + status chip; MPPS transport stays out — no backend)
- [x] Audit trail (who measured what, when — extend `history.ts` + `report.ts`) ← SHIPPED 2026-09-15 (`study/audit.ts` capped append-only log, hooked on measure create/delete; multi-user signatures stay out — needs auth)
- [x] De-identification PS3.15 Basic Profile + retain-safe-private matrix ← SHIPPED 2026-09-15 (`study/deidentify.ts` replace/remove/keep/pass tag action table + Siemens safe-private allowlist; binary write-back stays next)
- [x] Burned-pixel detector for US / secondary capture ← SHIPPED 2026-09-15 (`study/safety.ts` screenBurnedPixels, fraction + flag)
- [x] QC gates: phantom check, orientation sanity, dose surfacing, compression warning ← SHIPPED 2026-09-15 (`study/safety.ts` phantomCheck + checkOrientation + summarizeDose + compressionWarning; orientation + compression ride the report issues list + `#report-compression`)
- [x] Reproducibility JSON sidecar (seriesUID + slice + WL + threshold + method + meshKey + maskVer) ← SHIPPED 2026-09-15 (`study/repro.ts`, `report-sidecar` button, wire leg 24)
- [x] Report JSON + HTML parity (figure regenerates byte-identical) ← SHIPPED 2026-09-15 (`study/parity.ts` canonical JSON + FNV fingerprint + HTML coverage check)

## P2 — Performance, CPU-only intact

- [x] Move parsers off main thread (pure fns → worker pool) ← SHIPPED 2026-09-15 (`workers/parse.ts` + `parseClient.ts`: NIfTI/NRRD/TIFF uploads decode in worker with main-thread fallback; `parse-*.js` emitted in bundle)
- [x] Progressive + tiled volume streaming for >500MB series ← SHIPPED 2026-09-15 (`io/tiled-volume.ts` streamBrick with band progress + abort + byte gate; TileRequest gains optional t)
- [x] Extend LRU cache keys to WL/LUT/proj for cine + MIP scrub ← SHIPPED 2026-09-15 (`volume-core/view-cache.ts` canonical key over every pixel-changing input; consumer wiring stays next)
- [x] Perf budgets for new paths (oblique-measure, fusion, 5D stack) ← SHIPPED 2026-09-15 (fuseSlices 62ms + resliceOblique 48ms on 128³, both <2000ms budgets)

## P2 — Docs / gates per change

- [x] F1/F2/F3 field pack (offline doc + teaching sheets + low-BW switch + legs 24-F2/8b2) ← SHIPPED 2026-09-17 (classrooms without screens or bandwidth)
- [x] X2/X3/E3 platform (foundry ladder doc + difficulty cohorts + ladder + leg 36-E3) ← SHIPPED 2026-09-17 (residency use case)
- [x] I2 TID1500 import (own-shape round-trip + Inspector TID-in + leg 29b) ← SHIPPED 2026-09-17 (vendor dialects stay loud)

- [x] Q1–Q4 QC registry (trend + registry + audit + card + worklist tabs + leg 36b) ← SHIPPED 2026-09-17 (screening aggregates, never validated QC claims)
- [x] E4 measurement trainer (4 known-answer cases + LearnView card + leg 39) ← SHIPPED 2026-09-17 (tolerance-banded, never pass/fail on diagnosis)
- [x] E1 plane trainer (12 drills over A4 + LearnView card + leg 38) ← SHIPPED 2026-09-17 (attempts on planetrainer, K4 pattern)

- [x] X1 digest registry + X4 attribution (DIGESTS.json 7 rows + gate walk + report tables + digest card + leg 24 X4) ← SHIPPED 2026-09-17 (pins record the session, not the measurement — out of canonical JSON by design; D1 added the 7th row 2026-09-18)
- [x] R2 compression corpora (CharLS JLS + hand-packed RLE foundry fixtures + off-disk decode tests + xval) ← SHIPPED 2026-09-17 (2 scale notes documented; JPEG-2000 stays out)
- [x] R1 phantom bundle (phantom-qc.dcm + rescale-to-HU safety test) ← SHIPPED 2026-09-17 (real bytes into the tolerance band)
- [x] A4 cross-section atlas (plane cards + tune-dock card + leg 1c) ← SHIPPED 2026-09-17 (teaching text, never volume claims)
- [x] A3 brain regions (SPL 335-label table + brain-regions service + atlas search + 2 SPL-named presets, 5 total + leg 34 A3) ← SHIPPED 2026-09-17 (Slicer-License-B page-verified, SPDX owed)
- [x] M2 infection screens (idr0083 organoid entry + organoid-context bundle + cohort case + K4 reuse, legs 8e/35/36) ← SHIPPED 2026-09-17 (pixels remote + blosc-gated)

- [x] K4 self-test mode (bank 95: 47 structure + 30 parent + 18 bundle + seeded shuffle + `#/learn` deck + leg 37) ← SHIPPED 2026-09-17 (study aid, never a credential; grading stays out; D5 added the 7th bundle 2026-09-18)
- [x] K2 glossary popovers (glossaryCard + term-chip card + leg 34 K2) ← SHIPPED 2026-09-17 (read-side of K1; rule-23 exits)
- [x] N2 atlas-guided tract presets (3 fractional bundles + 3D picker + leg 6 steps) ← SHIPPED 2026-09-17 (teaching waypoints; bundle segmentation stays out)
- [x] C2 WSI teaching annotations (model + demo set + Inspector table + leg 9f C2) ← SHIPPED 2026-09-17 (display only; detection/grading stay out)
- [x] M4 mechanism collections (celiac 4OZF + Bet v 1 1BV1 + 2 bundles + 2 cohort cases + legs 30c/35) ← SHIPPED 2026-09-17 (epitope mapping stays out; 4GG6 documented out)
- [x] A2 full skeleton set (27 structures + FMA tree + neighbourhood search + leg 34 A2) ← SHIPPED 2026-09-17 (atlas graduates to 47; muscle/vascular stay next)
- [x] T2 fixture foundry + R3 cross-validation (5 pydicom fixtures + 32/32 xval + raw-deflate fallback) ← SHIPPED 2026-09-17 (breadth without hand-rolled bytes; multiframe stays scoped, R4 stays out)
- [x] C1 IDR catalog (3 pinned screens + picker + blosc gate loud + leg 8d) ← SHIPPED 2026-09-17 (pixels wait on the P0 blosc/zstd toolchain; per-study terms stay UNVERIFIED)
- [x] M1 PDB pathogen set (6M0J spike–ACE2 + 6W41 RBD–antibody + 1QGT capsid + contacts/variants + leg 30c) ← SHIPPED 2026-09-17 (variant↔residue story on real pathogen geometry; phenotypes stay out)
- [x] K1 ontology term service (1368 BodyParts3D concepts + atlas search + zero-drift pin + leg 34 search) ← SHIPPED 2026-09-17 (every A-label resolves through one choke point; IS-A-only concepts land with A2)
- [x] A1 anatomy overlay v1 (20 BodyParts3D long bones + `#/atlas` + frozen render hashes + leg 34) ← SHIPPED 2026-09-17 (first digest→provenance→viewer proof; skull/Z-Anatomy stay A2/K1)
- [x] Digest provenance foundation (§3: SOURCES schema + license-gate helper + DigestRows quarantine + knowledge-entry shape + digestPins in the sidecar) ← SHIPPED 2026-09-17 (`study/sources.ts` + `sources.test.ts` 5/5 + leg 24 pins digestPins; first digest bytes + license-gate enforcement land with A1)
- [ ] PHASES + DIGEST entry with each feature (standard #24)
- [ ] Wire leg in `test/e2e/wire.mjs` for each new UI
- [ ] Golden hashes for new render math
- [ ] Update closeout ledger (shipped / blocked+owner / accepted)

## Ship order

1. Reproducibility JSON sidecar (foundation for every later claim)
2. JPEG-LS/2000 + zstd/blosc toolchain (unlocks real archives; blocked on toolchain — vendor first)
3. Oblique MPR with measure-on-plane
4. Dual-volume fusion + follow-up compare
5. Multi-label SEG + TID1500 SR export
6. CPR + RECIST/volume-doubling
7. OME 5D + HCS scale-up
