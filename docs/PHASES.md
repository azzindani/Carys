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
- DONE (2026-09-25) — Docker image: this sandbox's daemon could not build
  it (`unshare: operation not permitted`), but CI does on every push: the
  image job builds from a clean tree, runs it locked down (`--read-only
  --tmpfs /tmp --cap-drop ALL`), waits for the HEALTHCHECK, runs
  `test:image` against it, and checks the per-site `connect-src` both ways
  (see Production serving).
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
- DONE — **e2e in CI, on generated samples.** The CI `synthetic` job runs
  `npm run gen:samples` on the fresh runner and then `test/e2e/synthetic.mjs`,
  the legs that read only generated files:
  - the viewer boots on the head phantom (three planes, 7,016 tris);
  - Tab reaches the axial slider in 88 stops and ArrowUp moves it;
  - DICOM→3D: 242,616 tris for bone, 136,892 for skin;
  - the worklist reads "4 of 21 can open here", with a chip on each of the
    other 17.

  The same suite passes on the real set ("21 of 21", 23,708 boot tris), so
  it also runs in `test:e2e`. It fails on an empty `samples/`. The DICOM→3D
  and keyboard legs moved here from wire.mjs.
- BLOCKED — **The rest of e2e in CI.** wire, journeys and geometry read real
  imaging (the liver, covid, cardiac and spine series), and `samples/` is not
  committed. Owner: whoever owns fixture hosting. Unblock: publish a small
  licensed fixture pack that CI can fetch (`samples.manifest.json` already
  names and hashes every file), then run those suites in the synthetic job.
- DONE — **`samples/` has a manifest.** `packages/testkit/samples.manifest.json`
  names the 206 files of a complete set (366.5 MB) with size and SHA-256, and
  for the 155 synthetic ones the npm script that writes them. `npm run
  samples:check` (the first step of `verify`) lists what is missing, short or
  changed, one line per top-level entry with what fills it; on a 7-file set it
  reported "199 of 206 files missing" in 56 lines, a truncated `tiny.ome.tif`
  and a stray file. Under `CARYS_REQUIRE_SAMPLES=1`, `sample()` throws with
  the whole missing set instead of the first name. A unit test holds the
  manifest to every fixture a suite asks for by name.

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
- DONE — **Keyboard navigation is audited** (`test/e2e/keyboard.mjs`, run by
  `audit:a11y`, so in CI). Tab goes round every desktop route: 375 stops over
  8 routes, each on screen, outside aria-hidden/inert and with a visible focus
  change (outline, border, background, colour or shadow on the element, its
  parents, or the sibling an opacity-0 switch input draws on); no positive
  tabindex, no fall to `<body>`, no trap. The `:focus-visible` pass found
  nothing to fix. Its one finding was the audit's own: a border that fades
  in over 110 ms reads as the resting style on the first frame, so
  transitions are finished before each read. Proven to fail: `outline: none`
  on `:focus-visible` gave 331 findings. An e2e leg (landed in wire.mjs,
  now in synthetic.mjs and run in CI): Tab alone reaches the axial slice
  control (88 stops) and ArrowUp moves the slice.
- DONE — **Reduced motion and forced colors.** The reduced-motion rule in
  base.css was already there, but nothing tested it. Under emulated `reduce`,
  nothing animates for longer than 1 ms or loops, including a probe
  animation injected to prove the rule reaches any element (without the rule:
  the status pulse, 2.2 s × infinite). Forced colors (Windows high contrast)
  was broken: the palette swap maps backgrounds to Canvas and drops
  box-shadow, so 9 segmented controls on the viewer showed pressed and
  resting alike, a checked switch looked unchecked, and 5 switches lost
  their focus ring. A forced-colors block in components.css (system colours,
  as `--fc-*` tokens) gives each a cue the palette cannot erase; the scrub
  field's value becomes a Highlight bar under its label. The audit compares
  the colour that shows (the first opaque background up the tree), because
  Chrome keeps the author's alpha, and a transparent button and an opaque
  one both paint Canvas.

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
- DONE — **An e2e leg for DICOM→3D** (landed in wire.mjs, now in
  synthetic.mjs and run in CI). `ct-head-dicom` (`npm run gen:ct`) opens
  through the DICOM lane. The 3D source falls to the image, the Hounsfield
  cut presses the bone preset and extracts 242,616 tris, and the skin
  preset extracts 136,892 at -300 HU. Those are the NIfTI phantom's counts
  (above), so the DICOM lane builds the same volume.
