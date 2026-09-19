# Digest → port log (CPU-only cuts)

Digest = read for interface/pattern, re-implement against volume-core. No forks.

1. **Papaya + Daikon + NIFTI-Reader-JS** → `volume-core/overlay.ts` (base+overlay
   min/max/opacity, `compositeRow`), `measure` ruler/angle/ellipse, io uses
   pako inflate pattern. Pure-JS orthogonal viewer proves Canvas2D MPR works.
2. **NiiVue + CACTAS** → format coverage list kept as `DataSourceKind`;
   drawing extension → `editor-seg/ops.ts paintBrush`. Skipped WebGL2 path.
3. **Cornerstone3D + @itk-wasm/dicom** → `volume-core/tools.ts` (ToolName,
   ToolGroup, ToolJob worker contract), `defaultToolGroup`. Skipped VTK/GPU,
   kept `readImageDicomFileSeries` series-sort pattern in `io/dicom.ts`.
4. **VolView** → `volume-core/layer.ts` (Layer + DataSource + LinkedView
   4-pane shared center). Skipped cinematic VTK path.
5. **Viv/vizarr** → `io/omezarr.ts` (tileKey, OmeZarrStore + LRU) +
   `volume-core/cache.ts` (LruChunkCache, compositeChannels on CPU).
   Replaced deck.gl layer with CPU slicer.
6. **Neuroglancer** → 4-pane linked navigation pattern (`LinkedView`),
   datasource abstraction (`DataSource`), frontend-UI + backend-Worker split.
7. **Mol* / pdbe / rcsb** → `volume-core/sequence.ts` (ResidueRef, bundle,
    residuesToSelection) + `io/pdb.ts` minimal ATOM parser + `io/cif.ts`
    minimal atom_site loop (own tokenizer; PDB≡CIF equivalence tested;
     view sniffs content, not extension) + `superpose.ts`,
     `loci.ts`, `molql.ts`, `theme.ts`, `target.ts`, `embed.ts`.
     molql string subset added after the loop (`parseMolQuery`: chain/resi/
     atom/element conjunction over the same AtomTest; full grammar deferred).
8. **NGL** → `volume-core/protein.ts` (10 reps + defaults, Jmol/sstruc colors,
   RadiusFactory). CPU projection, not ray-cast impostors.
9. **igv.js + jbrowse + gosling** → `volume-core/tracks.ts` (TrackConfig +
   plugin registry), `locus.ts` (parse + bp/px math), `gosling.ts` (grammar
   subset + transforms), `io/genome.ts` (GFF/BED/format sniff). Phase 2 staged.
10. **OHIF** → `volume-core/extension.ts` (manifest, MODULE_TYPES, modes, boot
    order). Organization only, zero viewer logic.
11. **dcmjs** → `io/dicom-vr.ts` (binaryVRs/length32VRs/singleVRs + 31-code
    list + OL/OV; helpers isLength32/isBinary/allowsMultiple/isKnown).
    Collapsed three divergent LONG_VRS copies; fixed latent OD/UR misparse.
    Skipped read/write stack, dictionary files, anonymizer, SEG derivations.
12. **dicomParser** → `Walker.skipImplicitSequence` (UN-undefined walks
    implicit items; stray undefined lengths throw instead of dropping the
    tail). Length-32 set already superseded by Group 16; skipped encapsulated
    extraction, string semantics, implicit-VR dictionary changes.
13. **vizarr** → multi-level `OmeZarrStore` (all `datasets[]` opened, per-level
    tiles, level-prefixed chunk cache) + cells level selector + vendored
    `samples/cells_demo.zarr` (gen-cells-zarr.mjs; L0 raw, L1 gzip).
    Skipped deck.gl layers, OME-TIFF, plates/wells; blosc rejection stands.
14. **Daikon rle.js + lib/jpeg-baseline.js** → `io/dicom-rle.ts` (PackBits
    planes, 1/2 segments, named errors for warn paths) + `io/dicom-encap.ts`
    (BOT + fragment items + SOI grouping) + `io/jpeg-scan.ts` (Huffman +
    baseline MCU, progressive passes dropped) + `io/jpeg-baseline.ts`
    (SOF0/SOF1 markers, Loeffler IDCT verbatim, YBR→luma) +
    `io/dicom-deflate.ts` (original: zlib-inflate the post-meta dataset
    pre-walk via fflate; group-length split with scan fallback) +
    `io/jpeg-lossless.ts` (original T.81 Annex H: predictors 1-7, 8/16-bit,
    own marker loop over the shared bit-reader; Pt≠0/DRI/multi-scan loud) +
     multi-frame split (original: parseDicomFrames — native slicing, RLE BOT
     or fragment-per-frame, JPEG SOI groups; single-slice entry keeps its
     loud contract; loaders flatMap in file order over stable sorts).
     SOF2, SOF5/6/7/9, JPEG-LS/2000, 12-bit baseline stay
     named errors (functional groups since shipped — see 17). Apache-2.0
     header kept on the JPEG port.
