# Phases — one Muse-volume month, prototype only

Budgets assume `opencode-go/muse-spark-1.3-contributor` (~226k req/mo). Use it for scaffolding; verify hard logic with Opus/Sonnet before calling anything "correct".

## Week 1 — volume core + DICOM/NIfTI
- [x] `volume-core` types + tests (dims/spacing, LUT, histogram)
- [x] `io/dicom.ts + io/nifti1.ts` with 50 samples (single-file DICOM decoder ported; +RLE/JPEG/deflated/multi-frame since)
- [x] MPR 3-view + MIP + window/level presets (`slice.html`)
- [x] Exit: axial/coronal/sagittal live. Editor came in Week 2.

## Week 2 — CPU 3D + editor + measure
- [x] CPU 3D surfaces (cuberille + surface nets, NOT raycast/WASM) + STL export
- [x] Brush + threshold + region-grow + undo (+ erase, PNG/.nii export, watershed split)
- [x] length / angle / volume / profile (+ headless volume sweep)
- [x] CSV export (measurements CSV/JSON/SR + mask-stats CSV in Inspector)
- [x] Exit: segment something, measure it, export PNG.

## Week 3 — cells + proteins (same core)
- [x] `io/omezarr.ts` tiled slice + channel composite + stats table (`#/cells`: in-memory demo + vendored `samples/cells_demo.zarr` over HTTP + URL open; pyramid L0 raw / L1 gzip, disk-backed regression tests)
- [x] `io/pdb.ts + io/cif.ts + io/seq.ts`: sequence track ↔ 3D highlight (`selectResidueAtoms`, `#/protein` tab over 1CRN, mmCIF sniffed by content, PDB≡CIF tested) + pLDDT paint (AlphaFold ubiquitin `samples/af-p0cg48-ubiquitin.pdb`, B-factor scheme)
- [x] Exit: two new tabs reusing the same toolbar and undo. (UndoGroup row
  shared by MPR/protein/cells docks; History<T> backs selection + view
  state; palette + Ctrl/Cmd+Z dispatch via undoBus; test/e2e/undo.mjs)

## Week 4 — hardening + demos
- [x] Anonymizer + validator + report export (HTML) (`study/report.ts`, `#/report`)
- [x] Time slider (cardiac 4D cine: frame switch + Δ vs f0; `cardiac-4d-cine`)
- [x] Record 3 demos: radiology / cells / protein (`test/e2e/demos/<ts>/{radiology,protein,cells}.webm` + stills via `npm run demo`; watershed + Sample-.zarr + undo covered).

## Out of scope (say no)
GPU path, PACS integration, auth, multi-user, training models, Docker images, production hardening.

## Shipped after Week 4 (gap loop)
- [x] MZ3 + GIFTI mesh readers (`render-cpu/mz3.ts`, `gifti.ts`; `mesh-formats.test.ts`)
- [x] Rotating oblique MIP (`render-cpu/mip-rotate.ts`; lattice-exact proofs)
- [x] Enhanced MR/CT functional groups (per-frame IPP/IOP/DIV → slice; `enhanced-groups.test.ts`)
- [x] NRRD reader, all 8 dtypes, raw/ascii/gzip (`io/nrrd.ts`; `nrrd.test.ts`)
- [x] MolQL string queries (`molql.ts parseMolQuery`; `molql-string.test.ts`)

## Shipped after that (wiring loop: engine features the UI couldn't reach)
- [x] NRRD open path (`loaders.loadNrrdBuffer` + `uploadNiiFile` sniff + SurfaceView accept)
- [x] Mesh import for .stl/.mz3/.gii (`importMeshFile`, content-sniffed)
- [x] Rotating MIP in the axial pane (MIP + oblique angles → `mipRotate`)
- [x] MolQL search box in ProteinView (bridge to `runMolQuery`, undoable)
- [x] Genome tracks view (`#/tracks`: BED/GFF table + locus filter + scale)
- [x] Per-frame Pixel Measures onto slices (file-level Volume unchanged)
- [x] Detached .nhdr reader (`parseNrrdDetached` + byte skip)
- [x] TCK streamline reader (`render-cpu/tck.ts`)
- [x] Wiring proof (`test/e2e/wire.mjs`, 38 legs — legs written, e2e run BLOCKED in-sandbox, chained into `test:e2e`)
- [x] OME-TIFF reader (TIFF IFDs + OME-XML + raw/deflate/LZW/JPEG; LZW validated vs PIL)
- [x] OME-TIFF volume loading (`loadOmeTiffBuffer`: z-stack or first plane)
- [x] NGFF plate/well navigation (`ome-plate.ts` + CellsView well picker + `plate_demo.zarr`)
- [x] Fiber rendering (`fibers.ts` projection + SurfaceView overlay + `.tck` upload)
- [x] MolQL booleans (OR/NOT/parens predicate tree)
- [x] TRK + TRX tract readers (gzip TRK, float16 TRX)
- [x] Upload slider reset (`pendingSliceInit`: uploads no longer leave stale ranges)
- [x] Oblique Min/Mean (`mipRotate` mode max/min/mean; Min/Mean + oblique no
  longer silently reslice; lattice-exact min proofs + mean-in-[min,max]; wire leg)
- [x] Detached .nhdr open in the UI (`nrrdDetachedName` + `loadNrrdDetached` +
  `uploadNrrdPair`: multi-select header + payload, sibling resolved by the
  header's "data file" name; wire leg)
- [x] Responsive pass (mid-breakpoint topbar wrap, narrow page-flow viewer,
  status ellipsis, report title-row action, channels inset; 18 captures clean)
- [x] Demos re-recorded on the current UI (`test/e2e/demos/<ts>/`, stale dirs pruned)
- [x] Appearance prefs (topbar gear → Text XS/S/M/L/XL via `--ts` type scale +
  Layout XS/S/M/L/XL rhythm levels; localStorage-persisted, `<html>` datasets;
  wire leg incl. reload; well-switch stale-stats clear found by the same run)
- [x] Broken-file battery (`io/corrupt` + `render-cpu/corrupt`: every decoder
  fed hostile input fails loud with a named error; found + fixed two real
  gaps — zero-byte DICOM masquerading as valid, unwrapped zarr JSON errors)
- [x] UI journeys (`test/e2e/journeys.mjs`: paint→PNG download→undo,
  measure→report count, palette→series open; chained into `test:e2e`)
- [x] Perf budgets (`render-cpu/perf`: oblique MIP 128³ <5s, slab 256³ <2s,
  reslice 256³ <2s on ~25–90× observed headroom; LRU eviction already pinned)
- [x] Viewport grid (viewer refactor: file tabs replace the Slices/3D
  switcher — one tab per open file, open/switch/close; 3D viewport left, 3
  slice viewports stacked right, stage-filling; per-viewport zoom ±/slider/
  pan (Select-drag)/rotate (3D drag-orbit)/fullscreen (Esc exits, `2`
  fullscreen-3D); 3D repaints live on control change, mask edits debounce
  600ms; Layout seg reweights the stack instead of hiding panes; mobile:
  3D on top, 2D swipe strip below; `MprView` split into `MprDocks` +
  `MprPanes`, `ViewerView` composes; slice mapping exact under letterbox
  via `contentXY`; wire leg 11 (tabs + fullscreen incl. column-hide);
  before/after captures in the shared folder `viewer-{before,after}-*`)
- [x] Mobile immersion (viewer fits 100dvh with zero page scroll: single
  viewport picked in a bottom action bar, Tools/Display/Files toggle panels
  resize the stage by flex, hamburger + nav dropdown, active-tab-only tabs,
  collapsible 3D toolbar, status rides the slim topbar; `mView`/`mSheet`
  state, `useIsMobile` breakpoint twin, docks split Tools/Tune/Segment;
  audit touch-paint guard updated, captures `mobile-after-*` shared)
- [x] Dead-space pass (3D centers on the mask bbox via `RasterOpts.center` +
  mirrored `projectFibers` center so fibers stay overlaid, `raster-center`
  proofs; desktop toolbar toggle `#docktoggle` reclaims ~200px for the
  grid; wire asserts the stage growth; captures `deadspace-after-*` shared)
- [x] Locked side rails (every viewport gets a uniform 66px gutter holding
  its sliders: vertical slice sliders in 2D panes, Orbit/Tilt in 3D —
  `SliderRow vertical` prop; overlay slider deleted, zoom cluster back in
  the heads; keyboard + drag verified on vertical inputs; capture
  `rails-after.png` shared)

## Shipped in the improvements pass (reference-backed: OHIF toolbar +
measurement panel, NiiVue colormaps/tractography/docs)
- [x] Ellipse ROI (`measure/roi.ts ellipseStats`: plane-aware interior
  stats on axial/coronal/sagittal + existing `ellipseArea`; Measure tool →
  Ellipse, two taps = bbox corners, toast carries area + μ/σ/min/max/n,
  area tracked in measurements/CSV/SR like any other kind; wire leg 12)
- [x] Cine transport (play/pause + FPS 1–12 with live retime for 4D series;
  self-stopping interval, no series-switch bookkeeping; also fixed the
  stale `ro-time` readout on manual frame slides — `setTimeFrame` now
  notifies the store as well as the version bus; wire leg 13)
- [x] Invert (`ui.invert` switch in the tune dock; post-window/pre-overlay
  in all four 2D paint paths so the mask tint stays red; 2D only, noted;
  wire leg 14 asserts the pixel flip)
- [x] TRK + TRX tractography (`importTractFile`: extension routes,
  magic bytes decide — TCK/MRtrix, TRK/TrackVis incl. gzip, TRX/zip;
  same pinned-fiber overlay; NiiVue supports the same trio; wire leg 15
  with hand-rolled TRK bytes + fflate-built TRX)
- [x] DICOM tag browser (`io/dicom-tags.ts DicomTagSummary` from a live
  Dataset or a pixel-pipeline `DicomFileMeta`; SOP class names, dates
  pretty-printed; `sopClassUID` added to `DicomFileMeta`, survives
  anonymization via spread; session.dcmMeta set on catalog DICOM loads,
  cleared everywhere else; Inspector `#dcm-meta`; wire leg 16)
- [x] Viewport chrome (anatomy edge letters from file-level IOP via
  `volume-core iopEdgeLabels` — null for non-axial stacks, labels hidden
  rather than guessed, skipped on oblique axial; physical scale bar from
  volume spacing with 1/2/5 snapping; canvas-drawn, no new ids)

## Shipped in the second improvements pass (OHIF Rectangle + Cobb, NiiVue colormaps)
- [x] Rectangle ROI (`measure/roi.ts roiStats` generalized to a plane-aware
  optional 7th arg, default axial so old callers pass unchanged; Measure
  tool → Rect, two taps = corners, toast carries area + μ/σ/min/max/n,
  tracked + SR-exported like ellipse; wire leg 17)
- [x] Cobb angle (existing `cobbAngle` core wired: Measure tool → Cobb,
  four taps = two lines, acute 0–90° tracked; wire leg 18 pins ≈18°;
  found by the same run: tri-stack panes are short, edge taps fall into
  the neighbor pane and reset the pending stroke — leg uses Ax emphasis)
- [x] Colormap selector (Papaya `ColorTable` 256-entry LUTs finally
  consumed: tune-dock LUT select Gray/Fire/Spectrum/Hot-and-Cold/Gold,
  post-window + post-invert so Invert + LUT compose with NiiVue
  colormapInvert semantics, mask tint still last; Grayscale fast path
  keeps pixels byte-identical; cached per name; 2D panes only, noted;
  wire leg 19 asserts red-dominance + restore)