- DONE — **CT surface presets.** `CT_SURFACE_PRESETS` in volume-core
  (skin -300, soft tissue 50, bone 300 HU; bone is autoThreshold's
  Hounsfield default, so the default is a preset) drive a CT segment in the
  3D dock, shown only when the volume reads as Hounsfield. A dragged
  threshold presses none of them. A unit test checks the order and that each
  preset sits inside a head CT's range.

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
- DONE — **The worklist says which studies can open.** `SeriesSpec.gen`
  marks the four entries a generator fills (`gen:phantom` ×3, `gen:ct`). The
  worklist sends one HEAD per entry (`lib/sampleAvailability.ts`); its title
  reads "N of 21 can open here", and a missing row carries a chip with
  `npm run gen:…` or "needs real data". Checked against a server with an
  empty `samples/`: "0 of 21", 4 generator chips and 17 real-data chips; with
  only `ct-head-series/`, "1 of 21". The same run caught missing rows
  showing "335 B", the size of the server's 404 page; a size is now taken
  only from a 2xx.

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
- DONE — **A per-site `connect-src`.** `deploy/start.sh` (the image's CMD)
  renders `CARYS_CONNECT_SRC` into a `/tmp` include that nginx.conf reads,
  then execs nginx; unset, the header is unchanged. Every token must be a
  scheme or an origin (optional `*.`, port, path), or the container exits 64
  before serving. Run locally on the pinned nginx image, locked down
  (`--read-only --tmpfs /tmp --cap-drop ALL`): the default header came out
  byte-for-byte as before, a three-origin list came out exact, and
  `https://x;script-src` stopped the start. CI runs the same two cases on
  the built image, and `test:image` asserts the default. Which hosts a site
  lists is still the deployer's call.
- DONE — **Format decoders load on first use.** Entry 359.7 → 268.5 kB
  (gzip 95.1 kB), with `@carys/io`'s share 83.8 → 9.8 kB (NIfTI, the
  sniffers, SOP names). DICOM, NRRD, OME-TIFF, SEG/RTSTRUCT and the PACS
  client moved to `lib/formatLoaders.ts` and modules reached only through
  `import()`. Moving the calls was not enough: rollup assigns chunks by
  module, so the `SEG_SOP_CLASS` constant kept all of `seg.ts` (and through
  it the dataset parser and every JPEG decoder) in the entry, and `isTiffLike`
  kept all of `ome-tiff.ts`. The sniffers and name tables now live in io
  modules with no imports (`sniff.ts`, `sop-names.ts`, `us-names.ts`).
  `npm run check:entry` (in `ci`) fails on a 300 kB budget or on a decoder's
  string literal in the built entry; proven to fail on a planted SEG
  literal.

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
`claude/3d-fidelity` (merged into main 2026-09-24) with CI green before
the next starts. Accuracy is
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
- DONE — **F5. Thick slices.** Shape-based (distance-field) interpolation
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
  Measured again (2026-09-23, after F16), splitting the acceptance
  ellipsoid's error at its outer slices (12.5 and 22.5 mm): the sides
  between them 0.23 mm (1,084 vertices, image and mask alike), the ends
  0.83 mm (674). No end model can reach the image bound: with perfect
  ends the mean is still 0.14 mm, because three 5 mm slices do not fix
  the sides to 0.1 mm either. Meeting it needs either more slices than the
  scan has or a bound set for 5 mm data; that choice is the owner's.
  Closed on a bound for 5 mm data (the owner's call, 2026-09-25). F2's
  image bound is a tenth of the grid spacing, 0.1 mm on 1 mm, so on 5 mm
  slices the mean error bound is 0.5 mm. Normals are held to 13°, on both
  paths, and each path must still beat its one-grid surface on the same
  samples. Measured: image 0.603 mm / 19.0° → 0.460 mm / 12.2°, mask
  0.685 mm / 21.0° → 0.460 mm / 12.9°. The maximum error goes the other
  way, 1.25-1.59 mm → 2.2 mm: the ends are a guess inside the gap, and the
  mean hides that. thick-slices.test.ts holds the bound.
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
- DONE — **F12. 3D → 2D picking.** Click the surface or the volume render
  and the panes jump to that point. Accept: e2e on a real sample lands the
  crosshair inside the clicked structure.
  `render-cpu/pick.ts`: `pickSurface` finds the nearest drawn triangle
  under the pointer with the rasterizer's own projection and cull (on a
  48×40 frame it hits exactly the pixels `renderMesh` drew, 0 differ; the
  hit on a rotated, zoomed, re-centred sphere is within 0.15 mm of the
  analytic point); `pickVolume` walks the raycaster's ray to where it turns
  half opaque, or its most visible sample (on a ball: the surface to
  0.75 voxel, anisotropic spacing and bounds kept). 7 ms on the skull
  surface, 40 ms on the 1.46 M-triangle chest bone. A tap (under 3 px of
  movement) on the 3D view picks (`views/orbitPointer.ts`, split out of
  SurfaceView with the orbit and pinch handling: 686 → 635 lines;
  `views/pick3d.ts`); a surface is hit on its boundary, so the voxel taken
  is the first of the structure within 2 voxels along the ray (a mask
  label, or above the surface threshold). The panes jump through
  `paintBus.jumpTo`, the one path a 2D tap already took, and the status
  names what was hit: `3D pick on the surface → voxel (123, 134, 133) ·
  value 241 · label 1`. Wire leg 41e on the BraTS tumour: surface and
  volume render both land on label 1, axial pane at the voxel's slice.
- DONE — **F13. Clip planes and crop box** for both 3D modes.
  `render-cpu/clip.ts`: a crop box and a plane, kept together as one convex
  region, so a ray keeps one interval of it and a triangle wholly outside
  one face is skipped by its vertices' outcodes. The rasterizer draws back
  faces while clipping and shades them 0.55× from their own side, the
  inside seen through the cut (a sphere cut at its middle: centre 82 vs
  147 whole; a box around everything: 0 pixels differ; a box away from it:
  all background). The raycaster clips each ray's interval and keeps the
  unclipped sample lattice (a box around the whole volume: same hash, plain
  and jittered passes). Clipped cells cast no cinematic light (a ball
  cropped off the plate it shadowed: shadow patch 71.9 vs 140.3 lit, cut
  away 140.5 vs 140.4). Both picks honour it: through a cut sphere to the
  far wall at z 8.02 (analytic 8), onto a cut ball's face at z 15.96
  (16.5). Cost on a 170 k-triangle shell at 560² 2×: 105 ms whole, 158 ms
  clipped (248 before outcodes); the volume render gets faster, 195 →
  112 ms at 300², its rays shorter. App: `lib/clip3d.ts` keeps the clip
  as fractions of the volume (in mm for the surface, voxels less half a
  voxel for the raycaster, which samples voxel centres), `views/ClipPanel.tsx`
  under the 3D image when the dock's Clip switch is on (plane
  axial/coronal/sagittal, position, keep the far side, crop x/y/z, reset).
  Off, every render is the unclipped one (goldens and atlas hashes
  unchanged). Wire leg 41f on the BraTS tumour, an axial plane at z 124:
  surface 65,314 of 87,696 px drawn, a tap through the cut lands on the
  far wall at z 103; volume render 5,100 of 6,783 px, a tap lands on the
  cut face at z 123.