15. **NiiVue mesh loaders** → `render-cpu/mz3.ts` (16B LE header, attr flags,
    faces u32/verts f32/RGBA/scalars; gzip + attr>127 loud) + `render-cpu/
    gifti.ts` (own tag scanner + base64, no DOMParser/atob: POINTSET/
    TRIANGLE/ASCII+Base64Binary, col-major transpose; gzip payloads loud).
    Skipped tract formats (TCK/TRK/TRX/TT/TRACT), overlays-as-layers,
    FreeSurfer translate, colormap labels.
16. **oblique reslice + raycaster convention** → `render-cpu/mip-rotate.ts`
    (original: full-depth max along the obliqueBasis view normal, symmetric
    t-grid so axis-aligned rays land on voxel planes; window-after-project).
    Step-1 straddle on arbitrary tilts is sampling loss, pinned by lattice-
    exact 45° yaw/tilt proofs instead of tolerances.
17. **DICOM PS3.3 C.7.6.16** → functional groups in `dicom-parse.ts`
    (original: Shared/Per-Frame sequences re-read via the repo's own
    dcm-read — the Walker skips sequences; per-frame IPP/IOP/DIV resolve
    per-frame → shared → file-level; sliceLocation follows per-frame IPP so
    sortSlices stacks Enhanced series; count mismatch loud).
18. **NRRD spec** → `io/nrrd.ts` (NRRD0001-0005 header, 3D, raw/ascii/gzip
    via fflate, all 8 dtypes, spacings, both endians; detached .nhdr, `:=`
    inline data, bzip2 loud). Fills the `formats.ts` nrrd hint.
19. **PDBe QueryHelper conjunction** → `molql.ts parseMolQuery`
    ("chain A and resi 10:20", one clause per field, ranges normalized like
    bundleRange; duplicates/trailing-and loud). Full MolQL grammar deferred.
20. **DICOM PS3.3 Pixel Measures** → per-frame spacing/thickness onto
    `DicomSlice` (per-frame → shared → absent; the stacked Volume keeps
    file-level spacing, which cannot vary per slice).
21. **NRRD detached headers** → `parseNrrdDetached` (same grammar, caller-
    supplied payload, byte-skip; filename resolution stays in the loader).
22. **MRtrix TCK** → `render-cpu/tck.ts` (Float32LE triplets, NaN fences,
    Inf terminates; NiiVue-identical trailing-post semantics). Reader only.
23. **TIFF 6.0 + OME-XML** → `io/ome-tiff.ts` (IFD chain, strips/tiles,
    raw/deflate/LZW/JPEG, predictor 1/2, 8/16-bit, LE/BE; own LZW codec
    validated byte-exact against Pillow incl. early-change growth; JPEG
    tiles via the shared baseline decoder; OME-XML plane map).
24. **NGFF plates** → `io/ome-plate.ts` (plate/well attrs, well lookup by
    name/index, URL join/resolve) + CellsView picker + `plate_demo.zarr`.
25. **Tractography projection** → `render-cpu/fibers.ts` (raster.ts-identical
    orbit/tilt/framing, polylines + box fitter) + SurfaceView overlay.
26. **Boolean queries** → `molql.ts` predicate tree (NOT > AND > OR,
    parens; refactored testAtom shared with the conjunction path).
27. **TrackVis TRK** → `render-cpu/trk.ts` (1000B header, vox_to_ras applied,
    gzip via fflate, zstd loud; scalars skipped, no consumer yet).
28. **TRX containers** → `render-cpu/trx.ts` (fflate unzip, u64 offsets with
    overflow guard, float16 LUT, header.json passthrough).
29. **Oblique Min/Mean** → `mipRotate` `mode` (max/min/mean over in-bounds
    ray samples, windowing after projection; MprView routes every non-slice
    oblique projection through it with the mode tag).
30. **Detached .nhdr open** → `nrrdDetachedName` (header "data file" pointer,
    null when attached) + `loadNrrdDetached` + `uploadNrrdPair` (multi-select
    pairing, exact-name sibling or lone-file fallback, loud guidance).
31. **Appearance prefs** → `UiState.textSize/density` (`--ts` multiplies all
    51 chrome type declarations; layout XS–XL rescales 8 layout rhythms),
    `carys.appearance` localStorage (legacy `omniviewer.appearance` still read on load), topbar gear + `.appear` popover.
32. **Robustness battery** → `corrupt.test.ts` in io + render-cpu (hostile
    bytes → named errors; `readDataset` rejects <8B as truncated,
    `fetchJson` wraps bad JSON as `bad-json`).
33. **Journeys + budgets** → `test/e2e/journeys.mjs` (3 money flows),
    `render-cpu/perf.test.ts` (3 wall-clock ceilings with observed-vs-budget
    printout for recalibration).
34. **Viewport grid** → `ViewerView` (file tabs + 3D-left/2D-stack-right +
    per-viewport fullscreen), `MprPanes.contentXY` (exact voxel mapping
    under letterbox/pan/zoom), `SurfaceView` live repaint (immediate on
    controls, debounced on mask edits) + drag-orbit + cross-render epoch
    (`paintToken` shared by VR and surface paths).
35. **Mobile immersion** → `mView`/`mSheet` (single filling viewport +
    toggle panels that resize the stage by flex), `MprToolDock`/
    `MprTuneDock`/`SegDock` split (ids preserved), `handleOpenFiles`
    router shared by toolbars, inline topbar status (fixed footer covers
    the action bar otherwise).
