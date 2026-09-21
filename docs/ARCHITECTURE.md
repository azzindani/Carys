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
| `dicom.ts` | `.dcm` slices | `Volume` (sort+stack) | `readImageDicomFileSeries` blocks-of-8, scan-normal sort | proven, 5 series |
| `dicom-parse.ts` | single `.dcm` bytes | `DicomSlice` + meta | Daikon Parser/Series/Image + RLE + JPEG-baseline + JPEG-lossless + deflated-TS + multi-frame split + Enhanced functional groups (52009229/52009230 → per-frame IPP/IOP/DIV) | proven, 27 files + codec/enhanced tests |
| `nifti1.ts` | plain `.nii` | header + image bytes | NIFTI-Reader-JS, all 8 dtypes | proven, 30 files |
| `nifti-write.ts` | `Volume` | `.nii` bytes | inverse of reader, METHOD 0 affine | proven, round-trip |
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

## Render (`packages/render-cpu`)

- MPR: reslice → `ImageData` → `Canvas2D.putImageData`, window/level LUT.
- MIP: thick-slab axial/coronal/sagittal (`slab.ts`: mip/minip/mean) +
  rotating oblique MIP (`mip-rotate.ts`: same orbit/tilt as the raycaster).
- 3D surfaces: cuberille boundary faces (blocky) + naive surface nets (smooth),
  orthographic + Lambert + z-buffer rasterizer → RGBA.
- Export: binary STL from any TriMesh (re-parse verified).
- Volume raycast: orthographic front-to-back CPU compositing (`vr.ts`).
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

The viewport borrows the look of a three.js/Blender-class viewport — graded
stage, floor grid, corner brackets, orientation axis gizmo — but every pixel
of imagery is still CPU-rasterised into a 2D canvas. The gizmo is SVG chrome
that reflects orbit/tilt; it renders nothing. No WebGL context is created and
no `three` import exists, and `verify.test.ts` enforces both. Anatomical edge
letters stay on the canvas via `iopEdgeLabels` — the DOM HUD draws framing
only, so there is one implementation, not two (§4).

## UI (`packages/ui`, static, serve repo root)

- `slice.html` — MPR 3-view + seg overlay + paint/erase + undo + PNG/.nii export.
- `surface.html` — orbit/tilt/threshold + blocky/smooth + `.nii` mask upload.
- `viewer-lib.js` — shared loaders (NIfTI pixdims, DICOM spacing+z-gap).
- `extract.worker.js` — extraction worker, transferables, main-thread fallback.
- `index.html` — the product shell (MPR + 3D + inspector + palette).
- `slice.html` / `surface.html` — kept as focused single-purpose pages AND a
  duplication canary: logic must live in `viewer-lib.js`, pages stay thin.
  If a fix lands in one page but not the others, that is the debt signal.