- DONE — **F14. Segmentation outlines** in the 2D panes, a colour per label.
  `render-cpu/labels.ts`: the labels on a pane's slice (orthogonal; a thick
  slab shows the label nearest its centre; oblique, nearest voxel), a tint
  per label, and each label's outline: the voxel edges with another label
  across, in maximal straight runs, each kept once per side with the side
  its label is on. On multi-label fields in three planes the runs hold
  exactly the brute-force voxel edges (0 missing, 0 extra, none split).
  1.7 ms per slice for BraTS (3 labels, 516 runs), 5.0 ms for the 512×589
  spine MR sagittal (17 labels, 3,652 runs), 4.1 ms for a 512² hepatic
  vessel slice. The panes draw the outline in screen px half a line inside
  its label (`views/paneLabels.ts`: touching labels show both colours at
  every zoom, coronal and sagittal flipped right) over a 0.3 fill that
  leaves the anatomy readable; the seg dock's Outline/Fill switch keeps the
  old opaque fill, bit-identical for a one-label mask (label 1 is the old
  tint). Label colours in `lib/palette.ts`: red, green, blue, yellow, then
  softened primaries and golden-angle hues, none near the crosshair teal
  (BraTS' 1, 2, 4 come out red, green, yellow). A catalog label map now
  keeps its labels instead of being flattened to 1 (a probability map with
  a `segThreshold` is still one mask), so a mask export is the source
  label map value for value (geometry leg D, now checked label for label:
  the liver's 152,211 voxels, labels 1 and 2); the 3D keeps showing the whole mask
  (surfaces already binarized; the volume render and its pick now take
  `maskField`, 0/1). The segments table shows each label's colour. Wire
  leg 41g on BraTS axial 120, fullscreen and zoomed: 553 / 1,140 / 1,526
  px near the label 1 / 2 / 4 colours in Outline, 4,881 / 2,727 / 3,149
  solid in Fill; the table lists L1, L2, L4.
- DONE — **F15. Slice interpolation for editing.** Paint every few slices,
  fill between with the F5 distance-field interpolation, one undo step.
  `render-cpu/slice-fill.ts` replaces the old Interp Z (`editor-seg`
  interp.ts, removed: chamfer distances, the edge on pixel centres, two
  slices at a time, z only, every label flattened to 1). Each painted
  slice is a 2D signed distance map in mm (F5's exact EDT, the edge at the
  pixel midpoints); the maps are joined by a cubic Hermite across all the
  painted slices (tangents from the neighbours either side), never opening
  a hole where both neighbouring slices are painted; a label is filled
  between its own painted slices, labels painted on the same slices that
  overlap are one shape split by which label a voxel is deepest in (a
  label missing from one of them tapers, F5's end closure), and a voxel
  already labelled is never written. The axis is the one whose slices are
  sparsest (strokes offset in the plane leave empty rows too, fewer by
  share). Dice against the truth over the painted range, cubic · linear ·
  old Interp Z:

  | case (1 mm grid) | every 3rd | every 5th | every 8th |
  |---|---|---|---|
  | sphere r15 | 0.990 · 0.990 · 0.988 | **0.983** · 0.979 · 0.979 | **0.967** · 0.948 · 0.960 |
  | ellipsoid 16×8×12 turned 35° | 0.985 · 0.985 · 0.984 | **0.975** · 0.966 · 0.967 | **0.951** · 0.921 · 0.940 |
  | BraTS tumour, whole (labels 1, 2, 4) | 0.962 · 0.963 · 0.962 | **0.944** · 0.942 · 0.942 | |
  | BraTS per label 1 / 2 / 4 | 0.90 / 0.86 / 0.86 | 0.84 / 0.79 / 0.79 | |

  (the old Interp Z cannot keep BraTS' labels at all; filling each label
  alone, before grouping, gave the whole tumour 0.904 at every 5th.) The
  ellipsoid painted across x and z every 5th slice: 0.977, 0.975; across
  its 16-slice-thin y, every 3rd: 0.978 (every 5th leaves 4 painted slices
  and its ends are guesses: 0.939, F5's thin-end limit). Nested core and
  shell 0.983 whole, 0.964 / 0.977 by label; 0.5 × 1 mm pixels 0.987; two
  structures painted apart fill 0.960 each and nothing between them. BraTS
  at every 5th: 62 ms (the old op 174 ms). App: the seg dock's Interp runs
  it, one undo step, and says what it did (`interp: 548 → 1,591 vox · 5
  axial slices · label 1`), or why nothing was filled. Two bugs on the way
  kept the workflow from being possible: every bump (a paint stroke's end)
  sent the panes back to the series' opening slices, and undo landed one
  edit too far back (edits snapshotted the mask before changing it, the
  stack wants the state after). Journey A2 on BraTS: strokes on axial 60
  and 66, Interp fills 61–65 (slice 63: 0 → 121 px of label colour), one
  undo takes the fill back, the next the second stroke only.
- DONE — **F16. Curved reformat, usable.** A centreline tool on the panes,
  a straightened view from `cpr.ts`, e2e on a real vessel or spine series.
  `render-cpu/cpr.ts`: `straightenedCpr` replaces `curvedReformat` (a
  polyline in voxels, 128 columns whatever the length, across always in
  the axial plane). The clicks become a centripetal Catmull-Rom spline in
  mm (ends extrapolated on the parabola through the last three clicks; a
  mirrored end straightened the end segments, 0.63 mm off an arc), sampled
  every finest-voxel mm along and across, so the image is millimetre-true
  on any voxel; across is perpendicular to the curve and to the pane it
  was drawn on, turned about it by Rotate; `cprVoxel` maps a pixel back.
  A 6 mm tube bent on a 120° arc (R 30 mm, 0.8 × 0.8 × 2 mm voxels), five
  clicks: length 62.73 mm against 62.83, every station within 0.14 mm of
  the arc (the clicks' polyline: 1.02 mm), the band 0.38 mm off the middle
  row where 61 points on the exact arc give 0.41 (the voxelized tube's
  floor; the polyline 0.98). 1.6–4.4 ms for a 196 mm curve on the
  243×243×127 spine CT. App: a Curve tool in the tool strip (a tap adds
  the voxel under it), the curve drawn on every pane (the same path the
  view follows, clicks filled on their own slice), and the straightened
  view under the 3D image with Width and Rotate, ticks at the clicks, Undo
  point and Clear curve; a tap on it moves the panes to the voxel under it
  and says its value and label. Wire leg 41h on the spine CT: the six
  whole vertebral bodies on sagittal 118 clicked (each label's largest
  blob, at least a quarter of the biggest: the top one, cut by the edge of
  the volume, is left out), 153.6 mm; taps at the six ticks on the middle
  row land on labels 17 → 18 → 19 → 20 → 21 → 22, and the same after a
  90° turn.

## Body atlas, motion and microbiology (queued 2026-09-23)

A whole-body anatomy atlas by body system, a rigged skeleton that moves,
and pathogens from their structures, on the CPU renderer (no WebGL), for
education (not diagnosis). Data is CC BY only: CC BY 4.0 or CC0, never
share-alike, non-commercial or no-derivatives; every asset is wrapped into
the repo under `digests/` with a `SOURCES.json` and a `DIGESTS.json` row,
and its attribution shown where it is used. One item per delivery, in
order, each with its tests, docs and measured numbers, pushed on `main`
with CI green before the next (H1–H2 landed on `claude/body-atlas`,
merged into main 2026-09-24; work is on main only since).

- DONE — **H1. Whole-body data package.** `scripts/build-body-atlas.mjs`
  fetches BodyParts3D 4.0 (the IS-A mesh set, obj_99: 2,234 element
  meshes, a superset of the PART-OF set's 1,258 that adds the muscles,
  their heads, the tendons and the teeth; CC BY 4.0), assigns every
  element to a body system, decimates each (F11 QEM) and packs one compact
  binary per system (`render-cpu/body-pack.ts`, `carys-body/1`: u16
  positions on the body's grid, padded 5 mm, u16/u32 indices, a header of
  parts with FMA id, name, system and measured error) into
  `digests/bodyparts3d-body/`, read by the pure `unpackBody`.
  The system comes from the element's own concepts: its IS-A ancestry
  says what tissue it is (bone organ, muscle organ, a segment of an
  arterial tree), its PART-OF ancestry which organ system holds it
  (PART-OF alone leaves 198 bones and muscles in no system and has no
  muscular system); name rules place what the trees do not (the male
  genitalia, the larynx membranes, sets of small muscles, plural "veins").
  Nothing is left unassigned. Each part is decimated as far as a 0.5 mm
  distance to its source allows, both ways, measured on the quantized
  mesh (`render-cpu/mesh-distance.ts`, the decimation tests' measure,
  moved out of the test helpers), trying looser bounds first.
  Measured: 6.44 M source triangles → **1,943,916** (skeletal 373 parts,
  346,960 · muscular 383, 869,402 · nervous 147, 123,078 · cardiovascular
  1,057, 359,430 · digestive 110, 103,104 · respiratory 105 · sensory 31 ·
  reproductive 12 · urinary 6 · integumentary 4 · lymphatic 3 · endocrine
  3), **22.39 MB**, worst part **0.500 mm** from its source (per system
  0.29–0.50). Every one of the 2,234 elements present once; the format
  round-trips, moves no coordinate more than half a step (at most
  0.013 mm: the body is 1.74 m tall over 65,535 steps), fails loud on bad
  bytes. The whole body
  draws in 418 ms at 360×900 on one CPU thread (skeleton 69 ms). The
  licence page grants CC BY 4.0; the OBJ files still carry the older CC
  BY-SA 2.1 JP header, recorded in the DIGESTS.json row's licence note.
  Build: 6.5 min, the same bytes every run. (Rebuilt in H2: the liver's
  24 parts — its Couinaud "hepatovenous" segments, the caudate lobe, the
  biliary tree — had landed with the vessels; each element is now named by
  its most specific concept, "body of sternum" not "body of organ"; the
  index lists every part.)
- DONE — **H2. The body by system in the Atlas.** The whole body in the
  Atlas route with system toggles (skeletal, muscular, nervous,
  cardiovascular, respiratory, digestive, urinary, reproductive,
  endocrine, lymphatic, sensory, skin), LOD while orbiting, a tap names
  the structure (FMA card), search isolates and frames it, hide/show.
  Accept: e2e taps land on the named structures (femur, heart, liver,
  brain); orbit and settled frame times measured on the full body.
  The Atlas route gains a Bones | Body switch. Body
  (`views/BodyAtlasView.tsx`, `lib/bodyAtlas.ts`) has a switch per system
  with its part count and tint (muscle and skin start off: they cover the
  rest) and fetches a system's file the first time it is shown. The parts
  go to the renderer's frame and merge into one mesh that knows each
  triangle's part (`render-cpu/body-scene.ts`); `renderMesh` takes a
  colour per triangle (`triColor`; without it every render is
  bit-identical, and a test draws the same pixels both ways) and
  `pickSurface` returns the triangle it hit. Drag, sliders, wheel and
  pinch orbit and zoom. Moving frames are drawn at half size, one sample a
  pixel, on a vertex-clustered copy (cells of two of those pixels, 8 mm at
  zoom 1). Clusters split by part and by normal octant: without the octant
  a thin shell's two sheets merged and the skin came out spotted. The
  full mesh at 2×2 samples follows 250 ms after the last move. A tap
  lights the structure in the accent and opens a card: name and FMA id,
  what it is part of (the K1 PART-OF concepts holding it, smallest first;
  the 976 IS-A-only meshes, the ventricle wall among them, are in none,
  and the card says so), system, and its mesh against the source. Find
  (`volume-core/body-search.ts`) takes a name, FMA id or element id. A K1
  concept brings all its pieces ("heart": 83); their systems are switched
  on and they are isolated and framed (their box's diagonal across 0.8 of
  the frame at any orbit). Hide drops the tapped structure; Show all
  brings everything back.
  Wiring the taps exposed two H1 faults, fixed by rebuilding the digest.
  The liver's 24 parts were filed with the vessels (the "hepatovenous"
  segments matched the vein rule). Elements were named by the first of
  several equally small concepts ("body of organ" for the body of the
  sternum). `index.json` now lists every part, so Find needs no system
  file.
  Measured (wire leg 34b, one CPU thread):
  - Taps name the right femur (FJ3365, FMA24474), the right superior
    frontal gyrus (… › brain), the wall of the right atrium (… › heart)
    and hepatovenous segment VIII (… › liver).
  - Hiding that segment, the same tap finds the left portal vein behind
    it.
  - "heart" isolates 83 structures, and a tap at the frame's centre lands
    on one of them (the cavity of the right ventricle).
  Frame times over three runs of the leg (load average 6–7 on the 4 cores):
  - The opening view (10 systems, 1,003,549 triangles) settles in
    **267–472 ms**.
  - The full body (12 systems, 1,943,916 triangles) settles in
    **637–736 ms**; moving frames take **106–131 ms**, on 719,430
    triangles.
  - The clustered copy is made once per shown set and zoom step, on the
    first moving frame: 575–632 ms for the full body.
  - Half-size frames of the full body, median of 5 in one run: unclustered
    206 ms; 4 mm cells 155 ms (1.07 M triangles); 8 mm 80 ms; 16 mm 78 ms.
    Past 8 mm, fill, not triangles, is the cost.
  - axe finds nothing in Body mode, desktop or mobile.
- DONE — **H3. Lymphatic layer from the HuBMAP reference organs.** Lymph
  nodes, spleen, thymus and the organs BodyParts3D lacks, from the HRA 3D
  reference objects (GLB, CC BY 4.0), placed in the BodyParts3D frame by
  a fit on the organs both have. Accept: after the fit, the shared organs'
  surfaces within 5 mm mean of each other; each added organ attributed.
  Landed: `render-cpu/glb.ts` reads the GLBs (node transforms applied;
  Draco, sparse accessors and non-triangle primitives refused) and winds
  each piece outward, judged about the piece's own centre: half the lung
  and cord segments face in, and the cord's are tubes open at both ends.
  `render-cpu/organ-fit.ts` has area-uniform surface samples, a k-d tree
  whose subtree boxes prune far queries (3.9 ms → 0.4 µs a query), Horn's
  similarity, ICP (one way where the HRA model covers part of its match),
  a field that blends the anchors' fits by 1/(d² + 5²)², an inside test
  and `holeCentre`. `scripts/build-body-hra.mjs` builds
  `digests/hra-organs/` from 25 HRA organ datasets (18 used only as
  anchors, 7 added; Visible Human male, CC BY 4.0, pinned versions, each
  cited in `SOURCES.json`; mesh names from the HRA crosswalk at a pinned
  commit). There are 40 anchors: 19 organs
  and bones both bodies have, plus 21 intervertebral disks. Each is fitted
  by its own ICP, started from one similarity on all of them (scale
  0.9453), then bent the rest of the way (`render-cpu/organ-warp.ts`,
  below). Spleen and thymus are anchors, since BodyParts3D has them. Added:
  three lymph-node models, both palatine tonsils, the lung's 20
  bronchopulmonary segments, the spinal cord's 30 segments and the
  transverse colon's epiploic appendages. That is
  **71 parts, 40,382 triangles, 0.38 MB**, worst 0.451 mm from the placed
  source, on the H1 body's grid. The disks set the cord's heights. Placed
  by the field alone, 20% of the cord's vertices lay inside bone, all from
  C1 to T2 (the spines curve differently). Each of BodyParts3D's 24 vertebrae gives its canal
  centre (clearance 7.5–13.0 mm), and the cord moves across onto that
  line, by up to 16.0 mm. `lib/bodyAtlas.ts` merges both digests (2,305
  structures). A tapped HRA structure's card cites its organ (authors,
  version, DOI, CC BY 4.0) and how it was placed, and the footers
  attribute both sources. Find reaches the new rows ("lung", "lymph
  node", "palatine tonsil").
  The bend (unblocking this item, 2026-09-25): a similarity cannot take
  one body's bowel loops, its bronchi's branching angle or its knees'
  flexion onto another's, so each anchor's similarity is followed by a
  smooth, one-to-one bend. It is a composition of 16 small steps, one per
  round of non-rigid ICP (pairs both ways, the worst 10% dropped): each a
  sum of Wendland's compactly supported C² functions on nodes spread over
  the organ (radii 96 then 48 mm, nodes a third of that apart), weights
  by least squares with the kernel norm as smoothness (λ = 1, the motion
  coherence of coherent point drift), solved by conjugate gradients. A
  step's gradient is capped (Frobenius 0.5 at every sample), so no step,
  and no bend, folds; a bend is exactly zero past its radius, so it moves
  nothing far from its organ. Added organs follow the anchors' bends
  through the same blend. One setting for all 40 anchors: the coarsest
  that meets the bound. Finer (a 24 mm level) or looser (λ 0.05) bends
  fit the bowel to 2 mm, but only by squeezing its surface flat.
  Measured:
  - Each anchor's own fit (mean surface distance, both ways; one way for
    the liver and knees, whose HRA models cover part of their match), by
    its similarity then bent: **all 40 within 5 mm, worst 4.07 mm** (the
    third cervical disk). The five that failed before: main bronchi
    7.15 → 2.58, jejunum and ileum 10.64 → 3.68, colon 11.22 → 3.28, left
    knee 5.83 → 2.06, right knee 5.76 → 2.16 mm. The rest: kidneys 0.79
    and 0.91, spleen 1.38, liver 1.64, pancreas 1.69, bladder 0.72,
    thymus 1.58, pelvis 1.74, heart 1.90, trachea 1.28, larynx 0.79,
    submandibular glands 1.27 and 1.22, duodenum 1.32; disks 0.57–4.07.
  - One-to-one: the Jacobian's determinant is positive at every tenth
    measure sample of every anchor. Outside the bowel it stays at 0.28 or
    more (the heart's least), the disks at 0.69 or more. The bowel's
    reaches 0.03 (jejunum and ileum) and 0.08 (colon), 0.10 and 0.16 at
    the 5th percentile: the two bodies' loops do not correspond, so the
    bend packs HRA's tangle into BodyParts3D's. Its 3.7 mm says the two
    fill the same space, not that loop meets loop. The largest move is
    40.6 mm (the colon).
  - Leave one out (an anchor placed from the others, as an added organ
    is): median 6.36 mm with the similarities, 6.17 mm with the bends,
    from 1.41 mm (a thoracic disk) to 65 mm (the knees, far from every
    other anchor). The bends fit each shared organ; they do not predict
    an organ from its neighbours much better (duodenum 10.68 → 7.17, colon
    19.74 → 18.96 mm).
  - The digest tests check the placement: every anchor bent within 5 mm
    and positive Jacobians, no cord vertex inside a vertebra, and no added
    organ's vertex outside BodyParts3D's skin (its reach per 5 mm of
    height and 5° sector).
  - The epiploic appendages (left out before, as the colon fit to 11 mm)
    now follow the colon's bend and lie inside the skin. The omentum stays
    out. It is an apron in front of the bowel with no anchor under it:
    6.9% of it lay outside the skin placed by the similarities (up to
    22 mm), and 1.7% (up to 15 mm) with the bends.
  - The H5 rig was refitted to the new digest pin
    (`HRA-ref-organ-VHM-2026-06-bent`): only the HRA weight files and the
    counts changed (1,642,483 soft vertices). The BodyParts3D weights and
    every joint are byte-identical, and H6's slips and muscle lengths hold.
  - Build: 26 min, the same bytes every run.
  - Wire leg 34b: a tap on the right chest names the right anterior
    bronchopulmonary segment and cites the HRA lung; a "lymph node" find
    isolates 12 structures and a tap names the capsule of a lymph node
    (cited); with the lungs off the heart and liver taps land as in H2.
    The opening view (1,043,931 triangles) settles in 392–446 ms, the full
    body (1,984,298, now checked against both digests' own totals) in
    657–661 ms, and moving frames take 94–95 ms on 736,475 triangles.
    geometry.mjs passes.
- DONE — **H4. See-through layers.** Order-independent transparency in
  the rasterizer (weighted blended) with an opacity per system, so nerves
  and vessels show inside muscle and skin. Accept: an inner sphere seen
  through a 50% shell within 2 grey levels of the expected blend; opaque
  renders bit-identical (goldens unchanged).
  `renderMesh` takes `triAlpha`, an opacity per triangle. Opaque ones
  draw first, exactly as before. See-through ones draw after, hidden by
  the opaque depth but not by each other. Each adds its colour weighted by
  opacity × max(0.01, 3e3·(1 − d)³), d its depth across the scene
  (McGuire & Bavoil 2013), and the opaque colour behind shows by the
  product of their transparencies. No sorting.
  A see-through surface draws its front faces only, by screen winding.
  The opaque cull keeps a triangle while any vertex normal faces the
  viewer, so at a silhouette some of the back sheet survives. Behind the
  front that is hidden when opaque, but blended it doubled the layer: the
  first measure was 21 grey levels off on the shell's rim.
  `pickSurface` takes the same opacities: a tap goes through see-through
  layers to the opaque surface they show, and lands on a see-through one
  only where nothing is behind it. The Body dock has a See-through system
  picker and an Opacity slider (0.1–1), and the readout lists what is
  see-through.
  Measured:
  - A grey sphere through a 50% shell against the two drawn alone and
    mixed half and half: every one of the 5,184 pixels within **1** grey
    level (4,056 exact).
  - Layers in another triangle order are within 1 level of each other.
  - Opaque renders are byte-identical to the previous rasterizer: a
    sphere with every option (AO, outlines, clip, 1× samples, zoom and
    centre) and the body's 956,548 triangles, settled and clustered. An
    opacity of 1 everywhere is identical too. The goldens are unchanged.
  - The full body (1,982,505 triangles) at 480×800, one thread, median of
    5 at load average 19 on the 4 cores: 849 ms opaque, 1,239 ms with skin
    and muscle at 30% (940,367 triangles see-through). Moving frames on
    the clustered copy take 249 and 214 ms, within the noise.
  - Wire leg 34b: with skin and muscle at 30%, set by keys on the slider,
    a tap on the thigh names the right femur through both. The full body
    settles in 1,028 ms see-through and 880 ms opaque; moving frames take
    124 and 128 ms. geometry.mjs passes unchanged.
- DONE — **H5. A rigged skeleton.** A joint hierarchy (spine, neck,
  shoulders, elbows, wrists, hips, knees, ankles), joint centres fitted
  from the bones (a hip at the femoral head's sphere fit), bones rigid,
  muscles and skin skinned to them; pose by joint angles. Accept: the
  rest pose renders bit-identical to H2; bone lengths constant under any
  pose (under 0.01 mm); the hip centre within 5 mm of the femoral head
  fit; muscle ends stay on their bones (within 2 mm).
  `render-cpu/rig.ts` has the fits, the pose, the skinning and the weights
  file; `mesh-grid.ts` tests a segment against a surface.
  `scripts/build-body-rig.mjs` builds `digests/body-rig/` from the two
  body digests (CC BY 4.0, cited at their pins) in about 1.5 min,
  deterministic.
  - Segments: 234 bones in 25 segments by a rule per segment: the pelvis
    (the root), each lumbar vertebra, the trunk (thoracic spine, ribs,
    sternum, shoulder girdle), C3–C7 each, the head (skull, C1–C2, hyoid,
    teeth), and on each side upper arm, forearm, hand, thigh (with the
    patella), shank and foot. A skeletal part with a bone's name that no
    rule places fails the build. The cartilages, ligaments, disks and the
    back muscles BodyParts3D files as skeletal are soft.
  - 24 joints: the spine is spread over its 6 disks from L5/S1 to T12/L1,
    and the neck over 6 from C7/T1 to C2/C3, a sixth of the angle each.
    The rest are sphere fits to where two bones meet:
    - hips on the femoral heads: r 23.2 mm, rms 0.60 and 0.43 mm;
    - shoulders: r 20.0 and 19.2 mm, rms 0.49 and 0.45 mm;
    - wrists on the scaphoid and lunate: r 16.7 and 17.5 mm, rms about 1 mm;
    - ankles on the talar domes: r 22.0 and 19.6 mm, rms 1.6 and 1.4 mm.
    The elbow is a circle along the hinge on the ulna's trochlear notch
    (r 14.6 and 13.9 mm, rms 2.6 and 2.5 mm). The knee is the midpoint of a
    sphere on each posterior femoral condyle (r 16.4–18.2 mm, rms 1.5 mm);
    where femur and tibia meet is too flat to fit (the circle came out at
    9 mm to 680 m).
  - Joint angles are flexion, abduction and twist, signed anatomically
    (knee, elbow and ankle are hinges; the wrist also takes radial
    deviation). A child segment turns about its joint in its parent's
    frame.
  - Weights: 1,641,572 vertices of every other part follow their three
    nearest segments by 1/d⁴. A muscle vertex within 1 mm of a bone is an
    attachment and follows that bone alone (268,932 of them).
  - Straight-line nearness was not enough. The inner arm's skin is nearer
    the ribs across the armpit than its humerus, so raising the arm
    dragged a sheet of skin from the flank; the thighs beside the hanging
    hands followed the hands. So a vertex counts no bone it could reach
    only by crossing the skin's outer sheet (6,780 follow a farther
    bone). A vertex that sees no bone at all takes its part's nearest
    sighted vertex's weights (4,430 muscle vertices poking out through
    the skin). The skin's weights are then averaged with its neighbours'
    8 times.
  - Two rules were tried first and dropped. "Only bones behind the
    surface" broke every closed muscle, whose underside faces its own
    bone, and the skin's inner sheet. A 2× distance guard on it brought
    the flank flaps back.
  - The weights are 8.24 MB in 15 files, fetched with the first pose.
    `lib/bodyRig.ts` refuses a rig fitted to other digest pins. The Body
    dock has a Pose joint picker, a slider per angle it takes, and Rest.
  Measured:
  - Rest pose: every part of both digests comes back bit for bit (an
    unmoved segment leaves its vertices as they are, and the app draws the
    unposed parts), so the atlas renders as in H2.
  - Bone lengths under a pose bending every joint: the largest change is
    **0.00011 mm** over the 234 bones (float32 rounding).
  - The hip centres lie **2.44 and 1.88 mm** from the acetabula's own
    sphere fits, left and right.
  - Muscle ends: all 268,932 lie within 1.00 mm of their bone at rest, and
    under the bent pose they leave it by at most **0.00007 mm**.
  - Posing all 1,737,889 vertices takes 215 ms in node. In the app, the
    first pose (rig and weights fetched) comes back in 0.7–1.4 s, and the
    full body settles in 0.5–0.9 s.
  - Wire leg 34b: the right shoulder abducted 90° by keys on its slider,
    and a tap beside the body that missed at rest lands on the raised
    arm's skin. The full body posed settles in 490 ms, and Rest brings the
    miss back. geometry.mjs passes unchanged.
  - Screenshots checked: a step with the arm raised (skeleton, muscle,
    skin) and arms out with the head turned. What is left is linear blend
    skinning's own stretch at the armpit, and the BodyParts3D muscles
    that show through its skin at rest too.
- DONE — **H6. Motion playback.** BVH import retargeted onto the H5 rig,
  walk and run from a CC BY motion source (CMU mocap is not CC BY; if no
  CC BY source exists this item is Blocked), muscles coloured by how far
  they stretch. Accept: feet slip under 2 cm per gait cycle in contact;
  a muscle's length over the cycle deterministic and pinned.
  The source is two gait data sets by Fukuchi, Fukuchi and Duarte on
  figshare, both CC BY 4.0 (checked against each record by the build):
  - running, 2017, 10.6084/m9.figshare.4543435.v5: treadmill running at
    3.5 m/s, 39 subjects;
  - walking, 2018, 10.6084/m9.figshare.5722711.v6: treadmill walking at
    each subject's comfortable speed (trial T05, 1.23 m/s on average), 51
    subjects.
  Other sources were ruled out: the CMU and Bandai Namco sets (the latter
  CC BY-NC-ND) are not CC BY, and a CC0 re-upload of CMU does not change
  CMU's terms.
  `scripts/build-body-gait.mjs` builds `digests/gait-motions/` (40 KB),
  deterministic:
  - Each subject's hip, knee and ankle angles over a normalised gait
    cycle are averaged across subjects. The data use ISB axes: Z flexion,
    X adduction, Y rotation. Flexion of all three joints and the hip's
    ab/adduction are kept. The rotations carry marker offsets of up to 25°
    (the knee's Y sits near −22° all cycle) and are left out, as are the
    pelvis and the upper body, which the data do not have. The arms
    therefore hang still.
  - The cycle's duration comes from the heels' fore-aft swing on the
    treadmill in 10 subjects' marker trials: 1.037 s walking, 0.700 s
    running. The left side's phase is 0.505 and 0.500 of the cycle.
    Contact is where the mean vertical ground force exceeds 0.5 N/kg:
    walking has 23 frames of double support, running 41 of flight.
  - The walking archive's members are read by byte range (not the 690 MB
    zip), with figshare's short-lived signed links followed afresh for
    each read.
  - Written as BVH (`walk.bvh`, `run.bvh`: Hips and three joints a leg,
    100 frames).
  - On the H5 body, the root's Y channel carries the rise and fall that
    sets the feet in contact on the ground, with a ballistic arc through
    running's flight. Its X and Z channels carry the move across the
    ground that keeps grounded sole points planted, less the cycle's mean
    velocity, so the cycle loops in place.
  `render-cpu/bvh.ts` reads any BVH hierarchy and channel order.
  `retargetFrame` splits each mapped joint's rotation into the rig
  joint's flexion, abduction and twist axes (`anglesAbout`, exact on
  either axis handedness) and measures what a hinge drops.
  `render-cpu/gait.ts` has `groundRoot`, `plantRoot`, `footSlip`, the
  muscles' ends (their H5 attachment groups on two segments, farthest
  apart) and lengths, and `stretchColor`. The Body dock gains Motion
  (none, walk, run), Play, a Cycle % slider and a Stretch switch (blue as
  a muscle shortens, yellow as it lengthens, fully at 15%). Playback shows
  the frame real time has reached, so the cycle keeps its speed however
  slowly frames draw. The data sets are cited under the canvas whenever a
  motion is on.
  Measured:
  - Foot slip on the H5 body, the largest move across the ground of a
    sole point while its foot is in contact and the point lies within
    10 mm of the ground: walking **3.9 and 3.7 mm** a cycle, running
    **4.3 and 4.6 mm** (bound 20).
  - Played with the root at the subjects' speed scaled by height, the
    feet slid 116 and 139–162 mm a cycle. The mean angles on this body's
    proportions make a shorter stride; hence the planted root. That root
    moves the body at 1.21 m/s walking (1.27 scaled) and 2.84 m/s running
    (3.42 scaled).
  - Muscle lengths over the walking cycle, pinned in the digest test at
    0/25/50/75% and the same on every run (rest in brackets):
    - biceps femoris long head: 461.5 / 437.5 / 423.1 / 417.3 mm (430.7),
      longest at heel strike with the hip flexed and the knee straight;
    - rectus femoris: 477.2 / 496.5 / 503.2 / 501.9 mm (495.6);
    - gluteus maximus: 223.2 / 214.5 / 202.0 / 220.9 mm (207.9);
    - tibialis anterior: 304.3 / 297.0 / 292.5 / 307.2 mm (306.4).
    Running stretches the hamstring further (−11.5% to +8.5%).
  - Wire leg 34b: walking is picked (and cited), stepped to 25% by keys,
    coloured by stretch, then played; real time moves it on (from 25% to
    13% in one run, past the cycle's end). The full body walking settles
    in 457 ms.
  - Wire leg 41d (the skull CT's level of detail) read its readout twice
    and could catch a later extraction's "extracting…"; it now keeps the
    text it matched.
- DONE — **H7. Whole virus capsids.** mmCIF biological assemblies
  expanded from their symmetry operators, and a coarse-grained level
  (per residue, then per chain) so million-atom capsids render on the
  CPU. Accept: the expanded atom count equals the RCSB assembly's; every
  copy within 0.01 Å of its operator image; render time measured at 1 M
  atoms.
  - `digests/rcsb-capsids/`: seven icosahedral capsids from the PDB
    (CC0), each the asymmetric unit exactly as RCSB serves it (1.43 MB of
    .cif.gz, sha256 recorded), built by `scripts/build-capsids.mjs`
    (35 s from cache): SV40 1SVA (T=7d), Norwalk virus 1IHM (T=3),
    poliovirus 2PLV and rhinovirus 14 4RHV (pseudo T=3), hepatitis B core
    1QGT (T=4), phage MS2 2MS2 (T=3) and satellite panicum mosaic virus
    1STM (T=1, an entry whose assembly takes 12 operators on 10 chains).
  - Atom counts: every expansion of assembly 1 equals RCSB's
    `rcsb_assembly_info.atom_count` — 958,980 / 677,040 / 429,720 /
    392,520 / 273,600 / 183,900 / 67,596 (ligands and waters counted as
    RCSB counts them). The build fails otherwise; the unit test pins them.
  - Operator images: the build compares every atom of every copy with
    RCSB's own expanded file (`-assembly1.cif.gz`, chains "A", "A-2", …):
    the largest distance is 0.0007–0.0009 Å per entry, the 3-decimal
    rounding of that file. Each copy's first and last atom there are in
    `capsids.json`, and the unit test holds all 2,340 copies to them
    within 0.01 Å (and every copy's matrix to a rotation within 1e-3:
    1IHM's operators are deposited orthonormal to 4.5e-4).
  - Levels: a bead per polymer residue and per polymer chain at the
    volume of its atoms (1.57 Å·∛n, protein density). SV40: 958,980 atoms,
    123,420 residue beads, 360 chain beads (the VP1 pentamers show as
    rings of five).
  - Render time, SV40 at 640×560 on the shared 4-core host (load 3–5,
    two runs), `render-cpu/spheres.ts`: atoms 121–183 ms (227–279 ms with
    occlusion), residue beads 42–59 ms (96–112 ms), chain beads 18–28 ms
    (58–74 ms), printed by the digest test. In the app the settled frame
    (atoms with occlusion) took 273 ms; while turning, Auto draws residue
    beads.
  - Wire leg 30d: the Protein route's Capsid mode opens SV40 (settled
    atoms in 271 ms), a tap names the copy ("chain D-34 · … · GLU 72 ·
    operator 34 of 60"), turning by keys draws residue beads (123,420 in
    49 ms), then chain beads and 1STM, and the Model mode comes back.
- DONE — **H8. A microbiology library.** Cards for virus families and
  bacteria (structure, genome, morphology, Gram stain, examples), written
  here or from CC BY/CC0 sources, each linked to its PDB structures and
  to Learn. Accept: every card names its source and licence; e2e opens a
  card and its structure.
  - 11 cards in `volume-core/microbes.ts`: five virus families
    (Picornaviridae, Caliciviridae, Polyomaviridae, Coronaviridae,
    Hepadnaviridae) and six bacteria (*E. coli*, *S. aureus*,
    *V. cholerae*, *C. botulinum*, *B. anthracis*, *M. tuberculosis*),
    each with structure, genome, morphology, Gram stain (acid-fast for
    *M. tuberculosis*; "not applicable" for a virus) and examples.
  - Sources and licences, named on every card: four family cards are
    adapted from their ICTV Virus Taxonomy Profiles (J Gen Virol, CC BY
    4.0, read in full from Europe PMC); the other seven are written here
    (MIT). Two candidate sources were checked and refused by the licence
    rule: the Hepadnaviridae profile (CC BY-NC 4.0 at Crossref) and
    OpenStax Microbiology (CC BY-NC-SA 4.0 at OpenStax).
  - `scripts/build-microbes.mjs` checks all 17 references on every
    build: the four DOIs' CC BY 4.0 licence and first author at
    Crossref, the 13 PDB entries' first authors at RCSB, and that each
    bacterial entry's source organism is its card's species. It vendors
    the six bacterial entries as RCSB serves them (1.3 MB:
    2OMF OmpF porin, 7AHL α-hemolysin pore, 1XTC cholera toxin,
    3BTA botulinum neurotoxin A, 1ACC anthrax protective antigen,
    1ENY InhA, the isoniazid target) into `digests/microbe-library/`,
    and `library.json` records the checks.
  - Links: 14 structure links (five H7 capsids open in the Protein
    route's Capsid mode; three M1 pathogen entries and the six bacterial
    entries in its Model mode) and four Learn bundles. The
    study test holds every link to an existing structure, cited on its
    card, and every bundle to `bundles.ts`.
  - Wire leg 30e: the Picornaviridae card names its CC BY source and DOI
    and opens 2PLV in the Capsid mode (429,720 atoms, settled in 385 ms
    at load 6); the *V. cholerae* card (Gram-negative, written here, MIT,
    PDB 1XTC CC0) opens cholera toxin in the Model mode (5,997 atoms);
    the Coronaviridae card's bundle link selects ace2-entry. The bundles'
    own Open structure still lands 1QGT (leg 21).