36. **Dead-space pass** → `RasterOpts.center` (default-preserving) +
    `maskCenter` bbox cache in `SurfaceView`, toolbar toggle
    (`docksOpen`, stage +42% when hidden).
37. **OHIF toolbar + measurement panel** → ellipse ROI wired to the dead
    `roiStats`/`ellipseArea` core (area mm² + HU μ/σ/min/max/n, tracked +
    SR-exported), cine transport over retained 4D bytes, invert switch,
    DICOM tag browser (`DicomTagSummary` + SOP names). Reference lines,
    flip/rotate, calibration stay out (no product need yet).
38. **NiiVue tractography trio** → TRK (incl. gzip) + TRX (float16/32)
    imports through the TCK fiber path (extension routes, magic decides).
    Clip planes stay out: oblique MIP already covers cutaways (colormaps
    shipped later — see 40).
39. **OHIF Rectangle + Cobb** → `roiStats` plane-aware (optional arg,
    axial default), Rect + Cobb tools with tracked areas/angles; short
    tri-stack panes reset pending strokes on neighbor taps (leg uses Ax).
40. **Papaya ColorTables** → LUT select (Gray/Fire/Spectrum/Hot-Cold/
    Gold) post-window + post-invert, mask tint last; grayscale fast path
    byte-identical. Clip planes stay out (oblique MIP covers cutaways).
41. **Crosshairs + WW/WC drag + calibration** → synced-voxel dashed
    reference lines on all panes; Shift-drag window/level with live
    readout + `custom` preset; Inspector spacing override with loud
    validation. Flip/rotate stay out (would disturb the exact
    contentXY picking contract).
42. **DICOM GSPS + SR reproducibility shape** → JSON sidecar, not the
    full PS3.11/PS3.16 stack: identity (series + study/series UIDs from
    `DicomTagSummary`), geometry (dims/spacing/slices), display
    (WL/preset/LUT/invert/proj/slab/obliquity), derivation (src/
    threshold/method/maskVer/`meshKey`), results (mask + measurements +
    validation) — fixed key order for byte-stable output, loud parse,
    and a diff fn that names drift against the HTML report inputs.
    Full GSPS save/load stays out (needs a consumer first).
43. **Cornerstone oblique-measurement reading** → `measure/oblique-
    measure.ts`: taps live on the tilted frame the paint used, so values
    come from that frame (inverse of the resliceOblique forward map,
    same basis + center), length/angle as true 3D physical segments,
    ellipse/rect stats sampled through the frame with area scaled by the
    physical pixel footprint (`|row_mm × col_mm|`), Cobb spacing-aware
    in 3D, zero-tilt reproduction of the orthogonal stats as the proof.
    Full double-oblique handles + CPR stay out (ship order item 6).
44. **OHIF longitudinal + lesion measurement reading** → `render-cpu/
    fusion.ts` (checker/alpha/subtract composites on the base geometry,
    overlay nearest-mapped so mismatched dims degrade visually, never
    crash) + `measure/recist.ts` (target sums, nadir, CR/PR/SD/PD with
    the +20%/+5mm PD double gate) + volume-doubling time. Full
    registration (rigid/affine) stays out — same-slider sync assumes
    same-geometry series, the caller's contract.
45. **DICOM-SEG multi-segment reading** → `editor-seg/multilabel.ts`
    (labelmap↔masks, segments table + CSV): import keeps every segment
    value, export writes one segment per value, replacing the old
    largest-wins collapse. Per-segment display colors + SEG category/
    property codes stay out (single red tint, labels only).
46. **OME-NGFF 5D reading** → `io/ome-dims.ts` (plane selection over
    decoded (t,c,z), extents, PhysicalSize parse with null-on-junk):
    planes group into per-(t,c) volumes instead of first-plane-only.
    Pyramid-aware tiled streaming + dimension-slider UI stay next.
47. **DCMR TID 1500 reading** → `measure/tid1500.ts` (Imaging
    Measurements → Measurement Group → Tracking Identifier + Finding +
    NUM/SCOORD, grouped by series+label): the template shape without
    the Part-10 binary writer (needs a dataset encoder + UID
    allocation product call).
48. **MRtrix/AFQ tract-filter reading** → `render-cpu/tract-roi.ts`
    (sphere waypoint/exclusion filtering + resampled along-tract
    scalar profiles): the interactive half of along-tract analysis.
    Bundle atlases stay out.
49. **Viv channel-stats reading** → `volume-core/unmix.ts` (per-channel
    gain/offset, flatfield with darkfield + clamp, border-median
    background): the correction math before compositing. Per-channel
    UI LUT stays next.
50. **Mol* pocket + superposition reading** → `volume-core/pocket.ts`
    (CA-contact exposed-cleft finder, largest-first) + the existing
    `minimizeRmsd` wired to a dock button. Buried-cavity detection
    (solvent model) + cross-model superposition stay out.
51. **igv.js VCF reading** → `io/vcf-depth.ts` (DP/AD parsing with
    null-on-unknown, depth histogram): variants as depth-labeled rows
    in the locus-filtered table. BAM pileup stays out (BGZF + index
    is its own project).
52. **TrackVis/TRX sidecar reading** → TRK per-vertex scalars +
    per-streamline properties stored (not skipped), TRX
    dps/data_per_streamline decoded with length checks: the scalar
    consumer the format readers always lacked. dpg/groups stay out.