## Shipped in the third improvements pass (crosshairs + WW/WC drag + calibration)
- [x] Crosshair reference lines (OHIF Reference Lines / NiiVue crosshairs:
  the synced tap voxel draws dashed accent lines on all three panes,
  same axis convention as planePoint; `session.crosshair`, cleared on
  series load; wire leg 21 counts teal pixels on coronal before/after)
- [x] Window/level drag (Cornerstone WW/WC: Shift-drag on any Select pane
  — right widens, up raises center, live `ro-wl` chip + `custom` preset
  that preserves dragged values when re-picked; wire leg 22 drags with
  real keys + asserts readout, pixels and preset flip)
- [x] Pixel-spacing calibration (OHIF Calibration: Inspector triple
  number input, per-axis validate >0 with loud reject, live for
  measures/scale bar, clears derived 3D surfaces; wire leg 23 fills
  2.5×, asserts volinfo + toast, then real-keys a 0 for the reject)

## Shipped in the medical/science lane (reproducibility first)
- [x] Reproducibility JSON sidecar (foundation for every later claim:
  pure `study/repro.ts` — `buildReproSidecar` / `reproSidecarToJSON` /
  `parseReproSidecar` with `bad-sidecar-input` / `bad-json` / `bad-sidecar`
  named errors + `sidecarReportDiff` parity check; `ReportView` gains a
  `report-sidecar` JSON download beside `report-download`, sharing one
  timestamp so HTML and JSON agree; slice indices tracked in
  `session.slices` at paint + seeded at load so a direct `#/report`
  visit still pins real positions; `repro.test.ts` round-trip + hostile
  input + HTML/JSON parity; wire leg 24 downloads the JSON on a fresh
  `#/report` page and asserts every pinned field + save toast)
- [x] Measure on the oblique axial pane (length/angle/ellipse/rect/Cobb/
  probe through the tilted paint frame: pure `measure/oblique-measure.ts`
  — tap inverse, physical pixel area, oblique rect/ellipse stats,
  spacing-aware `cobbAngle3`, zero-tilt reproduction of the orthogonal
  stats; `MprPanes planePoint` carries the frame + true `voxel3` tap,
  pending strokes run on canvas + 3D voxels in parallel with a tilt-key
  that restarts mid-stroke tilts, `length`/`angle` go 3D physical on the
  frame, ellipse/rect scale by the pixel footprint with oblique stats,
  `probe` reads the frame-hit voxel, all flagged `· oblique` in the
  toast; e2e stays BLOCKED — no browser libs in this sandbox, leg 25
  (`test/e2e/wire.mjs`) written + `node --check` clean, unblock is a
  machine with chromium deps; paint-on-oblique stays the loud guard
  (`Reset to orthogonal slice to edit`))
- [x] Dual-volume fusion + follow-up compare (pure `render-cpu/fusion.ts`
  — checker/alpha/subtract over the base geometry with nearest-mapped
  overlay, named errors on bad alpha/checker; `sessionOps.setCompare` +
  `resolveCompareVolume` prime the overlay volume + auto window in the
  background (`compareWl`, "compare loading…" tag until it lands); the
  tune dock gains a Compare picker + Check/Blend/Δ seg + blend slider;
  mask tint skips fused frames (mixed-series red misattributes); wire
  leg 26 asserts checker + Δ tags)
- [x] RECIST 1.1 + doubling + RADS templates (pure `measure/recist.ts` —
  targetSum/assessRecist with the +20%/+5mm PD double gate, CR/PR/SD/PD,
  `volumeDoublingTime` with Infinity on no-growth; pure
  `measure/oncology.ts` — Lung-RADS size ladder + 4X shortcut, BI-RADS
  suspicion escalation; research/education only, never a device)
- [x] Multi-label SEG roundtrip (pure `editor-seg/multilabel.ts` —
  labelmap↔masks, segments table + CSV; `Multi-Lbl` seg op splits islands
  into values 1..N; `#seginfo` table in the Inspector (quiet on binary
  masks); SEG import preserves every segment, SEG export writes one
  segment per value; `sessionOps` SEG I/O split into `segImport.ts`
  under the 700-line gate; wire leg 27 asserts the table)
- [x] Safety screens + QC gates (pure `study/safety.ts` — burned-pixel
  screen, orientation sanity, dose pass-through (never guessed),
  compression warnings, phantom band check; orientation + compression
  ride the report issues list + `#report-compression`)
- [x] OME 5D TCZYX foundation (pure `io/ome-dims.ts` — selectPlane +
  planeExtents + physicalSizes with null-on-junk; `loadOmeTiff5D`
  groups planes into per-(t,c) volumes; vendored
  `samples/tczyx.ome.tif` 2×2×3 with pinned (t,c,z) + pixel
  signatures + `gen:tczyx`; upload-path sliders next)
- [x] TID1500 + tract ROI + unmix + protein + VCF + de-id + audit +
  cache-keys + perf (pure `measure/tid1500.ts` — template-shaped JSON
  report with DCMR codes, `#meas-tid1500` button, leg 29; pure
  `render-cpu/tract-roi.ts` — sphere waypoint/exclusion filtering +
  resampled scalar profiles; pure `volume-core/unmix.ts` — gain/offset,
  flatfield, border-median background; protein dock Pockets button
  (`volume-core/pocket.ts` CA-contact cleft finder, PDB keeps atomName)
  + RMSD self-check, leg 30; `io/vcf-depth.ts` DP/AD + histogram with
  `.vcf` upload in `#/tracks`, leg 28; pure `study/deidentify.ts` —
  PS3.15 action table + safe-private allowlist; pure `study/audit.ts` —
  capped append-only trail hooked on measure create/delete; pure
  `volume-core/view-cache.ts` — canonical key over every pixel input;
  perf budgets extended: fuseSlices 62ms + resliceOblique 48ms on 128³)
- [x] Read→sign flow + report parity + tract scalars (pure
  `study/readstatus.ts` — unread→reading→read→signed+locked with audited
  unlock, per-row status chip + Read/Sign/Unlock buttons; pure
  `study/parity.ts` — canonical report JSON + FNV fingerprint + HTML
  coverage check; TRK per-vertex scalars + properties stored (not
  skipped), TRX dps/data_per_streamline decoded with length checks, the
  first scalar rides `FiberSet` for `tractProfile` with its name in
  `#ro-3d`; PDB/mmCIF parsers now keep `atomName`, keeping the
  PDB≡CIF equivalence green)
- [x] Double-oblique + oblique paint + deltas + CPR + RT holes +
  livewire + worker pool + tiled streaming (tilt-plane picker
  Ax/Cor/Sag rides `oblPlane` through paint/measure/tint/centers;
  `editor-seg/oblique-paint.ts` frame splat + stroke with
  `stampFrameAt`/`strokeFrameTo` — paint+erase ride the tilt on every
  plane, grow stays orthogonal-loud; `MprPanes` tap/measure/paint
  extracted to `PanePaint.ts` under the 700-line gate (605 lines);
  `measure/delta.ts` lesion pairing + `#deltainfo`; `render-cpu/cpr.ts`
  centerline length + straightened reformat; donut-hole roundtrip pins
  even-odd fill; `editor-seg/livewire.ts` Dijkstra wire + Chan-Vese
  pass; `workers/parse.ts` + `parseClient.ts` move uploads off-thread;
  `io/tiled-volume.ts` banded brick streaming with abort; sidecar
  gains `oblPlane`; legs 31–32)
- [x] GSPS presentation save/load (pure `study/present.ts` —
  `carys-present/1` JSON (legacy `omniviewer-present/1` still accepted on read): WL/preset/LUT/invert/proj/slab/
  obliquity + slices + per-pane zoom/pan + full tracked annotations
  for this series; `MprPanes` exposes snapshot/restore through
  `paintBus.getMprView`/`setMprView`; tune-dock Present/Open pair in
  `#dock-present`; wrong-series and dims-mismatch reject loud on the
  visible status; leg 33; Part-10 binary writer stays out — needs
  retained per-slice SOP Instance UIDs)
- [x] Pyramid-aware NGFF viewport (pure `io/ome-view.ts` —
  `pickPyramidLevel` coarsest-cover + `bandPlan` exact tiling;
  CellsView paints auto (viewport-width pick, `#ro-level` chip names
  the resolved level) with progressive banded composite + epoch guard
  so store/well/level toggles win mid-paint; manual pick leaves auto;
  wire leg 8b on the vendored 128/64 store; cell-table brushing stays
  next)
- [x] Cell-table brushing at scale (pure `volume-core/cells.ts` —
  `labelCells` 4-neighbour components + area/centroid/mean/bbox,
  `downsampleTile` block-mean scaler, `cellAt` lookup; CellsView Cells
  switch labels the brush channel at the painted level into a ≤256px
  tile, `#cellinfo` rows (area + centroid + mean, first 200) ↔ canvas
  accent outline both ways, level switch drops the table, background
  click clears; wire leg 8c on the vendored store; per-cell colors +
  tracking across levels stay out)
- [x] Mammography tomosynthesis stack (pure `io/tomo.ts` —
  BTO + breast-projection SOP gate, `stackPixelSpacing` with Imager
  Pixel Spacing fallback + `stackZGap` slice-interval resolver, after
  OHIF's SOP dictionary + cornerstone's calibrated-units idea; every
  stack path (catalog/PACS/DICOMDIR/upload) resolves through the same
  two helpers; `.dcm` BTO uploads stack file-order with laterality/
  view on the status, tag browser shows the tomo row, MG hangs
  coronal/auto; wire leg 9d on hand-rolled bytes proven end-to-end;
  per-projection geometry + slab MIP presets stay out — no product
  need yet)
- [x] Multiframe US cine + Doppler regions (pure `io/us.ts` —
  region rows (0018,6011) + cine timing (FrameTime/FTV/CineRate/
  RecDisplayRate) + native YBR fold, after cornerstone's
  getCalibratedUnits/USHelpers tables; pixel pipeline decodes native
  3-sample YBR_FULL/RGB/YBR_FULL_422 to luma and carries cine fps on
  the meta; `.dcm` uploads open frame-order as the time axis on the
  same cine rail (file rate seeds the slider, missing rate stays
  loud); tag browser names the cine rate + region types + per-region
  rect/units; wire leg 9c on hand-rolled bytes proven end-to-end;
  PALETTE COLOR + implicit-VR regions + JPEG-encoded US stay loud;
  ECG probe variants stay out — no product need yet)
- [x] RTPLAN / RTDOSE adapters (pure `io/rt.ts` — plan summary
  (label/intent/fractions/beams + meterset + control-point energy/
  gantry/SSD + prescription doses) + dose-grid decode (16/32-bit to
  Gy via DoseGridScaling + IPP/offsets geometry + DVH + ROI doses),
  after Daikon dictionary.js group 300A/3004 VRs; `.dcm` uploads sniff
  SOP first (plan lands as a series row, dose opens as a Gy volume
  with max/mean status); tag browser shows RT plan + RT dose rows;
  wire leg 9e on hand-rolled bytes proven end-to-end; beam-limiting
  devices + control-point motion + MU verification stay out — no
  product need yet)
