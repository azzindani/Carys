# Architecture — one core, many adapters

## Core types (TypeScript, `packages/volume-core`)

```ts
type Volume = { dims:[number,number,number], spacing:[number,number,number],
  origin:[number,number,number],
  dtype:'uint8'|'int8'|'uint16'|'int16'|'uint32'|'int32'|'float32'|'float64',
  data: TypedArray }
type Selection = { kind:'voxel'|'residue'|'cell'|'interval', ids: number[] | Range }
type Annotation = { id:string, label:string, mask?: Uint8Array, meshRef?: string,
  measurements: Record<string,number> }
```

One undo stack owns `Annotation[]`. Views never own state — they project core.

## Adapters (`packages/io`)

| Adapter | In | Out | Source pattern | Status |
|---|---|---|---|---|
| `dicom-stack.ts` | parsed `.dcm` slices/frames | `DicomStack[]` (+ `stackVoxels`) | group by series + matrix + IOP + spacing; IPP·normal order and spacing; even repeats → phases; warns on gaps, tilt, dropped repeats | proven on the vendored picks (5 exams → 5 stacks) + synthetic geometry |
| `dicom.ts` | `.dcm` slices | `Volume` (sort+stack) | `readImageDicomFileSeries` blocks-of-8, scan-normal sort | proven, 5 series |
| `dicom-parse.ts` | single `.dcm` bytes | `DicomSlice` + meta | Daikon Parser/Series/Image + RLE + JPEG-baseline + JPEG-lossless + deflated-TS + multi-frame split + Enhanced functional groups (52009229/52009230 → per-frame IPP/IOP/DIV) | proven, 27 files + codec/enhanced tests |
| `nifti1.ts` | plain `.nii` | header + image bytes | NIFTI-Reader-JS, all 8 dtypes | proven, 30 files |
| `nifti-write.ts` | `Volume` (+ optional affine) | `.nii` bytes | inverse of reader; METHOD 0, or the affine as sform + qform (qfac) | proven, round-trip incl. oblique left-handed affine |
| `nrrd.ts` | `.nrrd` (NRRD0001-0005 header) | `Volume` | NRRD spec: raw/ascii/gzip, all 8 dtypes, spacings, both endians | proven, synthetic round-trips |
| `ome-tiff.ts` | `.tif`/`.ome.tif` (TIFF 6.0 + OME-XML) | planes | strips/tiles, raw/deflate/LZW/JPEG, 8/16-bit, LE/BE | proven (PIL-validated LZW), `samples/tiny.ome.tif` |
| `ome-plate.ts` | NGFF plate/well `.zattrs` | well URLs | OME-NGFF 0.4 plates: lookup + resolve | proven, `samples/plate_demo.zarr` |
| `genome.ts` | BED/GFF | features | igv.js parsers | proven, fixtures |
| `omezarr.ts` | OME-Zarr store | tiled `Volume` chunks | Viv loader, chunk cache LRU | live path tested vs synthetic fetch + vendored `samples/cells_demo.zarr` (2 levels, raw+gzip) via disk fetch; blosc/zstd chunks rejected by name |
| `pdb.ts` / `cif.ts` / `seq.ts` | `.pdb` / `.cif` / FASTA/VCF | atoms / tracks | Mol* / igv.js | ported, fixtures only (PDB≡CIF equivalence tested) |
| `volume-core/mesh.ts` | — | mesh descriptors | NiiVue mesh path | types only (volume-core); STL/MZ3/GIFTI + TCK/TRK/TRX readers and fiber projection live in render-cpu |

NOT supported: encapsulated syntaxes other than RLE + JPEG Baseline 8-bit
+ JPEG Lossless SOF3 + deflated (JPEG-LS/2000, hierarchical, 12-bit
baseline, SOF2 progressive throw named errors), shared/per-frame Pixel
Measures overrides (file-level spacing stands), blosc/zstd OME-Zarr chunks,
OME-TIFF, detached .nhdr.

Heavy paths (surface extraction) run in a real Web Worker with transferables
(`ui/extract.worker.js`) and main-thread fallback; parsers are pure functions
usable in workers but currently called on the main thread in tests.

