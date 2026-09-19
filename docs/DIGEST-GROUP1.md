# Digest Group 1 — full-clone protocol receipt

Cloned shallow (`--depth 1`) into `.tmp-digest/` (gitignored). Entire codebases
read via subagents; ports below are line-faithful, not summaries.

## Papaya (rii-mango/Papaya) — JavaScript ES5, ~21,217 LOC src, 52 files
- Pattern: browser-global namespaces (`papaya.volume.X`), Closure concat build.
- PORTED:
  - `viewer/colortable.js` (238 lines) → `volume-core/src/colortable.ts`
    wholesale: all 11 knot tables, PARAMETRIC/OVERLAY sets, updateLUT lerp,
    lookupRed/Green/Blue. Skipped ARROW_ICON/canvas colorbar.
  - `volume/orientation.js` (364) → `volume-core/src/orientation.ts`:
    isValidOrientationString, 6-permutation createInfo, strides, orientMat,
    convertIndexToOffset(Native). 1:1.
  - `viewer/screenvol.js` → `overlay.ts` ScreenVolume shape (screenMin/Max,
    screenRatio, negative, alpha, parametric). `viewer.js` orchestration
    pattern (base vs overlay load). `main.js` parametric-pair predicates.
  - `viewer/screenslice.js:updateSlice/repaint` → `render-cpu/mpr.ts` inner
    loop + repaint-cache contract. `viewerTools.js` pure geometry helpers →
    tool schema. `viewer/atlas.js` + `data/talairach-atlas.js` → atlas flow
    (Week 3). `utilities/math-utils.js` fast rounding.
- SKIPPED: ui/* (jQuery DOM), screensurface.js + surface/* (WebGL),
  viewer.js canvas/event bodies (~4,400 lines), DTI branches, padIsometric,
  prototype monkey-patches.

## Daikon (rii-mango/Daikon) — JavaScript ES5, ~13,932 total (src 8,147)
- Pattern: DataView state machine, dual CJS + browser-global.
- PORTED → `io/src/dicom-tags.ts`:
  - parser.js constants: MAGIC_COOKIE, VRS/DATA_VRS, Transfer Syntax UIDs,
    UNDEFINED_LENGTH; findFirstTagOffset preamble search; getNextTag VR/VL
    machine (Explicit split, Implicit dict fallback, meta-group handling);
    sublist loop; parse() early-exit at PixelData.
  - tag.js TAG_* registry (~30 tags), Tag id scheme, convertValue numeric +
    multi-string arms.
  - series.js sorting chain (ImagePosition > SliceLocation > InstanceNumber),
    getSeriesId grouping, slice-dir cosine threshold.
  - image.js getInterpretedData formula ((raw & mask) * slope + inter),
    MONOCHROME1 invert; tags/tagsFlat store.
  - utilities.js byte helpers (getStringAt ASCII, safeParse, concat).
  - v1 transfer-syntax policy: accept Implicit/Explicit LE/BE + deflate,
    reject JPEG/RLE with named errors. Slim 30-entry VR dict.
- SKIPPED: lib/* JPEG codecs (baseline/Lossless/LS/JPEG2000 WASM), Siemens
  CSA + mosaic, palette LUT, color/YBR, date/XSS/HTML, full 3,712-line dict,
  4-D time sorting, OrderedMap/iterator shims, bundles.

## NIFTI-Reader-JS (rii-mango/NIFTI-Reader-JS) — TypeScript ES2022, ~4,157
- Pattern: strict TS + fflate decompressSync + vitest golden vectors.
- PORTED → `io/src/nifti1.ts`:
  - 348B field map (dim_info@39 … magic@344) + endian auto-detect;
    n+1/ni1 magic sniff; datatype table (2/4/8/16/64/256/512/768);
    qform/sform affine METHOD 0/2/3 (incl. quaternion qfac);
    slope/intercept stored-not-applied; extension %16 chain walk;
    gzip sniff (31/139) + readImage vox_offset slice; BinaryReader.
  - Dep: `fflate` (migration from pako proven in bower.json).
  - Golden vectors: avg152T1 91×109×91, little 64×64×21, with_extension 376B.
- SKIPPED: NIfTI-2 540B, async streaming (DecompressionStream), serializers,
  orientation search, HDR/IMG pairs, complex/RGB, 5D, demos/bundles/CI.