- [x] Whole-slide VL + encapsulated PDF/CDA (pure `io/wsi.ts` —
  VL SOP gate + tile-grid summary (total matrix + origin + offsets +
  focus + optical paths) + document summary (title + MIME + bytes,
  never interpreted), after OHIF's SOP dictionary + the SlideToolkit
  tile-grid idea; `.dcm` uploads sniff SOP first (slide opens its
  representative tile with the grid on the status, document lands as
  a metadata row); tag browser shows VL grid + document rows; wire
  leg 9f on hand-rolled bytes proven end-to-end; full pyramids +
  multi-resolution levels + PDF/CDA rendering stay out — no product
  need yet)
- [x] JPEG-LS lossless decoder (...4.80 wired into the pixel pipeline;
  pre-existing `jpeg-ls.ts` CharLS port debugged against the reference
  encoder: real 32-entry J table, strict-< gradient rungs, error-
  correction XOR with the full sign, byte-stuffed FF00 handling, 2-byte
  LSE fields, CharLS SPIFF wrapper tolerated; 7 CharLS fixtures decode
  bit-exact + pipeline/2-frame/boundary tests; `.dcm` ...4.80 uploads
  open as pixels, ...4.81 stays loud; wire leg 9g on a CharLS-encoded
  ramp proven end-to-end; JPEG 2000 + 12-bit/SOF2 + blosc/zstd stay out)
- [x] I2/X2/X3/E3/F1/F2/F3 third sweep ← SHIPPED 2026-09-17:
  I2 TID1500 import (own-shape round-trip + Inspector TID-in + leg 29b);
  X2 foundry docs (4-rung ladder page); X3/E3 difficulty cohorts (1-3 + validator + ladder + D-chips + leg 36 E3);
  F1 offline pack doc; F2 teaching sheets (+ ReportView button + leg 24 F2); F3 low-bandwidth switch (+ leg 8b2).
  Verified 2026-09-17 at 637/637 unit, build + typecheck:app clean, bundle rebuilt.
- [x] CellProfiler-studied shape columns ← SHIPPED 2026-09-18:
  `cells.ts` CellStat gains perimeter/extent/formFactor/aspect (MeasureObjectSizeShape subset, BSD-3-Clause
  LICENSE verified 2026-09-18 from the live repo file): perimeter counts exposed 4-neighbourhood edges,
  extent = area/bbox, formFactor = 4π·area/perimeter² (capped 1), aspect = bbox w/h; CellsView rows render P + F
  inline (rest in title) + leg 8c shape step. True major/minor eccentricity stays out (needs moments).
  Verified 2026-09-18 at 665/665 unit, build + typecheck:app clean, wire `node --check` clean.
- [x] I1 dcm2niix parity + T1 DIMSE handshake + G3 radiomics import ← SHIPPED 2026-09-18:
  I1 (`foundry.py parity`, BSD-3-Clause © 2014-2025 Rorden pasted back): dcm2niix v1.0.20220720 over all 6 sample
  prefixes — our sliceLocation sort + dims + per-file spacing + z-origins agree with the NIfTI headers (`parity`
  wired; SeriesUID splits are documented divergence); T1 (`test/e2e/dimse-echo.py`, MIT © 2012-2021 Munger
  pasted back): pynetdicom 3.0.4 loopback C-ECHO 0x0000 (`test:dimse` wired; live C-FIND/C-STORE stays next);
  G3 (`measure/radiomics.ts`: 6-feature pyradiomics allowlist, BSD-3-Clause © 2017 Harvard pasted back,
  offline CSV → ` · radiomics import` rows + Inspector button + leg 42; texture features stay out).
  Verified 2026-09-18 at 676/676 unit, build + typecheck:app clean, wire `node --check` clean, parity PASS, xval 34/36.
- [x] TorchIO loader audit + napari 5D patterns + D5 bundles ← SHIPPED 2026-09-18:
  TorchIO 1.2.1 (Apache-2.0, wheel METADATA verified): rescaleIntensity (percentile-clip + min-max, defaults 0..1/0..100),
  zNormalize (masked mean/std, std==0 loud), clampIntensity (null ends = image min/max) in `unmix.ts` + 3 its;
  napari (BSD-3, LICENSE verified): TiffData walk audited against the tczyx fixture (12 explicit elements;
  bare multi-plane elements walk C by documented default) + explicit-FirstC walk test + `auditAxisOrder` findings in
  `ome-dims.ts` + 4 its; D5 NIH 3D pairings: capsid story + allergen-scaffold bundle (M1 bytes, per-model license
  in provenance, no new bytes) → 7 bundles, 95-question bank (UI + leg 37 repinned).
  Verified 2026-09-18 at 672/672 unit, build + typecheck:app clean, wire `node --check` clean, xval 34/36.
- [x] V3 neuroglancer-precomputed translator ← SHIPPED 2026-09-18:
  `scripts/gen-precomputed.mjs` (TOOLING, `gen:precomputed` — never shipped/vendored, gitignored output): converts
  the pinned cells_demo L0 bytes to a neuroglancer precomputed tree (info + 4 raw unsharded chunks, Fortran
  [x,y,z,channel] per volume.md) + `precomputed.test.ts` (3/3: info shape, chunk byte-agreement with our getTile,
  begin-end naming). Chunk addressing validated against the petascale reference design; sharded/mesh/jpeg stay out.
  Verified 2026-09-18 at 664/664 unit, build clean.