## Patient geometry (`volume-core/geometry.ts`, `app/lib/orient.ts`)

A volume whose file says where it is (NIfTI qform/sform, DICOM IOP/IPP)
carries `geometry` (LPS origin, spacing, direction) and is re-laid out once
at load into LPS storage: +i patient Left, +j Posterior, +k Superior. The
render and editor code maps voxel axes to the screen without knowing
anatomy, and in LPS storage that mapping is radiological (axial: patient
right on screen left, anterior up; coronal/sagittal drawn superior-up). The
re-layout is a permutation + flips, so `source` keeps the file's own grid and
exports invert it exactly. No geometry → stored as-is, no edge letters, an
"orientation unknown" caution on the image.

Panes draw through `views/paneView.ts`: the canvas is the pane's pixels, the
slice is fitted in millimetres (true aspect for anisotropic voxels), and the
same mapping inverts every tap; what a pane draws over the image (crosshair,
edge letters, scale bar, measurements) is `views/paneChrome.ts`. The 3D
surface, fibres and cursor are drawn in mm (`app/lib/physical3d.ts`), and the
volume raycaster marches in mm (`renderVolume`'s `spacing`), so both 3D modes
frame the same physical box.

## Render (`packages/render-cpu`)

- MPR: reslice → `ImageData` → `Canvas2D.putImageData`, window/level LUT.
- MIP: thick-slab axial/coronal/sagittal (`slab.ts`: mip/minip/mean) +
  rotating oblique MIP (`mip-rotate.ts`: same orbit/tilt as the raycaster).
- 3D surfaces: surface nets (smooth, the default: vertices on the
  voxel-centre convention, projected onto each cell's trilinear surface; a
  binary mask's relaxed inside its cells instead, `maskNets`) +
  cuberille boundary faces (blocky, an option), orthographic + Lambert +
  z-buffer rasterizer → RGBA. The image and the mask keep separate
  thresholds (`session.thresholds`).
- Surface accuracy is measured, not eyeballed: analytic phantoms (sphere,
  ellipsoid, torus; `test/phantoms.ts`) sampled on isotropic and thick-slice
  grids score every extraction path in mm — vertex distance to the true
  surface, volume, normal deviation (`test/accuracy.test.ts`).
- Export: binary STL from any TriMesh (re-parse verified).
- Volume raycast: orthographic front-to-back CPU compositing (`vr.ts`). Rays
  march in mm and sample in voxels; the step is in voxels of the finest axis,
  and unit spacing is bit-identical to the old voxel-space renderer.
- NOT built: WASM marching-cubes (CPU cuberille + surface nets cover it).
- Proteins: project spheres/sticks on CPU, paint pLDDT / chain (proven to 5.4k atoms; `.pdb` + `.cif` open).
- Cells: tile pyramid + channel composite on CPU.

No WebGL import in v1. GPU is a future layer, not a fallback.

## Editor (`packages/editor-seg` + `packages/measure`)

Port from Cornerstone tools + CACTAS brush + ITK-Wasm filters:
threshold → region-grow → connected-components → fill-hole, plus brush
paint/erase (Bresenham pen), flood fill, RLE undo stack, and a
marker-free watershed split (Manhattan EDT + top-down flood; shape necks
only, never adds voxels).
Every op = pure function, undoable, testable without UI.

## Design system (`packages/app/src/styles` + `src/ui`)

Tailwind v4 supplies utilities and the `@theme` token store; Radix backs the
components whose hand-rolled versions were behaviourally wrong (popover:
outside-click + Escape + focus restore; tooltip). Sliders stay native
`<input type="range">` on purpose — the wire suite drives them with real key
events and reads `.inputValue()`.

```
styles/tokens.css      color / type / rhythm / rounding — the only literals
styles/base.css        reset, document chrome, focus, scrollbars
styles/components.css  shared classes every view uses
styles/shell.css       rail, topbar, main grid, inspector, status
styles/viewport.css    viewport grid + the 3D-tool treatment
styles/responsive.css  desktop >1280 / tablet 981–1280 / mobile ≤980
```

Layout has three real modes, not one squeezed twice: desktop pairs an icon
rail with the viewport grid and the inspector column; tablet drops the
inspector under the stage; mobile gives the top half to imaging and the
bottom half to a permanent control deck, so tools never cover the image they
act on. 980px is the mobile edge and is the twin of `lib/isMobile.ts` (§21).

The chrome is built to read as an instrument rather than a web page:

- **Scrub fields, not slider rows.** `SliderRow` renders a compact rectangle
  carrying its own label, a proportional fill and a right-aligned value,
  dragged horizontally. It is still a native `<input type="range">` layered
  at full size over the fill — the wire suite focuses these, sends real arrow
  keys and reads `.inputValue()`, so a div-based slider would break it.
- **A tool column, not a wrapping toolbar.** `#dock-mpr` renders in `column`
  mode against the viewport edge on desktop, and flat inside the mobile
  control deck. One dock, two layouts — `#undogrp` has to stay inside
  `#dock-mpr` and `#modeseg` inside `#mpanel-tools`, which e2e addresses.
- **Density scales by pointer, not breakpoint.** `--ctl-h` is 26px under a
  mouse and 44px under a finger, so instrument tightness and the §22 touch
  floor come from one variable instead of fighting.
- **Rounding stays proportional but tight** (3→19px). Pills are reserved for
  status dots and notifications; a pill-shaped control reads as a web page.

The viewport borrows the look of a three.js/Blender-class viewport — graded
stage, floor grid, corner brackets, orientation axis gizmo — but every pixel
of imagery is still CPU-rasterised into a 2D canvas. The gizmo is SVG chrome
that reflects orbit/tilt and is operable (clicking an axis snaps the camera),
but it renders no imagery. No WebGL context is created and no `three` import
exists, and `verify.test.ts` enforces both. Anatomical edge letters stay on
the canvas (`lib/orient.ts edgeLabels`, drawn by `views/paneChrome.ts`) — the DOM HUD draws
framing only, so there is one implementation, not two (§4). They come from
the volume's patient geometry, not a DICOM tag, so NIfTI gets them too.

## UI (`packages/ui`, static, serve repo root)

- `slice.html` — MPR 3-view + seg overlay + paint/erase + undo + PNG/.nii export.
- `surface.html` — orbit/tilt/threshold + blocky/smooth + `.nii` mask upload.
- `viewer-lib.js` — shared loaders (NIfTI pixdims, DICOM spacing+z-gap).
- `extract.worker.js` — extraction worker, transferables, main-thread fallback.
- `index.html` — the product shell (MPR + 3D + inspector + palette).
- `slice.html` / `surface.html` — kept as focused single-purpose pages AND a
  duplication canary: logic must live in `viewer-lib.js`, pages stay thin.
  If a fix lands in one page but not the others, that is the debt signal.

## Serving (`Dockerfile` + `deploy/nginx.conf`)

- The production image is nginx serving three trees: the Vite bundle
  (`/packages/app/dist/`), `digests/` (fetched at runtime by Atlas, Learn and
  the pathogen structures) and the read-only `samples/` mount. `/` is a 302
  to the app; `/healthz` answers from nginx itself. The per-package tsc builds
  and the legacy `packages/ui` shell are dev-only.
- Only the viewer is in the entry chunk. The other seven routes are
  `React.lazy` chunks behind `ui/RouteSuspense`, whose error boundary turns a
  chunk that 404s after a redeploy into a "reload" card instead of a blank
  shell. React and Radix sit in their own chunks so their hashes survive app
  releases.
- Cache policy follows naming: hashed `assets/` are immutable for a year,
  everything unhashed revalidates, `samples/` is private and short-lived.
- The CSP is `'self'` for script, style, font and worker — no inline, no
  eval, no blob workers — and fonts are bundled, so no request leaves the
  origin except the stores a user types in (`connect-src https:`). A change
  that needs more than that must change `deploy/nginx.conf` in the same
  commit; `npm run test:image` (CI, image job) fails on any CSP violation.