53. **OHIF worklist-status reading** → `study/readstatus.ts`
    (unread→reading→read→signed+locked): the status model without the
    MPPS transport (needs a backend + DIMSE product call).
54. **NiiVue drawing-manager reading** → `editor-seg/oblique-paint.ts`
    (frame-space splat + Bresenham stroke through the tilted frame):
    the brush cut NiiVue's PenTool implies but never exposes — paint
    on any tilted plane with lattice-exact undo. Grow stays
    orthogonal (seed lattice semantics).
55. **Vessel-CPR reading** → `render-cpu/cpr.ts` (arc-length
    centerline + trilinear straightened reformat): the diagnostic
    view without the tracing UI (caller-supplied centerline).
56. **Mortensen-Barrett livewire reading** → `editor-seg/livewire.ts`
    (Sobel gradient + Dijkstra wire + Chan-Vese refine pass):
    gradient-guided boundaries on one slice. The binary heap + 3D
    extension stay out (documented perf follow-up).
57. **Neuroglancer worker-split reading** → `workers/parse.ts` +
    `parseClient.ts` (uploads decode off-thread, main-thread
    fallback): the frontend/backend split applied to parsing.
    Out-of-core paging past VOL_BUDGET stays out.
58. **DICOM GSPS save/load reading (PS3.11 C.11)** → `study/
    present.ts` (original: WL/preset as VOI LUT, slices as the
    Referenced Image list, zoom/pan as Displayed Area, tracked
    measurements as Graphic Annotations — JSON wire shape, loud
    restore). Per-slice SOP Instance UIDs need a loader change to be
    retained, so the Part-10 binary writer + referenced-series crosswalk
    stay out (documented product call at the call site).
59. **Viv tiled-viewport reading** → `io/ome-view.ts` (pure
    `pickPyramidLevel` + `bandPlan`): Viv's resolution-pick idea (finer
    level when the viewport covers it) with the deck.gl tile loop cut —
    the viewer fetches whole-level tiles through the existing
    OmeZarrStore chunk cache and paints progressive Canvas2D bands with
    an epoch guard, contrast stats computed once up front. Tile-level
    lazy fetch (only visible rects) + blending between levels stay out
    (documented follow-up once real >100MP stores arrive).
60. **Viv feature-table brushing reading** → `volume-core/cells.ts`
    (pure `labelCells` + `downsampleTile` + `cellAt`): the linked
    table↔viewport half of HCS review — threshold + dust filter label a
    scaled tile, rows carry area/centroid/mean, selection outlines on
    the canvas both ways. Per-cell velvet colors + cross-level track
    identity stay out (no product need yet).
61. **igv.js + Mol* link reading** → `io/codon-map.ts` (pure interval
    rows → chain+author-seqId, contig names byte-equal, misses null):
    the variant↔residue half without a backend aligner — tracks uploads
    the map, rows grow residue chips, the click queues a one-shot
    `linkBus` handoff the protein view consumes onto its open model
    (wrong-model targets stay loud). Real transcript alignment (GTF CDS
    → codon translation) stays out (needs an annotation product call).
62. **EM map-fit reading (ChimeraX fitmap idea)** → `volume-core/
    mapfit.ts` (pure centroid-translation dock + trilinear inclusion +
    index–density spread diagnostic): the "is the model in density"
    question without a 6D search — NIfTI upload reuses the io reader,
    the chip reports n/n + %, the status names the translation-only
    contract. MRC/CCP4 binary + rotation search stay out (documented
    follow-ups once real maps arrive).
63. **DICOMDIR directory reading (PS3.11)** → `io/dicomdir.ts` (pure
    STUDY/SERIES/IMAGE tree over the dcm-read sequence path, unknown
    record types + dangling refs skip): the disc index without pixels
    — worklist multi-selects DICOMDIR + referenced files, the series
    picker opens one series through the existing slice decoder
    (US cine + Doppler shipped next — see 64).
64. **US region + cine reading (cornerstone getCalibratedUnits +
    USHelpers)** → `io/us.ts` (pure region rows + `cineFields` +
    `foldYbrFrame` 422-pair/triple fold to Rec.601 luma): the
    tissue/flow/spectral half without the loader/VOI layers — pixel
    pipeline accepts native 3-sample color, `.dcm` uploads replay
    frame-order on the existing cine rail with the file rate seeding
    the slider, the tag browser names regions + rate + types.
    PALETTE COLOR + implicit-VR regions + encapsulated US stay loud
    (named errors, not guesses); ECG probe-variant value mapping
    stays out (needs a probe-geometry product call).
65. **BTO stack-geometry reading (OHIF SOP dictionary +
    cornerstone calibrated-units idea)** → `io/tomo.ts` (pure SOP
    gate + `stackPixelSpacing`/`stackZGap` resolvers): the stack half
    without the viewer layers — meta carries imager spacing + slice
    interval + laterality/view, every stack path funnels through the
    same two helpers, uploads name laterality/view, the tag browser
    shows the tomo row, MG hangs coronal/auto. Per-projection
    geometry + slab MIP presets stay out (no product need yet).