- [x] V2 NiiVue-studied 3D cursor ← SHIPPED 2026-09-18:
  `render-cpu/cursor3d.ts` (REFERENCE → engine-pure PORT of NiiVue's "crosshair visible in 3D", BSD-2 verified
  2026-09-18 from the live LICENSE: projectCursor/cursorAxes/cursorOnCanvas mirror raster.ts + fibers.ts rotation,
  framing, and pixel mapping exactly) + 5/5 `cursor3d.test.ts` parity goldens (fibers agreement, axis monotonicity,
  yaw-mirror, on-segment axes, fail-loud bounds) + SurfaceView overlay (accent dot + 6-voxel axis nubs on the
  synced tap, `syncToVoxel` fans out to `paintBus.surface`) + wire leg 41 (axial tap → accent px on #view3d).
  Verified 2026-09-18 at 661/661 unit, build + typecheck:app clean, wire `node --check` clean (browser legs
  unwatched — no chromium in sandbox).
- [x] V1 cornerstone-studied annotations ← SHIPPED 2026-09-18:
  `measure/annotations.ts` (REFERENCE → engine-pure PORT of the cornerstone3D LengthTool contract, MIT verified
  2026-09-18 from the live LICENSE: uid + world handle points + invalidated flag + locked/visible/highlighted,
  create→select→move→commit lifecycle, segment-distance proximity pick) + 6/6 `annotations.test.ts` parity goldens
  (textbook projection values, invalidation on move, locked/invisible never pick, NaN renders nothing).
  Verified 2026-09-18 at 656/656 unit, build clean.
- [x] V4 zarrita comparison ← SHIPPED 2026-09-18:
  test-only zarrita 0.7.5 `open.v2` + FileSystemStore over the vendored cells_demo bytes: every chunk byte-equal
  on both levels + seam tile agrees (10/10 omezarr). Verified 2026-09-18 at 650/650 unit, build clean.
- [x] D1 OpenNeuro ds000001 pair ← SHIPPED 2026-09-18:
  `digests/openneuro-ds000001/SOURCES.json` (CC0-1.0, snapshot 1.0.0, CC0 verified 2026-09-18 from the live
  dataset_description.json License field) + 2 vendored crops (`t1-crop` 64³ 1×1.333×1.333, `bold-f0` 64×64×33
  3.125×3.125×4, crop-shifted affines pinned) + `samples-matrix` D1 its (sidecar/registry + frozen header geometry) +
  catalog entries `openneuro-t1-crop`/`openneuro-bold-f0` + DIGESTS.json row + wire leg 40 (both open as volumes).
  Verified 2026-09-18 at 649/649 unit, build + typecheck:app clean, wire `node --check` clean (browser legs
  unwatched — no chromium in sandbox).
- [x] G1 GTF CDS translation ← SHIPPED 2026-09-18:
  `translateGtfCds` (splice-aware carry, strand-aware ordering, partial-codon reporting, 5/5 `gtf-cds.test.ts` wired into
  `test:unit`) + GTF attribute dual-arm in `genome.ts` + TracksView GTF CDS upload with transcript picker driving the
  codon map (transcript-ordinal chips) + wire leg 28c. Verified 2026-09-18 at 647/647 unit, build + typecheck:app clean,
  wire `node --check` clean (browser legs unwatched — no chromium in sandbox).
- [x] E1/E4 trainers + Q1–Q4 QC registry (second sweep) ← SHIPPED 2026-09-17:
  E1 plane drills (12 over A4 cards + LearnView card + leg 38, audit planetrainer);
  E4 known-answer RECIST/length cases (agree with shipped math + LearnView card + leg 39, audit measuretrainer);
  Q1–Q4 qc-registry (trend/registry/audit/card + worklist QC tabs + leg 36b). Verified 2026-09-17 at 632/632 unit,
  build + typecheck:app clean, bundle rebuilt.
- [x] All-seven sweep: M2 + A3 + A4 + R1 + R2 + X1 + X4 (one session, shared gates) ← SHIPPED 2026-09-17:
  M2 organoid screen (idr0083 4th catalog entry + `organoid-context` 6th bundle + cohort case + K4 reuse to 93; legs 8e/35/36);
  A3 SPL brain labels (335-row digest + `brain-regions.ts` + atlas Brain search + 2 SPL-named presets → 5 total; leg 34 A3);
  A4 plane atlas (`plane-atlas.ts` + tune-dock card + leg 1c); R1 phantom-qc.dcm + HU safety test; R2 jls/rle corpora +
  off-disk decode tests (xval 34/36, 2 scale notes + 1 odd-reject); X1 DIGESTS.json + gate walk; X4 report provenance/attribution +
  digest card + parity pins (leg 24 X4). Verified 2026-09-17 at 621/621 unit, build + typecheck:app clean, bundle rebuilt.
- [x] K4 self-test mode (pure `volume-core/selftest.ts` — 95-question bank
  (47 structure + 30 parent + 13 bundle reuse) + mulberry32 seeded shuffle
  + pure grader + quiz-line audit; `#/learn` self-test dock with Start /
  Reseed / Prev / Next, per-question rationale reveal, score chips;
  parent questions only for the 30 tree-backed structures (15 treeless,
  e.g. sternum/patellae, excluded never guessed); selftest tests 7/7 +
  leg 37 (start, score, rationale, reseed, walk); verified 2026-09-17 at
  610/610 unit, build + typecheck:app clean, bundle rebuilt)
- [x] K2 glossary popovers (pure `terms.ts glossaryCard()` — definition +
  source + version from vendored tables, zero invented prose; atlas term
  chip toggles the card (Esc/✕/re-tap exits per rule 23); glossary tests
  2/2 + leg 34 K2 steps (open, parent, source, meshes, re-tap close);
  verified 2026-09-17 at 603/603 unit, build + typecheck:app clean)
- [x] N2 atlas-guided tract presets (pure `volume-core/tract-presets.ts`
  — 3 fractional-viewBox waypoint bundles resolving against any open
  dims; 3D dock picker filters pinned imports in place (raw import kept
  for Clear), kept-count chip + quarantine status; preset tests 4/4
  incl. end-to-end filter + leg 6 preset steps; verified 2026-09-17 at
  601/601 unit, build + typecheck:app clean)
- [x] C2 WSI teaching annotations (model on `io/wsi.ts` — validate +
  clip + label; demo set on `volume-core/wsi-demo.ts` for the 64×48
  demo tile; Inspector table with clipped rects, skip counts, demo
  button + quarantine badge; real uploads start empty, session reset
  per volume; wsi tests 7/7 + leg 9f C2 steps; verified 2026-09-17 at
  597/597 unit, build + typecheck:app clean)
- [x] M4 mechanism collections (2 NIAID-style bundles on the E2 pattern:
  celiac HLA-DQ8–gliadin–TCR tripartite (4OZF: 13 groove + 12 TCR
  contacts, 4GG6 probed-undocked and documented out) + birch Bet v 1
  allergen (1BV1, backbone landmarks never epitopes); pathogen index
  grows to 5 entries, digest pin extends, bundles to 5, cohort gains 2
  cases; pathogen tests 8/8 + bundle tests 5/5 + cohort keys updated +
  legs 30c/35 M4 steps; verified 2026-09-17 at 595/595 unit, build +
  typecheck:app clean)
- [x] K3 teaching cohorts (pure `volume-core/cohorts.ts` — 3 cohorts over
  catalog series + M1 entries + E2 bundles: chest basics, pathogen
  stories, skeleton walk; worklist CohortSection with picker, progress
  chip, per-case rows reusing readState/markReading/markRead + audit;
  series cases open in the viewer, pathogen/bundle cases stay loud
  about their home view; cohort tests 4/4 + leg 36 (open, reading,
  1/3 progress, provenance, cohort switch); verified 2026-09-17 at 593/593
  unit, build + typecheck:app clean)
- [x] A2 full skeleton set (27 structures: 24 ribs + pelvis + sacrum +
  skull on `volume-core/atlas.ts` — 47 structures, 96 vendored meshes,
  12MB; FMA tree service on `terms.ts` — IS-A ancestry/children +
  PART-OF children over vendored `tree.json` (139 nodes) + raw
  relation files; AtlasView search walks the neighbourhood (ancestors
  up, renderable children down, part-of counts); atlas tests 3/3 +
  digest 5/5 incl. 5 new frozen renders + terms 9/9 incl. 3 tree tests
  + leg 34 A2 steps (skull, rib neighbourhood, skull search, sacrum);
  verified 2026-09-17 at 589/589 unit, build + typecheck:app clean)
- [x] E2 mechanism-of-disease bundles (pure `volume-core/bundles.ts` —
  3 teaching units hand-authored from M1 chain roles + contacts: story
  + pathway + quiz with answers checkable against vendored bytes;
  `#/learn` LearnView with bundle picker, provenance cards,
  structure deep-link into the protein view, and quiz scoring with
  rationales; answers log as `quiz.answer` audit events (K4 pattern);
  bundle tests 4/4 (answers pinned to digest counts) + audit quiz test
  + leg 35 (story, provenance, scoring, wrong-answer teaching,
  bundle-switch reset, 1QGT deep-link); verified 2026-09-17 at 585/585
  unit, build + typecheck:app clean)
- [x] T2 fixture foundry + R3 cross-validation (`test/e2e/foundry.py`,
  TOOLING — never shipped: `gen` authors 6 pydicom Part-10 fixtures
  (explicit/implicit CT, US regions, BTO stack, deflated, odd-length
  injection), `xval` reads
  every samples/*.dcm + foundry file with BOTH pydicom and our parser
  and fails loudly on tag/geometry disagreement — 34/36 agree (2 scale
  notes + 1 odd-reject, each side failing in its own named way); along
  the way the foundry caught 3 real issues (wrong WW tag 00281060 →
  00281051, MultiValue first-value handling, pydicom 3.x raw-deflate
  shape) and the last one became a product fix (raw-deflate fallback
  in `dicom-deflate.ts` + round-trip test); `gen:foundry`/`xval` npm
  scripts wired; verified 2026-09-17 at 580/580 unit, build clean)
- [x] C1 IDR catalog (pure `io/idr-catalog.ts` — 3 pinned IDR OME-Zarr
  screens hand-authored from the live IDR JSON API + EBI S3 bucket
  listing: idr0048A multichannel, idr0013A HCS plate, idr0001A HeLa
  field; CellsView IDR picker pins the catalog version (ro-idr chip +
  DigestRows + sidecar) and names the blosc/lz4 toolchain gap out loud
  instead of vending silent pixels — every probed IDR store uses
  blosc, which the CPU reader rejects by name; catalog tests 5/5 incl.
  a toy blosc fixture proving the gate + leg 8d (chip pins, gate stays
  loud); verified 2026-09-17 at 580/580 unit, build + typecheck:app clean)
- [x] M1 PDB pathogen set (pure `volume-core/pathogens.ts` index — 3 RCSB
  CC0 entries vendored under `digests/rcsb-pathogens/` (1.4MB) with a
  CC0-1.0 SOURCES.json: 6M0J spike–ACE2 (15 CA<8Å contacts), 6W41
  RBD–CR3022 (22 contacts), 1QGT HBV capsid (4 monomers); ProteinView
  pathogen picker + Contacts/Variants buttons ride the existing PDB
  wire (chain-role caption + quarantine badge + digestPins); contacts
  resolve against parsed residues by chain:resSeq with names checked,
  variant-note sites highlight on the measured chain; pathogen tests
  7/7 + leg 30c (contacts 15, variants 9, capsid 4 + loud no-sites);
  verified 2026-09-17 at 575/575 unit, build + typecheck:app clean)
- [x] K1 ontology term service (pure `volume-core/terms.ts` — injected
  term table + termByFma/termByBpId/searchTerms over 1368 BodyParts3D
  concepts vendored as slim `digests/bodyparts3d-terms/terms.json`
  (235KB) with a CC-BY-4.0 SOURCES.json; A1 labels resolve through the
  `structureTerm` choke point (AtlasView term row/toast/status +
  `resolveAtlasTerms` zero-drift pin); atlas search box (name/FMA
  substring, blank never dumps, non-20 hits name the A2 gap); terms
  tests 6/6 + leg 34 extended (search hits + Enter jump + blank stays
  loud); verified 2026-09-17 at 568/568 unit, build + typecheck:app clean)
- [x] A1 anatomy overlay v1, BodyParts3D long bones (pure `volume-core/
  atlas.ts` index — 20 structures hand-authored from the archive's own
  partof mapping files: BP id + FJ file + FMA term per bone, sternum as
  a 3-member compound, atlas-local mm bounds; 22 OBJs converted
  OBJ→raw-MZ3 offline and vendored under `digests/bodyparts3d-longbones/`
  (1.7MB) with a CC-BY-4.0 SOURCES.json; `#/atlas` AtlasView renders the
  digest on the CPU rasterizer (orbit/tilt/zoom + bone picker + FMA term
  row + BP id + tri counts + attribution footer + quarantine badge,
  digestPins ride the session while open); atlas tests 3/3 + digest
  registry 4/4 incl. 3 frozen render hashes; wire leg 34 asserts term +
  BP id + FMA + attribution + bone switch on persistent signals;
  verified 2026-09-17 at 562/562 unit, build + typecheck:app clean)
- [x] Digest provenance foundation, BIO-ATLAS-ROADMAP §3 (pure `study/
  sources.ts` — SOURCES.json + knowledge-entry + registry validators,
  shared education badge, `unverifiedShipped` license-CI gate; sidecar
  gains `digestPins` carried from `session.digestPins` (reset per volume)
  with DigestRows quarantine UI in the Inspector (hidden until A1 lands
  the first pins); license table expanded with RDKit/TorchIO/pyradiomics/
  ITK/TotalSegmentator/nnU-Net rows; license ledger seeded with the 7
  shipped REFERENCE/TOOLING rows; ROADMAP grown to E/Q/F/G/I lanes +
  §5 reuse ledger; sources tests 5/5 + leg 24 pins digestPins; verified
  2026-09-17 at 555/555 unit, build + typecheck:app clean)

## Shipped in the UI/UX pass (design system + three-mode layout)
- [x] Tailwind v4 + Radix design system (`packages/app/src/styles/*`): the
  670-line hand-rolled sheet replaced by a token store (color / type /
  rhythm / proportional rounding) plus five semantic layers. The 30
  hand-written density overrides collapse into two multipliers (`--ts`,
  `--sp`), so an appearance pref re-proportions the whole UI at once.
  Radix backs the popovers and tooltips (outside-click, Escape, focus
  restore — none of which the hand-rolled versions had); sliders stay
  native `<input type="range">` because the wire suite drives them with
  real key events and reads `.inputValue()`.
- [x] Icon rail navigation: eight routes move out of the cramped topbar
  into a labelled rail (`ui/Rail.tsx`, one `ROUTES` list shared with the
  mobile nav sheet), freeing the topbar for study context. e2e navigates
  by hash, so no leg changes.
- [x] Three real layout modes: desktop (>1280) rail + grid + inspector;
  tablet (981–1280) inspector folds under the stage in auto-fit columns;
  mobile (≤980) imaging owns the top, a permanent control deck owns the
  bottom half. The deck is a surface, not an overlay — tools never cover
  the image. 980px stays the twin of `lib/isMobile.ts` (§21).
- [x] 3D-tool viewport treatment, CPU-only: graded stage, masked floor
  grid, corner brackets and an SVG orientation axis gizmo that reflects
  orbit/tilt. Chrome only — no WebGL context, no `three` import; the
  `ARCHITECTURE WebGL/Three ban` test still passes 4/4.
- [x] The 3D dock now has one implementation with two homes: inline on
  desktop, portalled into the control deck on mobile (`dockHost`), and it
  only exists while the 3D viewport is the one on screen. Deleted the
  `vpdisclose` disclosure it replaced (§3).
- [x] Layout bugs found and fixed by measuring, not eyeballing: a tablet
  `min-height: 58vh` that also matched phones and pushed the deck off the
  bottom of the screen (tablet blocks now lower-bounded at 981px); a
  `.panes` wrapper that could not shrink, overflowing the 3D pane past its
  track; `#view3d`'s intrinsic square out-voting the row height inside the
  grid; a `margin-top` sitting outside its grid track; and dock groups with
  no `min-width: 0` that pushed the whole document sideways once the 3D
  dock moved into a 390px deck.
- [x] Touch floors hold at every state: 48 mobile states (4 viewports ×
  3 deck panels × 4 device profiles) audited at 0 horizontal overflow,
  0 sub-24px targets, deck flush to the fold. Switch and checkbox sizes
  tokenised so coarse pointers scale in one place (§22).
- [x] Contract preserved: all 134 e2e-referenced DOM ids survive
  (`#CHROM`/`##fileformat` in the e2e id sweep are VCF header lines in
  fixture bytes, not ids); `data-*`, `title` and `aria-label` selectors
  untouched. Verified 650/650 non-sample unit tests, markers 2/2,
  verify 4/4, build + typecheck:app clean. The 26 remaining unit failures
  are the pre-existing `samples/`-dependent ones, unchanged from baseline.

## Shipped in the instrument pass (it looked like a dashboard, not a tool)
Review of the pass above: it was modern, but it read as a web dashboard —
pill-shaped controls, a toolbar wrapping ~280px across the top, label+slider
rows, and a gizmo that was pure decoration. A 3D tool looks different.
- [x] De-pilled: rounding retuned to instrument density (3→19px, still
  proportional). Pills now only for status dots and toasts.
- [x] Scrub fields replace slider rows (`SliderRow`): a compact rectangle
  with the label inside, a proportional fill and a right-aligned value.
  Still a native range input layered at full size, so the wire legs that
  focus these and send real arrow keys keep working.
- [x] Tool column replaces the wrapping toolbar: `#dock-mpr` gains a
  `column` mode with icon+label tools against the viewport edge, cutting
  the toolbar band from ~280px to ~180px. Kept as one dock because
  `#undogrp` must stay inside `#dock-mpr` (journeys.mjs) and `#modeseg`
  inside `#mpanel-tools` (mobile-audit.mjs).
- [x] Density scales by pointer type, not breakpoint: `--ctl-h` 26px under
  a mouse, 44px under a finger. Instrument tightness and the §22 touch
  floor now come from one variable instead of fighting each other.
- [x] Viewport headers became thin strips carrying the view name and its
  own controls, the way a 3D tool heads each viewport.
- [x] The axis gizmo is operable: clicking X/Y/Z snaps the camera, with
  painter-ordered axes and hover feedback. It still renders no imagery —
  the WebGL/Three ban test passes 4/4, unchanged.
- [x] Re-verified after the density change: all 48 mobile states clean
  (0 overflow, 0 sub-24px touch targets, deck flush to the fold);
  650/650 non-sample unit tests, markers 2/2, verify 4/4, build and
  typecheck:app clean. Desktop controls sit at 20px by design — §22's
  audit is the touch profile, where the floor still holds.

## Shipped in the workflow pass (designed from the job, not the aesthetic)
Second review: the instrument pass fixed how it *looks*, but the tool was
still styled after 3D-modelling software rather than how a reader actually
works. Visual software is viewport-heavy; tools hide, and gestures replace
buttons. Changes driven by the job:
- [x] Wheel stack-scrolls the series; Ctrl/Cmd+wheel zooms. This is the
  binding every reading workstation uses (Sectra, Visage, syngo, OHIF,
  Horos) and the most-used gesture in the job — it was bound to zoom, which
  is backwards. A tool replaced by a gesture is a tool removed.
- [x] Viewport corner overlay (`ui/ViewportOverlay.tsx`): patient/ID,
  modality + study date, series + dims, window/level + slice thickness, and
  the non-diagnostic badge on the image itself. `session.dcmMeta` already
  carried all of it. This replaced the decorative corner brackets that sat
  exactly where a reader expects that information.
- [x] The floor grid is now scoped to the 3D viewport. Behind a
  reconstructed slice a grid is not scenery, it is contamination over the
  thing being read.
- [x] Tool palette shrank from a 152px labelled column to a 56px icon strip
  against the viewport edge; the details panel gained a collapse toggle
  (`#instoggle`, `insOpen`) that hands its 304px column back to the image.

BLOCKED, owner: this sandbox — full "every tool hidden behind pop-outs".
`wire.mjs:1397` asserts `#dockrow-2d` is present on load and that hiding it
*grows* `#viewgrid`, so the toolbar cannot default closed or float out of
layout flow. Moving the tune/seg controls into popovers would also remove
`#layoutseg`, `#projseg`, `#planeseg`, `#cmpseg`, `#cine-play`,
`#oblplaneseg` and friends from the DOM until opened, breaking ~20 legs.
That refactor needs the e2e suite re-run to re-validate, and e2e needs
`samples/`, which is gitignored and absent here. Unblock: run
`npm run test:e2e` on a machine with `samples/`, then rewrite those legs to
open the owning popover first.
owner + unblock step, or accepted by design — verified 2026-09-14)
- BLOCKED, owner: your machine — Docker image: `Dockerfile` ships but the
  sandbox daemon fails every build with `unshare: operation not permitted`
  (re-verified today). Unblock: `docker build` on your machine.
- BLOCKED, owner: toolchain — JPEG-LS/2000, 12-bit baseline, SOF2
  progressive, blosc/zstd chunks: need openjpeg/charls or numcodecs plus a
  WASM toolchain; sandbox has no emcc/rustc/wasm-pack (verified today).
  Named errors stand. Unblock: vendor the codecs + toolchain, then port.
- BLOCKED, owner: you — stable tunnel: the app serves via quick tunnels
  (`deploy` mints a URL, `update` keeps it); a named tunnel needs your
  cloudflared account cert. Unblock: `cloudflared tunnel login` + route.
- BLOCKED, owner: you — auth / multi-user / training models / real PACS:
  need a backend, GPU/data, or PACS credentials; outside the static
  prototype by scope. Unblock: product decision + backend.
- ACCEPTED, no action — WebGL2/VTK/cinematic paths conflict with the
  CPU-only rule (`verify.test.ts` enforces the ban).
- ACCEPTED, no action — WASM marching-cubes: CPU surface nets cover it.
- ACCEPTED, no action — TRK/TRX dps/dpv sidecars: no consumer in the UI.
- ACCEPTED, no action — per-frame spacing stays slice-level; file-level
  Volume is the stable identity for export/measure.
- ACCEPTED, no action — app-shell TSX has no unit harness (no jsdom; adding
  one would pull a DOM + build slice the project chose not to carry):
  covered by typecheck + 24-leg wire + 3 journeys + screenshots + audit.
- ACCEPTED, no action — chrome pixel-diff: render math is pinned by golden
  hashes; CSS diffs are flake factories at this scale. Eyeballed per change.
- ACCEPTED, no action — MolQL stops at booleans (functions/operators need
  product direction; that is improvements territory, not a pending).
- ACCEPTED, no action — static shell (`packages/ui/index.html`) keeps the
  pre-grid Slices/3D layout: it never carried the newer chrome (appearance,
  protein/cells/tracks) and shots/markers still pin its core flows; the
  React viewer is covered by wire/journeys/demo plus before/after captures.
- DEFERRED 2026-09-18, no action this round — roadmap lanes Z-Anatomy digest
  (A1), BV-BRC linkage (M3), HPA expression views (C3), Allen overlay (N1),
  Allen+HPA matrices (D6), expression residues (G4), RDKit depictions (G2),
  itk-wasm bench (T3), MONAI sidecars (T4), OpenSlide pyramid (V5),
  TotalSeg/nnU-Net masks (§1c): all license-cleared, none started as digests.
  Reopen any one by running its lane change (PHASES + DIGEST entry + wire leg).

## Engineering gates (2026-09-22)

Not a feature lane — the spine that the other lanes are checked against.

- DONE — **CI exists.** `.github/workflows/ci.yml` runs `npm run ci` (build,
  typecheck, lint, unit, markers, app build) plus a Docker image build on
  every push. Before this, every rule in CODING-STANDARDS was enforced only
  by whoever remembered to run it.
- DONE — **The Docker build works from a clean tree.** Its gate layer called
  `test:unit` "the hermetic subset"; it was not. `.dockerignore` drops
  `samples/`, and 20 tests read fixtures from it unguarded, so the image
  could not build from a fresh checkout. Proven fixed by running the whole
  RUN line against a sample-free copy of the build context: 0 fail, 20 skip.
- DONE — **A skip is a skip.** New `@carys/testkit` resolves fixture paths and
  returns node:test skip options; `CARYS_REQUIRE_SAMPLES=1` (set by
  `npm run verify`) turns absence back into failure. This also retired three
  `precomputed` checks that returned early with a `console.log` and scored
  as passes.
- DONE — **Lint.** eslint + typescript-eslint, type-aware, `--max-warnings 0`.
  946 initial findings reduced to 0: 873 were node:test's `describe`/`it`
  (fixed by naming them in `allowForKnownSafeCalls`, so the rule stays live
  inside test bodies), 28 were `require-await` against Promise-returning
  contracts (rule removed, reason recorded in the config), and the rest were
  real — including `viv.ts`'s Float64 range, where `1.8e308` is past
  `Number.MAX_VALUE` and had been rounding to `Infinity`.
- DONE — `eslint-plugin-react-hooks` installed. The app already carried
  `eslint-disable-next-line react-hooks/exhaustive-deps` comments with no
  plugin behind them; they were decoration. One real finding behind them.
- BLOCKED — **e2e in CI.** `test:e2e` needs real imaging, and `samples/` is
  not committed. Owner: whoever owns fixture hosting. Unblock: publish a
  small licensed fixture pack (or a generator covering the wire/journey
  paths) that CI can fetch, then add an e2e job.
- OPEN — **`samples/` has no manifest.** `CARYS_REQUIRE_SAMPLES=1` fails on
  the first missing file rather than listing the expected set. Unblock: a
  checked-in fixture manifest (name + size + hash) that testkit reads.

## Accessibility (2026-09-22)

- DONE — **226 WCAG 2.1 A/AA violations to 0.** `--color-faint` had been
  below AA (2.56-3.66:1) on all seven surfaces since it was written — 221
  of the 226 nodes, and the token that carries every hint, micro-label and
  readout. Raised to #8a97a9 with --color-muted to #a7b1c0 to keep the
  hierarchy; ratios recorded in the token comment.
- DONE — **Composite contrast.** `.dockrow` at opacity 0.55 and `.toolstrip`
  at 0.72 composited their own labels down to 1.83:1 and 2.33:1. Both rest
  at 0.85. A token can pass while the pixels fail.
- DONE — **Two tablists that were not tablists.** `.filetabs` owned the "+"
  action; the mobile deck's Tools/Display/Files are disclosures (re-tapping
  closes, so none may be selected). Roles now match behaviour.
- DONE — **`audit:a11y` is a gate**, in `npm run ci` and on every push.
  Proven to fail: reverting --color-faint reproduced 218 failures and exit 1.
  It runs without samples/, so a fixture-free runner still covers the chrome.
- DONE — **`test/e2e/browser.mjs`.** `chromium.launch()` resolves a build
  pinned to the Playwright version, which is why `audit:mobile` had become
  un-runnable in sandboxes carrying a different revision. `CARYS_CHROMIUM`
  overrides the executable; unset, nothing changes.
- OPEN — **Keyboard navigation is unaudited.** axe checks roles and contrast,
  not whether a keyboard can reach and drive the viewport, the docks and the
  deck. Unblock: a wire leg that tabs through each route asserting focus
  order and a visible focus ring, then a `:focus-visible` pass.
- OPEN — **No reduced-motion or forced-colors handling.** Unblock: honour
  `prefers-reduced-motion` for the pulse/shimmer animations and test the
  Windows high-contrast path.

## 3D from DICOM (2026-09-22)

The 3D surface appeared to be NIfTI-only. It never was — the extractor takes
a Float64Array plus dims and cannot tell the formats apart — but three
defaults conspired to make DICOM look unsupported.

- DONE — **The 3D source falls back to the image.** `src` defaulted to
  `'mask'`, so any series arriving without a segmentation — every plain DICOM
  series, since a segmentation is a separate object — opened the 3D pane on
  "empty mask". The NIfTI phantoms ship `*_seg.nii` sidecars and so always had
  one, which is exactly why the limitation looked like a format limitation.
- DONE — **The isosurface threshold is data-driven** (`autoThreshold` in
  volume-core). It was fixed at 0 with a slider capped at 1000: on Hounsfield
  data a cut at 0 HU keeps everything denser than water, fusing brain and
  skull into one featureless shell, and cortical bone at ~1100 HU sat past the
  end of the control. Now: a label map cuts at 0, Hounsfield data at bone
  (300), anything else at Otsu; the slider spans the volume's own range.
  Measured on the CT phantom: threshold 0 gives 136,892 tris (one blob),
  300 gives 242,616 (the skull).
- DONE — **`scripts/gen-ct-series.mjs`**, a synthetic 120-slice CT study as
  real Part-10 files, written with the repo's own writer and sharing its
  anatomy with the NIfTI phantom (`scripts/phantom.mjs`, §4). Stored unsigned
  with RescaleIntercept -1024; the round trip back through `parseDicomSlice`
  returns -1000…1200 HU exactly. A fresh clone can now demonstrate the DICOM
  lane end to end without any patient data.
- OPEN — **No wire leg for the DICOM→3D journey.** The unit test pins the
  threshold maths and the path was verified by hand in a real browser, but
  §19 wants a leg. Unblock: add one to `test/e2e/wire.mjs` that opens
  `ct-head-dicom` and asserts the tri count chip is non-zero.
- OPEN — **CT surface presets.** Bone is the right default, but skin (~-300
  HU) and soft tissue (~50 HU) are the other two cuts a reader wants, and
  reaching them means dragging a slider across 2200 units. Unblock: a preset
  trio in the 3D dock driven by the same Hounsfield constants.

## First run on a clean clone (2026-09-22)

- DONE — **A missing sample said the wrong thing.** All three fetches in
  `loaders.ts` used the response without checking `res.ok`, so a 404 handed
  the server's HTML error page to the NIfTI parser and the app reported
  "This does not appear to be a NIFTI file!". That blames the data for being
  malformed when it is simply absent — the normal state of a fresh clone,
  where samples/ holds nothing but .gitkeep. `MissingSampleError` now names
  the file and the command that fixes it (§12, §14).
- DONE — **`npm run gen:samples`**, one command that fills samples/ with
  synthetic phantoms from the repo's own writers (~42MB: head CT as NIfTI and
  as a 120-slice DICOM series, OME-Zarr cells, a plate). Measured on a
  simulated fresh clone: before, 0 canvases painted and a parser error;
  after, 4 canvases and a 7,016-tri surface.
- DONE — **`samples/.gitkeep` says what is expected**, not just where to put
  it: the two ways to fill the directory, the size, and that `npm run verify`
  needs the real set rather than the phantoms.
- OPEN — **Catalog entries with no generator still 404** (lung_ct, cardiac,
  prostate_mri and the other vendored series). They now fail with an
  actionable message instead of a parser error, but the worklist still lists
  13 studies when only some can open. Unblock: mark catalog entries that need
  real data and show it in the worklist, or generate phantoms for them too.

## Production serving (2026-09-23)

- DONE — **The image starts.** It never had: the Dockerfile switched to the
  non-root `nginx` user but kept the stock config, whose temp and pid paths
  are root-owned, so the container exited 1 at start-up ("mkdir()
  /var/cache/nginx/client_temp failed"). CI only built it. `deploy/nginx.conf`
  now owns the server: port 8080, every writable path in /tmp, and it runs
  under `--read-only --tmpfs /tmp --cap-drop ALL`.
- DONE — **`npm run test:image` is a gate** (CI image job): health, redirect,
  headers, cache policy, compression and types over HTTP, then Chromium boots
  the app and every route under the real CSP, failing on any violation, any
  request off the origin and any route chunk that does not arrive. Proven to
  fail: a config without `data:` in img-src gave 8 failures and exit 1.
- DONE — **`digests/` ships.** Atlas, Learn and the pathogen structures fetch
  it at runtime; the image left it out. The per-package tsc builds and the
  legacy `packages/ui` shell no longer ship: the shell's import map points at
  /node_modules/, so all three of its pages died on their first module, and
  it runs only on inline script.
- DONE — **No third-party requests.** Inter, Space Grotesk and IBM Plex Mono
  are bundled from @fontsource (Latin, the weights the sheets use); the
  Google Fonts links in both index pages are gone. Offline and air-gapped
  sites get the real type, and no page view reaches Google.
- DONE — **Route split.** Seven routes are `React.lazy` chunks; React and
  Radix have their own. Entry 722.30 kB → 296.00 kB (gzip 237.28 → 100.53);
  everything fetched at boot 722.30 → 564.59 kB (gzip 237.28 → 187.31).
  Both build warnings (the 500 kB chunk, the mixed `@carys/io` import) gone.
- OPEN — **`connect-src` allows any https origin**, because the PACS and zarr
  hosts a user types in are unknowable at build time. Owner: whoever deploys
  to a site. Unblock: a per-site origin list (an env var rendered into the
  config at start-up) once a deployment can name its hosts.
- OPEN — **The entry is mostly the parsers the viewer boots with**
  (`@carys/io` alone is ~190 kB before minification). Owner: the imaging
  lane (`lib/loaders`). Unblock: import format decoders on first use.

## Clinical geometry on the real samples (2026-09-23)

Every catalog series was opened in Chromium and screenshotted before and
after. What the images showed, and what changed:

- DONE — **Anatomy is where the patient is.** The panes mapped voxel axes to
  the screen blind, so a RAS-stored NIfTI (liver_33) showed the liver on the
  screen right with the spine at the top, and every coronal and sagittal was
  upside down (inferior up). Volumes with a qform/sform or DICOM
  IOP/IPP are now re-laid out once at load into LPS storage
  (`volume-core/geometry.ts`, `app/lib/orient.ts`) and coronal/sagittal draw
  superior-up: radiological convention on all three panes, with R/L, A/P,
  S/I letters at the pane edges. A volume without orientation (ACDC 4D cine)
  stays as stored and says "orientation unknown" on the image instead of
  guessing letters. Oblique grids snap to their nearest axes.
- DONE — **Reformats at true proportions.** The canvas was the voxel grid
  stretched by CSS, so a 0.94 × 5 mm CT's coronal drew 512 × 58 — squashed
  5.3×. The canvas is now the pane's own pixels; one mapping (`views/paneView.ts`)
  fits the slice in millimetres, applies zoom/pan/flip, and inverts every tap.
  Labels, scale bar and measurement marks are drawn in screen px (same size on
  a 64² and a 512² grid) and zoom re-renders instead of upscaling a bitmap.
- DONE — **3D in millimetres, both modes.** The surface (`app/lib/physical3d.ts`):
  mesh, fibres, cursor and framing scale by spacing (normals by its inverse).
  The volume raycaster (`render-cpu/vr.ts`) takes a `spacing` and marches in
  mm, with the gradient per mm; unit spacing is bit-identical to the old
  voxel-space render (unit-tested, with an 8 mm cube on a 1×1×2 mm grid that
  must draw square). The covid chest CT's side view now spans 287 mm head to
  foot instead of 58 voxels. A surface that finished extracting after the
  switch to volume mode used to re-zoom the view and draw itself over the
  raycast; so did the zoom reset. Both now leave the volume render alone.
- DONE — **DICOM files become stacks, not a blind pile** (`io/dicom-stack.ts`).
  Four copies of "sort by Slice Location, stack, take the median gap" (catalog,
  DICOMDIR, PACS, upload) are now one: group by series + matrix + orientation
  + spacing, order by IPP along the normal, space by position, split evenly
  repeated positions into phases, and flag sparse stacks, gantry tilt and
  dropped repeats — on the image, in amber. The vendored `lung_ct_0x` picks
  are five different exams: they used to stack into one "volume" and a 3D
  surface through five patients; they now open as five series.
- DONE — **Folders open.** The file router opened only the first file of a
  selection, so a real study (a folder of slices) could not be loaded. DICOM
  is recognised by content (extensionless `IM0001` files included), several
  files open as the series they contain, and a study folder can be dropped
  anywhere on the viewer (`app/lib/dropFiles.ts`). The file input is the
  viewer's own, always mounted: it lived in the 3D dock and vanished in every
  fullscreen 2D view.
- DONE — **Pixel values are exact.** The DICOM decoder wrote everything into
  Int16: unsigned 16-bit MR above 32767 wrapped negative, fractional MR/PET
  rescale was rounded away, and signed pixels stored in < 16 bits were masked
  instead of sign-extended. Int16 stays where it is exact; the rest is
  Float32. The lung-ct-dicom golden moved by < 1 HU (slope 1.000244 no longer
  rounded) and was re-frozen after eyeballing.
- DONE — **Uploads decode correctly.** The parse worker kept its own NIfTI
  decode, which read voxels as `new Float64Array(frameBytes)`: an uploaded
  int16 BraTS FLAIR came back 75% NaN. The worker now calls the loaders.
- DONE — **PACS pulls parse the instance, not the envelope.** A WADO-RS
  multipart part is a view into the whole response; `b.buffer` handed the
  parser every boundary and header too.
- DONE — **MR opens readable.** The hanging protocol pinned MR to fixed
  windows (W200/C100, W256/C128) that fit one FLAIR by accident; the prostate
  and brain MR samples (values to 5,000 and 21,700) opened solid white. 'auto'
  is now the file's own VOI window, else the 2–98th percentile of the
  non-background voxels. A series with no modality never inherits the
  previous series' CT preset. ACDC cardiac is catalogued as the cine MR it is.
- DONE — **Exports land on the source grid.** Mask `.nii` was written with
  qform = sform = 0 in the viewer's layout; it now goes back to the file's own
  voxel order with its affine as both sform and qform (qfac included), so it
  overlays the scan in ITK-SNAP, Slicer and nibabel. The geometry suite checks
  it voxel-for-voxel against the source segmentation.
- DONE — **Single images open as images** (fullscreen axial, no idle 3D
  extraction) instead of a one-voxel reformat and a slab "surface".
- DONE — **Results stay readable.** A pane repaint or a surface landing
  overwrote the status line a frame after an import reported ("US cine: 2
  frames @ 26 fps" became "80 tris via worker"); background updates are now
  ambient and never replace a result younger than 3 s. The cine transport now
  appears for a US upload (the dock ignored session state).
- DONE — **Seven vendored series now listed**: abdomen CT, two brain MR sets,
  hepatic vessels + tumour, spine CT, sagittal lumbar spine MR, MS-lesion
  FLAIR, T1 with a grey-matter probability map (thresholded at p > 0.5).
- DONE — `npm run test:geometry` (in `test:e2e`) pins all of the above on the
  real samples: liver on screen left, coronal aspect within 6% of physical,
  lung picks → 5 series, sparse cardiac warns, mask export matches the source
  seg exactly with its affine, worker upload matches the catalog decode, the
  volume render spans the CT's physical length.
- DONE — **The line cap covers the views.** `verify.test.ts` checked `.ts`
  only, so `MprPanes.tsx` had reached 833 lines; its overlay drawing moved to
  `views/paneChrome.ts`, three copies of the 3D view's mask bounding box
  became `maskBox`, and the check now includes `.tsx`.
- DONE — **Opening a series no longer stalls the viewer.** Catalog volumes
  decoded and re-laid out on the main thread (most of a second on a 9M-voxel
  NIfTI); they now go through the parse worker like uploads. One histogram
  serves the window and the threshold, a surface already being extracted is
  not extracted twice, and masks cross to the worker as bytes, not doubles.
- DONE — **The wire suite runs to the end.** It had stopped at its first
  failure for several changes, so every later leg rotted unseen. Running it
  through surfaced real bugs, now fixed: Learn's "Open structure" never
  opened its structure (it called a ref nothing had filled, and the demo
  model raced it); the protein and atlas views repainted after every render
  and erased the result just reported (pockets, RMSD, searches); a pocket
  query with no pockets showed nothing; pocket, RMSD and map-fit results
  outlived the model they ran on; the pathogen caption never named its PDB entry; a VCF
  track opened on its first feature only; the VL tile grid was dropped by
  the series load; JPEG-LS uploads reported no result; the appearance
  popover opened under the top bar; the details drawer covered the right
  pane; crosshairs were anti-aliased smears. Tests that asserted since-edited
  text or waited 1.5 s for the details drawer (a slow mount read as "no
  drawer") were corrected against the app, not the other way round.

## 3D fidelity (queued 2026-09-23)

The 3D view looked built from blocks, for four reasons found in the code:
the default surface method was cuberille faces (`method: 'blocky'`), masks
are binary so even surface nets terrace, thick slices make 5 mm steps, and
the rasterizer lights each triangle flat. This queue fixes that on the CPU,
one item per delivery, in order. Each item lands with its tests and docs,
passes `npm run ci` and the e2e suites it touches, and is pushed on
`claude/3d-fidelity` with CI green before the next starts. Accuracy is
measured, not eyeballed: analytic phantoms have known surfaces and volumes.

- DONE — **F1. Accuracy harness.** `render-cpu/src/test/phantoms.ts` +
  `accuracy.test.ts`: sphere, ellipsoid and torus sampled as blurred
  intensity fields (σ 0.5 mm) and as masks, on 1 mm, 0.8×0.8×2.5 mm and
  1×1×5 mm grids, scored in mm. The harness proves itself first (an exact
  UV sphere scores ~0; a 0.5 mm shift scores 0.5 mm). Baseline, sphere on
  1 mm / on 5 mm slices, mean vertex error · volume · normal deviation:

  | path | 1 mm grid | 1×1×5 mm |
  |---|---|---|
  | blocky (default today) | 0.34 mm · +0.8% · 45° | 0.93 mm · −5.0% · 43° |
  | smooth, image | 0.43 mm · −1.9% · 5.4° | 1.44 mm · −8.6% · 19° |
  | smooth, mask | 0.44 mm · −0.2% · 12.6° | 1.45 mm · −8.6% · 25° |

  Findings it made at once: the smooth path sits **half a voxel off** the
  voxel-centre convention the panes and cuberille use (sample i at i, not
  i + 0.5): shifted into place its 1 mm error drops from 0.43 to 0.02 mm,
  and on 5 mm slices it is worse than blocky because of it. Surface nets
  also reads ~2% low in volume (vertices average the crossings and cut
  convex corners). Both go into F2.
- DONE — **F2. Sub-voxel surfaces by default.** `render-cpu/surface-nets.ts`
  rewritten: vertices on the voxel-centre convention (sample i at i + 0.5,
  where the panes and cuberille put it), each projected along the gradient
  onto its cell's trilinear surface instead of left at the mean of the edge
  crossings, and each quad split along the diagonal that stays nearer the
  surface. Smooth is now the default method (blocky stays an option). The
  image and the mask each keep their own threshold: one shared value
  carried a mask's 0 onto a CT (a skin surface) and a CT's cut onto a
  0/1 mask (nothing). Measured (F1 phantoms, before → after):

  | smooth, image | mean error | volume | normals |
  |---|---|---|---|
  | sphere, 1 mm | 0.43 → **0.026 mm** | −1.87 → **−0.92%** | 5.4 → 3.3° |
  | torus, 1 mm | 0.44 → 0.025 mm | −2.26 → −1.84% | 7.8 → 3.8° |
  | ellipsoid, 0.8×0.8×2.5 mm | 0.89 → 0.18 mm | −1.82 → −1.47% | 13.9 → 10.8° |
  | sphere, 5 mm slices | 1.44 → 0.45 mm | −8.6 → −8.1% | 19 → 15° |

  What is left of the volume deficit is measured too: vertices sit 0.018 mm
  inside on average (linear crossings across an edge half a voxel wide) and
  triangles sag 0.015 mm between them. Masks improve (sphere 0.44 →
  0.15 mm) but stay terraced at 16° (F3), thick slices stay terraced (F5).
  Faster on the real samples with the same triangles, from two slices of
  typed-array bookkeeping instead of a map over every cell: covid mask
  512×512×58 1.9 → 0.70 s, BraTS mask 1.7 → 0.56 s, skull CT 0.69 → 0.12 s.
  The `skull-ct-smooth` surface golden was re-frozen after comparing old
  and new renders side by side.
- DONE — **F3. Anti-aliased masks.** `maskNets` (`render-cpu/surface-nets.ts`):
  constrained elastic surface nets (Gibson 1998) — every vertex relaxes
  toward its neighbours for 20 Taubin rounds (λ 0.5, μ −0.53) but never
  leaves its cell, the cube between the inside and outside voxel centres it
  separates. The queued options were measured first and dropped: a blur of
  the mask clamped back to its voxels met the sphere bound (σ 0.8 mm:
  0.07 mm, 5°) but a one-voxel plate lost 88% of its volume; a plain
  signed distance field crosses zero at the same midpoints as the mask, so
  alone it terraces the same way. The smooth method on a mask source now
  runs maskNets (worker and main-thread paths). Mask surfaces, plain nets →
  maskNets (mean error · volume · staircase):

  | phantom | plain nets | maskNets |
  |---|---|---|
  | sphere, 1 mm | 0.145 mm · −0.0% · 16.1° | **0.076 mm · +0.7% · 5.4°** |
  | torus, 1 mm | 0.138 mm · +0.5% · 14.7° | 0.082 mm · +1.7% · 5.5° |
  | tube r 1.2 mm (a vessel) | 0.153 mm · −5.1% · 21.8° | 0.057 mm · −0.2% · 7.7° |
  | plate, one voxel thick | −9.1% volume | −9.2% (thickness kept) |
  | ellipsoid, 0.8×0.8×2.5 mm | 0.40 mm · 24° | 0.30 mm · 16° |
  | sphere, 5 mm slices | 0.67 mm · 23.5° | 0.59 mm · 17.4° (F5) |

  Cost on the real masks, best of three: +45 to +90 ms (covid 512×512×58
  386 → 474 ms). On the samples, hepatic vessel branches survive intact and
  the BraTS tumour is smoother at voxel scale but keeps its larger terraces:
  the segmentation itself steps 2–23 voxels between neighbouring columns
  (only 44% of its steps are one voxel). Removing those means overriding the
  mask's own voxels, which is F4's user-controlled smoothing, not this.
- DONE — **F4. Volume-preserving mesh smoothing.** `render-cpu/mesh-smooth.ts`:
  the windowed-sinc filter of Taubin, Zhang & Golub (1996) — VTK's
  vtkWindowedSincPolyDataFilter, which 3D Slicer runs on segmentations —
  as a 20-term Chebyshev polynomial in the umbrella operator, strength s
  giving a pass band of 10^(−4s) (Slicer's mapping). Its gain is 1.00 below
  the pass band and ~0 at terrace frequencies, but a mesh low-pass cannot
  tell a terrace from a thin vessel: the filter alone took 15% of a 2.4 mm
  tube's volume at s 0.35. So each closed piece then moves along its normals
  until it has its volume back (Newton on ΔV/area, 4 steps; pieces with an
  odd-shared edge are open and left alone; slivers under 10⁻³ voxel³ and
  steps over a voxel are refused — the BraTS mask has 213 four-way edges
  and four zero-volume slivers, and without those guards its "volume" went
  to 10¹¹). A **Smoothing** slider (0–1, default 0 = as extracted) sits in
  the 3D dock for smooth surfaces; its value is part of the mesh cache key
  and of the report's meshKey. At s 0.5 (mask surfaces, F3 → F4):

  | phantom | staircase | mean error | volume change |
  |---|---|---|---|
  | sphere, 1 mm | 5.4 → **2.1°** | 0.076 → 0.044 mm | 0.000% |
  | torus | 5.5 → 3.3° | 0.082 → 0.063 mm | 0.000% |
  | ellipsoid, 0.8×0.8×2.5 mm | 16.0 → 8.4° | 0.30 → 0.24 mm | 0.000% |
  | sphere, 5 mm slices | 17.4 → 12.3° | 0.59 → 0.41 mm | 0.000% |
  | tube r 1.2 mm | 7.7 → 7.5° | 0.057 → 0.108 mm | 0.002% |

  A box's real edges round off (its staircase score 5.1 → 10°): a smoother
  cannot tell a true corner from a terrace, which is why the default is 0.
  On the BraTS tumour s 0.5 takes the mean angle between neighbouring faces
  from 19.7° to 13.5° with the volume unchanged (26,449 voxel³) — the
  terraces F3 could not touch are gone in the render. Cost: 0.13 s on that
  23.7k-triangle mask, 1.2 s on the 529k-triangle FLAIR surface (worker).
- OPEN — **F5. Thick slices.** Shape-based (distance-field) interpolation
  between slices for masks, cubic along z for intensity, before extraction.
  Accept: the ellipsoid on a 1×1×5 mm grid meets the F2/F3 bounds; the
  covid chest CT surface shows no 5 mm terraces (eyeballed screenshot).
  Landed (`render-cpu/thick-slices.ts`, `smoothSurface`): when the slice gap
  is ≥ 1.5× the pixel, each slice becomes a 2D signed distance map in mm
  (exact EDT; an image's pixels next to the edge seeded at their sub-pixel
  crossings, a mask's at the midpoint), the maps are Catmull-Rom
  interpolated onto near-isotropic slices (an empty slice = its neighbour
  one gap further out), the zero surface is extracted, and it is relaxed
  inside the scan's own cells. Cropped to the object and capped at 32 M
  voxels (the factor drops to fit). Cubic interpolation of the intensity
  itself was measured and dropped: 0.45 → 0.38 mm on the 5 mm sphere, the
  staircase unchanged — a sharp edge 5 mm away cannot move a crossing.
  Measured, one-grid path → thick path:

  | phantom | image (F2 → F5) | mask (F3 → F5) |
  |---|---|---|
  | sphere r10, 1×1×5 mm | 0.45 mm · 14.9° → **0.15 mm · 6.2°** | 0.59 mm · 17.4° → 0.21 mm · 8.5° |
  | ellipsoid 12×9×20, 1×1×5 mm | 0.23 mm · 8.6° → 0.12 mm · 4.1° | 0.28 mm · 9.8° → 0.20 mm · 7.4° |
  | ellipsoid 12×9×7, 0.8×0.8×2.5 mm | 0.18 mm · 10.8° → 0.18 mm · 7.7° | 0.30 mm · 16.0° → 0.22 mm · 9.4° |

  The covid lesions (0.94×0.94×5 mm) render without 5 mm terraces and the
  status says `slices ×5 interpolated`; 1.9 s instead of 0.9 s for the
  mask; the full-body bone surface is ×3, 1.6 M triangles, ~7 s in the
  worker (was 1.3 s, 0.8 M). Blocked: the acceptance ellipsoid (12×9×7 mm
  on 1×1×5 mm) measures 0.45 mm (image) and 0.46 mm / 12.9° (mask) against
  bounds of 0.1 mm and 0.25 mm / 8°. Three slices cross that 14 mm-tall
  shape, so each end lies somewhere in a 5 mm gap the samples do not
  resolve, and the ends are ~15% of its surface: no interpolation of the
  slices alone gets there (a trend extrapolation of the ends was tried and
  made every case worse). The same guess shows on real data: a lesion seen
  in one slice closes as a lens with a sharp rim. The max error on the
  2.5 mm ellipsoid's ends is 1.3 mm (0.49 on the one-grid image path).
  Unblock: a shape prior for object ends — e.g. a variational (thin-plate)
  implicit surface through the slice constraints instead of per-column
  interpolation — owner render lane; pinned by thick-slices.test.ts, which
  fails when the bound is met so this note gets lifted.
- DONE — **F6. Per-pixel shading.** Interpolated normals, Blinn-Phong with a
  soft specular, 2× supersampled edges. Surface goldens re-frozen only after
  the PNGs are looked at. `raster.ts` interpolates the three vertex normals
  and lights each pixel: the old ambient + Lambert terms plus a white
  highlight (0.22, exponent 40), drawn at 2× and box-filtered down. On a
  10×20 lat/long sphere the largest step between neighbouring pixels drops
  from 63 grey levels (per-face) to 8; the highlight peaks at 196 against a
  diffuse maximum of 150 (`raster-shading.test.ts`). Two old defects came
  out: the barycentric weights were paired with the wrong vertices (depth
  was interpolated wrongly all along, invisible under flat shading, seams
  under smooth), and the cull on one normal dropped visible silhouette
  triangles — 12 background pinholes over 24 views of the BraTS tumour, 0
  with the cull on all three. The app orbits at 1× and repaints at 2× 160 ms
  after the last move (`orbitOverlay.ts` holds the tract and cursor
  overlays SurfaceView redraws on both). Skull CT, 117,602 triangles, 560²:
  32 ms per-face → 35 ms at 1×, 98 ms at 2× (median of 15, each vertex
  transformed once, the highlight skipped where it adds under ¼ grey level).
  Surface and atlas goldens re-frozen after old/new side by side; the
  atlas skull's dotted seam cracks are gone.
- DONE — **F7. Ambient occlusion and outlines.** Screen-space AO from the
  z-buffer and silhouette edges, as a post-pass. Accept: a deterministic
  golden, and a crevice phantom darker than its rim.
  `render-cpu/screen-space.ts`, opt-in through `renderMesh({ ao, outline })`
  so every existing render stays bit-identical (goldens unchanged).
  Occlusion is McGuire et al.'s Alchemy estimator: 12 samples on a 5-turn
  spiral in a disc of 10% of the frame, each read back from the depth
  buffer; points above the tangent plane occlude by their cosine, fading
  to nothing at the radius (so a surface far in front casts no halo). The
  spiral turns over a 4×4 tile and a depth-aware blur averages the tile
  out: deterministic, no noise. Estimated once per 2×2 samples. Outlines
  darken the near side of any depth step deeper than 10 pixel widths to
  0.6. Measured (`depth-cues.test.ts`, 160 px): a slot 4 voxels wide and
  3 deep in a slab renders its floor at 134 against a rim of 149 (148 vs
  149 without occlusion), the floor at the wall at 123; a convex sphere
  moves by at most 1 grey level; the crevice golden runs in CI, the skull
  CT one (`skull-ct-cues`) with samples. Screen-space limit, measured: a
  slot deeper than the radius (6×12 voxels) gets no occlusion at its floor
  centre, because its rim is out of reach and its walls face away from the
  view. The app's 3D dock has a Depth cues switch, on by default: BraTS
  tumour mean 131.9 off → 120.8 on. Skull CT 117,602 triangles, 560²:
  32 → 46 ms at 1× (orbit), 95 → 149 ms at 2× (settled).
- DONE — **F8. Volume render quality.** Jittered ray starts refined while
  the view is still (no wood-grain rings), opacity corrected for step size,
  smoother sampling. Accept: a slab phantom rendered at two step sizes has
  the same opacity; unit spacing stays bit-identical when refinement is off.
  `render-cpu/vr.ts`, both opt-in. `alphaStep` corrects each sample to
  α' = 1 − (1 − α)^(step / alphaStep): a 6-voxel slab at 0.1 per voxel
  reads 0.4667 at steps 0.5, 1, 1.5, 2 and 3 (analytic 0.4686; 8-bit
  rounding), where uncorrected it ranged 0.188–0.718. `jitter: { pass, of }`
  starts each ray at a stratified fraction of a step, scrambled per pixel
  by an integer hash, and moves it to its cell of a √of × √of grid in the
  pixel; `addPass` averages. On a shaded ball at step 3, rms against a
  quarter-voxel reference: one lattice 2.12 (the rings), one pass 4.09
  (speckle instead), 4 passes 1.39, 16 passes 0.97; edges gain grey levels
  (3 → 9 on a cube). Interleaved gradient noise was tried as the scramble
  and dropped: without temporal blur it leaves a diagonal hatch. Plain
  calls hash-match the pre-F8 renderer on three configurations
  (`vr-quality.test.ts`). The app renders pass 1 at once and refines to 4
  while nothing changes (any orbit, zoom or control cancels); opacity is
  defined at the full step, 1.5, so full renders keep their look and the
  draft (step 3) now matches it instead of rendering at about half the
  opacity. BraTS FLAIR draft in the app: 2.8 s first pass, 7.4 s for 4.
- DONE — **F9. Volume render speed.** Empty-space skipping (min/max bricks)
  and the image split across workers. Accept: identical pixels to the
  unskipped render; full quality on the chest CT at least 2× faster.
  The largest cost was not the empty space: `sampleTF` copied and sorted
  the stops on every sample, and every trilinear read allocated. The
  raycaster now sorts once per frame (`sampleSortedTF`, the same
  arithmetic) and samples in place. Bricks of 8³ voxels (plus the apron a
  sample reads) keep a value range; a brick whose range cannot reach the
  0.003 opacity the compositor keeps (`maxOpacity`, a hair under the cut)
  is passed over, the ray still stepping through it by the same additions,
  so no sample moves. The app splits a frame's rows, interleaved, across
  one worker per spare core (at most 4, and no more than 768 MB of held
  copies); each worker keeps the field under a key, so refinement passes
  copy it once. Chest CT 512×512×58, full quality (560², step 1.5,
  shaded), one thread, best of 3, pixels hash-identical to the old
  renderer: bone 23.5 → 4.3 s (5.5×), soft 15.9 → 1.9 s (8.4×), lung
  9.2 → 2.9 s (3.2×; no empty bricks there, and skipping costs nothing).
  Skipping alone is worth 5.3 → 4.3 s (bone) and 3.1 → 1.9 s (soft). In
  the app, first full pass: 13.3 s on one worker → 3.0 s on three
  (4.4×, load average 10 on 4 cores); the two screenshots are
  byte-identical. `vr-speed.test.ts`: skip on/off identical over 4 TFs ×
  4 views (steps, jitter, anisotropic spacing, bounds) and random fields
  with NaN; three row shares merge to the whole frame. Fixed on the way:
  a failed volume render in the worker replied without a kind, was read
  as a mesh reply, and never settled.
- DONE — **F10. Cinematic lighting, progressive.** Soft shadows and ambient
  light accumulating while idle, cancelled by any interaction.
  `render-cpu/vr-light.ts`, opt-in (`renderVolume({ cinematic })`, plain
  calls hash-unchanged). The TF turns the volume into extinction per mm,
  averaged onto a grid of at most 2²⁰ near-cubic cells and cached per field
  and TF; light from a direction is propagated through it in one sweep,
  slice by slice from the light (each cell reads the slice upstream,
  bilinear, and leaves its own extinction out so a lit surface does not
  shadow itself; reads are taken one cell toward the light). Each pass
  lights with the headlight jittered inside a 0.14 rad cone (the mean over
  passes is an area light: soft shadows) and two sky directions from a
  spherical Fibonacci set spread over all passes, cosine-weighted by the
  normal (the mean: ambient occlusion). Opacity does not depend on light,
  so averaging the passes' images averages the lighting. Measured
  (`vr-light.test.ts`): a slab's transmittance matches exp(−σ·path) to
  1e-6 straight and oblique; a ball's shadow falls on its plate where the
  headlight puts it, plate 71.9 in it vs 140.3 open (plain: 168.0 both); a
  slot's floor 64.1 vs rim 139.9 (plain 165.9 vs 168.0); rms against a
  64-pass reference 4.76 after 4 passes, 2.04 after 16. Chest CT: grid
  128×128×58 built in 551 ms (once per TF), light sweeps 227 ms a pass,
  a 560² bone pass 3.6 → 4.2 s on one thread. The VR dock's Cinematic
  switch refines over 16 passes (4×4 sub-pixel grid, 32 sky directions),
  pass 1 at once; any orbit, zoom or control restarts it, and leaving
  volume mode now ends it (a late pass could paint over the surface).
  Wire leg 41c: passes accumulate, an orbit restarts at pass 1, the
  surface is not overwritten.
- DONE — **F11. Level of detail.** Quadric-error decimation into an LOD
  chain; the coarse level draws while orbiting, the full one when still.
  Accept: decimated mesh within 0.2 mm of the full one on the phantoms.
  `render-cpu/decimate.ts`: Garland–Heckbert edge collapse, cheapest
  first, stopping where a vertex would stray more than a bound (mm) from
  the original planes it stands for; collapses that pinch (link
  condition), flip a face, or join two border vertices across the inside
  are refused; borders carry heavy quadrics; vertices on non-manifold
  edges, of needle faces (area under 0.02 × longest edge², extraction
  noise on 5 mm slices) and of pieces under 100 triangles stay put.
  `lodChain` snapshots one run at each quarter of the full count. Phantoms
  (sphere, ellipsoid on 0.8×0.8×2.5 mm, torus, box, capsule; image and
  mask surfaces), 16× asked at the app's bound of 0.5: kept 5.5–16× fewer
  triangles, worst distance either way 0.149 mm (torus), under 0.2 on
  all ten (`decimate.test.ts`). Real surfaces: skull CT 117,602 → 66,831
  tris in 1.2 s (the bound stops it: noisy trabecular bone); chest CT bone
  1,463,710 → 424,378 in 16 s; on a slab of it 28 of 365k vertices are over
  0.3 mm, none over 1 mm (worst 0.65 mm; before the needle and small-piece
  locks, whole specks moved over 3 mm). The app decimates on its own
  worker after extraction (surfaces over 100k tris), attaches the level to
  the cached mesh and draws it on 1× orbit frames; the readout says
  `117,602 tris (orbit 66,835)`. Orbit frames at 560² with depth cues:
  skull 90 → 71 ms, chest bone 158 → 90 ms — the rasterizer is mostly
  fill-bound, so fewer triangles buy less than their count suggests.
- OPEN — **F12. 3D → 2D picking.** Click the surface or the volume render
  and the panes jump to that point. Accept: e2e on a real sample lands the
  crosshair inside the clicked structure.
- OPEN — **F13. Clip planes and crop box** for both 3D modes.
- OPEN — **F14. Segmentation outlines** in the 2D panes, a colour per label.
- OPEN — **F15. Slice interpolation for editing.** Paint every few slices,
  fill between with the F5 distance-field interpolation, one undo step.
- OPEN — **F16. Curved reformat, usable.** A centreline tool on the panes,
  a straightened view from `cpr.ts`, e2e on a real vessel or spine series.