66. **RTPLAN/RTDOSE adapter reading (Daikon dictionary.js
    groups 300A/3004)** → `io/rt.ts` (pure plan summary + Gy grid +
    DVH rows): the review half without the TPS — uploads route by
    SOP class (plan = series row, dose = Gy volume), the tag browser
    names beams/fractions/Rx + dose max/DVH, geometry reuses the
    stack resolvers. MLC/wedge/block sequences + dynamic control
    points + MU checks stay out (needs a planning product call).
67. **VL tile-grid + document reading (OHIF SOP dictionary +
    SlideToolkit tile-grid idea)** → `io/wsi.ts` (pure SOP gates +
    grid/document summaries): the catalog half without the viewer —
    uploads route by SOP class (slide = representative tile + grid
    status, document = metadata row), the tag browser names grid +
    title/MIME/bytes. Full pyramids + level navigation + document
    rendering stay out (needs a tiling + document product call).
68. **JPEG-LS reference-encoder debugging (CharLS via imagecodecs)**
    → wired `io/jpeg-ls.ts` into `dicom-frames.ts` (...4.80 only):
    the decode half without the codec toolchain — five spec-level
    bugs fixed against primary sources (CharLS headers in /tmp +
    live encoder probes), 7 reference fixtures decode bit-exact.
    Near-lossless (...4.81) + JPEG 2000 + 12-bit/SOF2 stay loud
    (named errors, not guesses).

69. **Digest provenance foundation (ROADMAP §3 + §5 ledger; verified
    2026-09-17)** → `study/sources.ts` (pure SOURCES.json + knowledge-entry
    + registry validators, shared education badge, unverified-shipped
    license gate): the provenance half without any digest bytes — the
    sidecar carries digestPins from session (reset per volume), the
    Inspector shows DigestRows beside the tag rows (hidden until A1),
    the ROADMAP §1c table + §5 ledger record every reuse row the CI
    gate walks. First digest bytes + license-gate enforcement stay out
    (A1 proves them — no product need yet).

70. **A1 BodyParts3D long-bone digest (PART-OF 4.0, CC-BY-4.0; verified
    2026-09-17)** → `volume-core/atlas.ts` (20-structure index from
    partof_parts_list_e.txt + partof_element_parts.txt) + 22 vendored
    MZ3 + CC-BY-4.0 SOURCES.json + `#/atlas` AtlasView on renderMesh:
    the first real digest→provenance→viewer proof — knowledge entries
    validate through study, renders hash-match frozen, DigestRows light
    up while open. Skull compound (43 files) + Z-Anatomy muscle/vascular
    systems stay out (A2/K1 prove them — no product need yet).

71. **K1 BodyParts3D term table (PART-OF + IS-A lists, CC-BY-4.0;
    verified 2026-09-17)** → `volume-core/terms.ts` (injected table +
    lookups + deterministic substring search) + 1368-concept slim JSON
    + CC-BY-4.0 SOURCES.json + atlas search UI: every A-label resolves
    through one choke point, zero drift pinned, non-20 hits name the
    A2 mesh gap instead of failing silent. IS-A-only concepts (no
    PART-OF members) stay out — they land with the A2 mesh set, not as
    dead rows.

72. **M1 RCSB pathogen digest (PDB archive, CC0-1.0; verified 2026-09-17)**
    → `volume-core/pathogens.ts` (3-entry index with offline-measured
    CA–CA<8Å contacts + variant-note sites) + 3 vendored PDB files +
    CC0 SOURCES.json + ProteinView picker/Contacts/Variants on the
    existing PDB wire: the variant↔residue story told with real
    pathogen geometry (spike–ACE2 interface, antibody epitope, capsid
    assembly). Phenotype calls + M2 cell context stay out (teaching
    highlight only — no product need yet).

73. **C1 IDR catalog (live API + S3 listing, CC0 bucket metadata;
    verified 2026-09-17)** → `io/idr-catalog.ts` (3 pinned screens with
    measured codecs) + CellsView picker: the catalog half without the
    pixels — stores stay remote, the version pins ride the session, and
    the blosc gate fails loud with the decoder's own named error. Pixel
    delivery waits on the P0 blosc/zstd toolchain (still blocked on
    toolchain — vendor first); per-study reuse terms stay UNVERIFIED
    until a download page says otherwise.

74. **T2 pydicom foundry + R3 xval corpus (TOOLING, MIT; verified
    2026-09-17; odd-length injection 2026-09-18)** → `test/e2e/foundry.py`
    (gen + xval) + 6 fixtures + raw-deflate fallback in `dicom-deflate.ts`:
    breadth without hand-rolled bytes — implicit VR, US regions, BTO
    geometry, real-world raw-deflate, and odd-length error injection
    (lied LO length shifts downstream tags: pydicom husk-only, ours
    truncated — agreement is both failing loud) all prove against the
    reference reader. Multiframe xval stays scoped (single-slice contract,
    loud reject); live-server conformance stays R4.

75. **E2 disease bundles (no new bytes; verified 2026-09-17)** →
    `volume-core/bundles.ts` + `#/learn` LearnView: structure (M1) +
    story + quiz as one teaching unit with a provenance card per
    piece — the M4 pattern generalized. Quiz answers pin to digest
    counts (15/22 contacts, 4 monomers), attempts log to the audit
    trail. Cell context (M2/C1 pixels) stays out until the P0 blosc
    toolchain lands; grading/diagnosis stay out by design.

76. **A2 skeleton set + FMA tree (PART-OF + IS-A lists, CC-BY-4.0;
    verified 2026-09-17)** → 27 atlas entries (ribs/pelvis/sacrum/skull,
    75 new meshes) + `tree.json` (139 nodes) + raw relation files +
    tree service (ancestors/children/part-of) + neighbourhood search:
    the atlas graduates from long bones to the full skeleton, and
    every search hit teaches the IS-A walk. Muscle/vascular systems
    stay out (different BodyParts3D trees — next digest).

77. **K3 teaching cohorts (no new bytes; verified 2026-09-17)** →
    `volume-core/cohorts.ts` + worklist CohortSection: curated case
    lists (samples + M1 + E2) as education worklist entries with
    read-progress + audit — the education PACS without a server.
    Non-series cases navigate by message, not by pixels; grading
    stays out by design.

78. **M4 celiac + allergen collections (PDB archive, CC0-1.0; verified
    2026-09-17)** → 2 pathogen entries (4OZF tripartite, 1BV1 allergen) +
    2 E2-pattern bundles + 2 cohort cases: NIH 3D-style mechanism sets
    (structure + pathway + provenance each). 4GG6 stays out (peptide
    undocked in both copies — the probe names it); epitope mapping
    stays out (needs IgE data).

79. **C2 WSI teaching annotations (no new bytes; verified 2026-09-17)**
    → annotation model + demo set + Inspector table: display-only
    region/stain overlays on the VL representative tile (tile pixels,
    never slide microns). Real uploads start empty; detection/grading
    stay out by design.

80. **N2 tract presets (no new bytes; verified 2026-09-17)** →
    `volume-core/tract-presets.ts` + 3D dock picker: named waypoint
    bundles ("midline-cross", "left-hemisphere", "two-hop") teaching
    tractography over the existing filter — fractional coords, no
    patient-specific claims. Bundle segmentation (AFQ/RecoBundles)
    stays out. A3 adds 2 SPL-named bundles (thalamo-midline, putamen-pair) → 5 total.

82b. **A3 SPL brain labels (31KB slim JSON; Slicer-License-B page-verified, SPDX owed)** →
    `digests/openanatomy-brain/labels.json` (335 rows: value + label + RadLex + color, from the spl-brain-atlas labelinfo TSV) +
    `volume-core/brain-regions.ts` (lookup + search + validators) + atlas Brain search + SPL attribution line +
    SOURCES sidecar (UNVERIFIED + license_note naming the Part-B grant + the owed SPDX call). The 200MB SPL
    label volume stays remote — region geometry is named waypoints only. Inner-ear zip stays out (CT mesh work, next).

82c. **A4 plane atlas (no new bytes)** →
    `volume-core/plane-atlas.ts` (Ax/Cor/Sag cards: cuts + slider-third landmarks + tilt caution) + tune-dock
    PlaneAtlasCard reading the live slider fraction + obl state → `#ro-plane` line. Teaching text, never a claim
    about the open volume's own anatomy.

82d. **M2 organoid screen (2.6KB screen facts + 4th catalog entry; CC-BY-4.0)** →
    `digests/idr-screens/screens.json` (hSIOs-1/2 ids + shapes + pixel size + mirrors, from the live IDR JSON API) +
    4th IDR catalog entry (v0.4 mirror for 9822152; blosc-gated like the other three) + `organoid-context` bundle
    (6th bundle: 6M0J + idr0083 pairing, 3 byte-pinned quiz) + pathogen-cohort case + K4 self-test reuse (95 total with D5).
    9822151 has no v0.4 mirror (404 both spellings) — catalog says so. No phenotype claims (infected-vs-control stays out).

82e. **R1 phantom bundle (1KB foundry fixture)** →
    `test/e2e/foundry/phantom-qc.dcm` (pydicom: 16×16 water + 4×4 +100 HU insert, rescale slope 1 / intercept -1024) +
    R1 safety test (real bytes → HU → tolerance band) + xval agreement. Hand-rolled native files stay for boundary cases.

82f. **R2 compression corpora (2 foundry fixtures)** →
    `jls-lossless.dcm` (CharLS/imagecodecs stream wrapped by pydicom as ...4.80, 8×8 12-bit ramp) + `rle-lossless.dcm`
    (hand-packed DICOM RLE frame as ...5, 8×8 ramp+flat — pydicom/imagecodecs have no RLE encoder) + off-disk decode
    tests in both suites + xval 33/35 (2 scale notes: pydicom reports encapsulated bytes/bitsStored, we report decoded
    pixels/bits — documented, not hidden). JPEG-2000 stays out (no encoder here).

82g. **X1 digest registry (repo root)** →
    `DIGESTS.json` (7 rows: 6 shipped verified + openanatomy-brain honest-proposed; D1 added the 7th 2026-09-18) + sources.test gate walk (format +
    row-by-row validation + unique ids + empty unverifiedShipped). The license-CI gate finally walks a real file.

82i. **E1 plane trainer (no new bytes)** →
    `volume-core/plane-trainer.ts` (12 drills: 9 third-drills + 3 which-plane over the A4 cards, rotated options,
    pure grader) + LearnView PlaneTrainerCard (drill nav + rationale reveal + score chips, attempts on planetrainer)
    + leg 38. Study aid, never a credential.

82j. **E4 measurement trainer (no new bytes)** →
    `measure/measure-trainer.ts` (4 known-answer cases: 3 RECIST + phantom length, tolerance bands, answers agree
    with the shipped assessRecist math) + LearnView MeasureTrainerCard (typed sum + category pick + band verdict,
    attempts on measuretrainer) + leg 39. Tolerance-banded, never pass/fail on diagnosis.

82l. **I2 TID1500 import (no new bytes)** →
    `measure/tid1500-import.ts` (own-shape JSON → Measurement rows, ` · SR import` provenance tags, vendor dialects
    stay loud) + Inspector TID-in button (file upload → rows + audit) + 3 round-trip/boundary tests + leg 29b
    (export → re-upload → tagged rows). Import of an import keeps the tag on re-export.

82m. **X2 foundry docs + X3/E3 difficulty cohorts (no new bytes)** →
    `docs/FIXTURE-FOUNDARY.md` (4 rungs + encoder gaps + 33/35 xval contract); cohorts gain difficulty 1-3 +
    easy-first validator + range helper (existing cohorts reordered + repinned) + `residency-ladder` cohort
    (identify → measure → clear) + worklist D-chips + difficulty span in the blurb + leg 36 E3 steps.

82n. **F1 offline pack + F2 sheets + F3 low-bandwidth (no new bytes)** →
    `docs/OFFLINE-PACK.md` (what works from file:// + pack recipe + provenance); `teachingSheetHtml` (printable
    labels + quiz checkboxes, answers never embedded) + ReportView Sheet button + leg 24 F2; CellsView Low-BW
    switch (pins smallest pyramid level, status teaches) + leg 8b2. Chunk-cache byte counts already surface
    per paint (`N chunks cached` in the status).

82x. **Closeout: 9 deferred lanes license-cleared, none started (2026-09-18)** →
    Z-Anatomy digest (A1), BV-BRC linkage (M3), HPA expression views (C3), Allen overlay (N1), Allen+HPA matrices
    (D6), expression residues (G4), RDKit depictions (G2), itk-wasm bench (T3), MONAI sidecars (T4), OpenSlide
    pyramid (V5), TotalSeg/nnU-Net masks (§1c): every pasted license confirmed, no bytes vendored by design
    (no speculative vendoring). Ledger rows flipped proposed → DEFERRED; reopen any one with its lane change
    (PHASES + DIGEST entry + wire leg). SPL SPDX mapping stays the single open license call.

82w. **I1 dcm2niix parity + T1 DIMSE handshake + G3 radiomics import (verified 2026-09-18)** →
    I1 parity (TOOLING, BSD-3-Clause pasted back with bundled-dep licenses): `foundry.py parity` runs dcm2niix
    v1.0.20220720 over the 6 sample series in scratch (never vendored) — our ascending-sliceLocation sort,
    in-plane dims, per-file PixelSpacing, and NIfTI z-origins all agree; multi-SeriesUID prefixes are info, never
    failure. T1 handshake (TOOLING, MIT pasted back): `test/e2e/dimse-echo.py` proves C-ECHO 0x0000 on loopback
    with pynetdicom 3.0.4. G3 radiomics (REFERENCE, BSD-3-Clause pasted back): `measure/radiomics.ts` imports
    offline pyradiomics CSVs (6 first-order + shape features) as ` · radiomics import` Measurement rows — same
    provenance contract as SR import; texture/fingerprint computation stays offline by design.

82v. **TorchIO loader audit + napari 5D patterns + D5 bundles (REFERENCE; verified 2026-09-18)** →
    TorchIO 1.2.1 intensity audit (REFERENCE, Apache-2.0): RescaleIntensity/ZNormalization/Clamp semantics read
    from the unpacked wheel source → engine-pure `rescaleIntensity`/`zNormalize`/`clampIntensity` in `unmix.ts`
    (percentile windowing, masked stats, null-end convention; masking-methods/label-maps/trainable landmarks stay
    out). napari axis-order audit (REFERENCE, BSD-3): TiffData walk verified against the vendored tczyx fixture
    (12 explicit elements — bare elements walk C by documented default; explicit-FirstC walk pinned by test) +
    `auditAxisOrder` findings in `ome-dims.ts`.
    D5 NIH 3D pairings (per-model license in provenance, no new bytes): capsid story reframed on the print
    assembly + `allergen-scaffold` bundle → 7 bundles, 95-question bank (UI + leg 37 repinned).

82u. **CellProfiler-studied shape columns (REFERENCE; verified 2026-09-18)** →
    Read the live CellProfiler LICENSE (BSD-3-Clause, Broad Institute) + MeasureObjectSizeShape semantics:
    PORTed the four cheap shape columns into engine-pure `cells.ts` (perimeter/extent/formFactor/aspect, exact
    on block/bar/L-tromino goldens) + CellsView row rendering + leg 8c shape step. Eccentricity (moments),
    solidity (convex hull), and intensity-distribution columns stay out — the brushing lane needs shape
    triage, not a full profiler.

82t. **V3 neuroglancer-precomputed translator (TOOLING; verified 2026-09-18)** →
    Read the live precomputed volume spec (Apache-2.0, google/neuroglancer volume.md): `gen-precomputed.mjs`
    translates the vendored cells_demo L0 bytes into info + raw unsharded chunks (Fortran order, begin-end
    filenames); `precomputed.test.ts` pins the info shape + proves every chunk byte-agrees with our own tiled
    lane. Output is regeneration (gitignored), never a vendored fixture. Sharded chunks, meshes/skeletons,
    jpeg/compresso/crackle encodings, and multi-scale pyramids stay out — the comparison is chunk addressing.

82s. **V2 NiiVue-studied 3D cursor (REFERENCE; verified 2026-09-18)** →
    Studied NiiVue's render-view crosshair (BSD-2-Clause, LICENSE verified from the live repo file): PORTed only
    the math contract — voxel→screen under the orbit/tilt/framing the rasterizer already uses — into engine-pure
    `render-cpu/cursor3d.ts` (rotation/scale/pixel mapping raster.ts-verbatim so the cursor lands on the mesh/fiber
    pixel it names; drawing + occlusion + world units stay out) + `cursor3d.test.ts` parity goldens (5/5, tied to
    the shipped projectors, not hand numbers) + SurfaceView accent overlay on the synced tap + leg 41. Occlusion
    (depth peel) and world/mm units stay out by design.

82r. **V1 cornerstone-studied annotations (REFERENCE; verified 2026-09-18)** →
    Studied the live LengthTool source (MIT, Open Health Imaging Foundation) + math/line distanceToPoint: PORTed
    the annotation record shape, the draw→select→drag→end lifecycle with stats invalidation, and proximity picking
    into engine-pure `measure/annotations.ts` (no DOM/toolGroups/rendering engines; stats computed by the shipped
    length/angle/ellipse/cobb math). Behaviour-parity goldens in `annotations.test.ts` (6/6). Calibration stays out
    (our spacing already rides the Volume); throttled recompute stays out (a scheduler concern).

82q. **V4 zarrita chunk-decode comparison (TOOLING; verified 2026-09-18)** →
    `omezarr.test.ts` "vs zarrita reference" (MIT zarrita 0.7.5 + FileSystemStore, test-only — io ships
    dependency-free): every cells_demo chunk byte-equal on both pyramid levels (raw L0 + gzip L1) + seam tile
    goldens. Independent-reader agreement over the vendored bytes; disagreements would become goldens.

82p. **D1 OpenNeuro ds000001 pair (CC0; verified 2026-09-18)** →
    `digests/openneuro-ds000001/SOURCES.json` (CC0-1.0 per the live dataset_description.json License field,
    snapshot 1.0.0, crop provenance in the version pin) + T1 64³ / BOLD-f0 64×64×33 vendored crops (crop-shifted
    affines, geometry frozen in `samples-matrix`) + `openneuro-t1-crop`/`openneuro-bold-f0` catalog entries +
    DIGESTS.json row + leg 40 (both open as volumes: 64 / 33 axial slices). MPR/fusion/compare lanes' second
    real-modality pair; research-only teaching fixtures, never patients.

82o. **G1 GTF CDS translation (engine pre-shipped; verified 2026-09-18)** →
    `io/codon-map.ts translateGtfCds` (GTF CDS rows → per-transcript codon maps: splice-aware carry, strand-aware
    ordering, partial-codon reporting, fail-loud named errors) + dual-arm GTF attribute parse in `io/genome.ts` +
    `gtf-cds.test.ts` (5 its) wired into `test:unit` + TracksView GTF CDS upload (`#gtf-upload`) with transcript
    picker (`select[aria-label="Transcript"]`, entries become the codon map, chips read transcript-ordinal residues)
    + leg 28c (GTF → picker → chip → protein handoff, transcript-ordinal miss lands loud on the status; leg 28b
    keeps the resolved happy-path pin). Residue numbering is transcript-codon ordinal (codon 1 = first translated
    codon), labeled as such — matching author seqId only when the structure covers the CDS from its start.

82k. **Q1–Q4 QC registry (no new bytes)** →
    `study/qc-registry.ts` (phantomTrend + doseRegistry + compressionAudit + deidReportCard, all pure over held data)
    + worklist QcSection (4-tab chip panel with stand-in phantom points labeled until a pinned scan lands) + leg 36b.
    Screening aggregates for labs, never validated QC claims.

82h. **X4 attribution (report + parity)** →
    `ATTRIBUTION_ROWS` (7 rows mirroring DIGESTS) + provenance + attribution tables in the standalone HTML + ReportView
    digest card (`#report-digests`) + digestPins in parity coverage + StudyReport.digestPins required. Pins record the
    session, not the measurement — out of the canonical JSON/fingerprint by design.

82. **K4 self-test mode (no new bytes; verified 2026-09-17)** →
    `volume-core/selftest.ts` + `#/learn` deck: 95 seeded questions over
    the A1/A2 atlas + K1 tree + E2/M4/M2 bundles, attempts on the quiz.answer
    audit line. Study aid, never a credential; grading stays out.

81. **K2 glossary popovers (no new bytes; verified 2026-09-17)** →
    `glossaryCard()` + atlas term-chip card: click any structure term
    → parent, children, part-of, meshes, source. The read-side of K1,
    pure UI over pinned data.
