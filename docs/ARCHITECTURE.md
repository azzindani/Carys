# Architecture

Carys is a TypeScript monorepo. Pure engine packages parse, model, render and
edit on the CPU. A React app composes them into the product, and nginx serves
the result as static files. It has no GPU path and no server-side code.

```
files / URLs ──▶ io ──▶ volume-core model ──▶ render-cpu ──▶ Canvas2D
                             ▲       │
            editor-seg, measure      └──▶ study (worklist, report, provenance)
                             ▲
                            app (React: routes, docks, workers)
```

## Packages

| Package | Role |
|---|---|
| `volume-core` | The shared model: volumes, patient geometry, selections, annotations, undo history, structures and sequences, tracks, atlases, caches. Pure, with no DOM. |
| `io` | Readers and writers: DICOM (series, codecs, SEG, RTSTRUCT, DICOMDIR), NIfTI, NRRD, OME-TIFF, OME-Zarr, PDB/mmCIF, FASTA, VCF, BED, GFF/GTF. Pure: bytes in, typed data out. |
| `render-cpu` | Reslicing, MIP, surface extraction, the rasterizer, the volume raycaster, picking, clipping, curved reformat, meshes and tracts, and the whole-body scene. |
| `editor-seg` | Segmentation: threshold, region grow, connected components, fill holes, brush and flood fill, watershed split, multi-label masks. |
| `measure` | Length, angle, ellipse and rectangle ROIs, RECIST, TID 1500 import and export, radiomics CSV import. |
| `study` | Worklist and search, hanging protocols, the report, de-identification, the audit trail, and the data-set provenance registry. |
| `dicomweb` | The DICOMweb client: QIDO-RS search, WADO-RS retrieve, STOW-RS store, and multipart. Transport comes through an injected `fetch`. |
| `app` | The React product: the routes, the shell, the viewer's panes and docks, and the workers. The only package that touches the DOM. |
| `testkit` | Test-only. Locates `samples/` and decides whether a missing fixture skips or fails. |
| `ui` | The legacy static shell, a development page and an e2e fixture. It is not shipped. |

Engine packages never import the DOM (checked by `verify.test.ts`), so every
parser and renderer runs the same in a test, on the main thread or in a
worker.

## Core model (`volume-core`)

```ts
type Volume = { dims:[number,number,number], spacing:[number,number,number],
  origin:[number,number,number],
  dtype:'uint8'|'int8'|'uint16'|'int16'|'uint32'|'int32'|'float32'|'float64',
  data: TypedArray }
type Selection = { kind:'voxel'|'residue'|'cell'|'interval', ids: number[] | Range }
type Annotation = { id:string, label:string, mask?: Uint8Array, meshRef?: string,
  measurements: Record<string,number> }
```

One undo stack owns the annotations, and views never own state: they project
the model. Voxels, residues and cells share the same annotation model, so
the same undo, export and linking work across the Viewer, Protein and Cells
routes.

## Readers (`io`)

| Module | In | Out | Notes |
|---|---|---|---|
| `dicom-parse.ts` | One `.dcm` file | Slice plus metadata | Implicit and explicit VR (both endians), deflated, RLE, JPEG Baseline 8-bit, JPEG Lossless (SOF3), JPEG-LS lossless. Multi-frame split. Enhanced functional groups give per-frame position, orientation and spacing. |
| `dicom-stack.ts` | Parsed slices | Stacks | Groups by series, matrix, orientation and spacing. Orders by position along the normal. Even repeats become phases. Warns on gaps, tilt and dropped repeats. |
| `dicom.ts`, `dicom-series.ts` | A series | `Volume` | Sorting and stacking along the scan normal |
| `seg.ts`, `rtstruct.ts`, `dicomdir.ts` | DICOM SEG, RTSTRUCT, DICOMDIR | Masks, contours, a study tree | |
| `nifti1.ts`, `nifti-gzip.ts` | `.nii`, `.nii.gz` | Header plus image | All eight data types, qform and sform |
| `nifti-write.ts` | `Volume` plus affine | `.nii` bytes | Writes the affine as both sform and qform, so a mask round-trips onto its source grid |
| `nrrd.ts` | `.nrrd` | `Volume` | Raw, ASCII and gzip encodings, all eight types, both endians |
| `ome-tiff.ts` | `.ome.tif` | Planes | Strips or tiles. Raw, deflate, LZW or JPEG. 8- and 16-bit, both endians. |
| `omezarr.ts`, `ome-plate.ts` | An OME-Zarr store (URL) | Chunked `Volume`, plate wells | An LRU chunk cache over raw and gzip chunks. OME-NGFF 0.4 plates. |
| `pdb.ts`, `cif.ts` | `.pdb`, `.cif` | Atoms and residues | The two readers agree on the same entry (tested) |
| `genome.ts`, `seq.ts` | BED, GFF/GTF, FASTA, VCF | Features and tracks | |

Not supported, and each case is refused with a named error:

- other encapsulated DICOM syntaxes: JPEG 2000, JPEG-LS near-lossless,
  hierarchical and progressive JPEG, 12-bit baseline;
- blosc- or zstd-compressed Zarr chunks;
- detached `.nhdr` NRRD and inline NRRD data.

Every decoder turns hostile input into a named error. `corrupt.test.ts`
covers every format.

## Patient geometry (`volume-core/geometry.ts`, `app/lib/orient.ts`)

A volume whose file records its position carries `geometry`: LPS origin,
spacing and direction, from NIfTI qform/sform or DICOM orientation and
position. At load, such a volume is re-laid out once into LPS storage,
where +i is patient Left, +j Posterior and +k Superior.

- **Rendering.** The render and editor code maps voxel axes to the screen
  without knowing anatomy. In LPS storage that mapping is radiological:
  axial with patient right on screen left and anterior up, coronal and
  sagittal drawn superior-up.
- **Export.** The re-layout is a permutation plus flips, so `source` keeps
  the file's own grid and exports invert it exactly.
- **No geometry.** The volume is stored as-is, with no edge letters and an
  "orientation unknown" caution on the image.

Panes draw through `views/paneView.ts`. The canvas is the pane's pixels, and
the slice is fitted in millimetres, so anisotropic voxels keep their true
aspect. The same mapping inverts every tap. What a pane draws over the image
comes from `views/paneChrome.ts`: the crosshair, edge letters, scale bar and
measurements.

The mask keeps its labels, whether from a catalog label map, a SEG import or
multi-label editing. Each pane:

1. takes its slice's labels (`render-cpu/labels.ts`: orthogonal, slab or
   oblique);
2. tints each label its own colour (`lib/palette.ts`);
3. in the default Outline look, draws each label's voxel-edge outline just
   inside the label (`views/paneLabels.ts`).

The 3D surface, fibres and cursor are drawn in millimetres
(`app/lib/physical3d.ts`), and the raycaster marches in millimetres, so both
3D modes frame the same physical box.

## Rendering (`render-cpu`)

Everything is rasterised on the CPU into a 2D canvas. No WebGL context is
created and no three.js import exists: `verify.test.ts` enforces both.

- **Reformats.** Reslice to `ImageData`, then a window/level LUT.
  - Thick-slab MIP, minIP and mean (`slab.ts`).
  - A rotating oblique MIP (`mip-rotate.ts`) on the same orbit as the
    raycaster.
  - A curved reformat (`cpr.ts`): the Curve tool's points become a
    centripetal Catmull-Rom spline in millimetres. The straightened view is
    millimetre-true both ways and maps any pixel back to its voxel.
- **Surfaces.**
  - **Extraction.** Surface nets is the default. Vertices sit on the
    voxel-centre convention and are projected onto each cell's trilinear
    surface. A binary mask is relaxed inside its cells instead, and
    thick-slice grids are interpolated between slices first
    (`thick-slices.ts`). Cuberille faces are a blocky option.
  - **Smoothing** (`mesh-smooth.ts`) is optional: windowed-sinc filtering,
    with each closed piece restored to its original volume.
  - **Level of detail** (`decimate.ts`): quadric-error decimation bounded in
    millimetres. A surface over 100k triangles gets an orbit level built on
    a worker.
  - **Rasterizing.** An orthographic z-buffer, lit per pixel (interpolated
    normals, Blinn-Phong) and 2× supersampled once the view settles.
  - **Depth cues** (`screen-space.ts`) are an opt-in post-pass: ambient
    occlusion and silhouette outlines.
  - **See-through layers.** Opaque triangles draw first. See-through
    triangles then draw their front faces into weighted blended
    order-independent transparency (McGuire & Bavoil 2013).
- **Volume rendering** (`vr.ts`). Orthographic front-to-back compositing,
  with rays marched in millimetres and opacity corrected to a reference
  step.
  - Empty 8³ bricks are skipped.
  - Each frame is a jittered progressive pass. The view shows pass 1 at
    once and refines to 4 while it stays still.
  - The app splits a frame's rows across a worker pool, and each worker
    keeps the field between passes.
  - Cinematic lighting (`vr-light.ts`): soft shadows and ambient light
    propagated through a coarse extinction grid.
- **Picking** (`pick.ts`): the point under a pixel, taken from the
  renderer's own frame. For a surface it is the nearest drawn triangle; for
  a volume, the depth where the ray turns half opaque. A tap in 3D moves the
  panes there.
- **Clipping** (`clip.ts`): a crop box and a plane forming one convex
  region. It is honoured by the rasterizer, the raycaster, the lighting and
  both picks.
- **Accuracy is measured, not eyeballed.** Analytic phantoms (a sphere, an
  ellipsoid, a torus) on isotropic and thick-slice grids score every
  extraction path in millimetres: vertex distance, volume and normal
  deviation (`test/accuracy.test.ts`).
- **Meshes, tracts and export.** STL, MZ3 and GIFTI meshes; TCK, TRK and
  TRX tracts with fibre projection; binary STL export.
- **Proteins and capsids.** Proteins are drawn as spheres and sticks,
  coloured by chain or pLDDT. Capsids go through `spheres.ts`: a z-buffer
  that keeps the winning sphere per pixel, shaded once per pixel, with its
  id buffer serving as the pick. `volume-core/assembly.ts` expands a
  biological assembly from its mmCIF operators, as atoms, a bead per
  residue or a bead per chain.
- **Cells.** A tile pyramid with the channels composited on the CPU.

### The whole-body atlas

- **Package** (`body-pack.ts`). The BodyParts3D meshes are stored as one
  `carys-body/1` file per body system: u16 positions on the body's grid,
  u16/u32 indices, and a JSON header of parts giving each part's FMA id,
  name, system and measured error. An `index.json` lists every part, so a
  structure can be found before its system file is fetched.
- **Scene** (`body-scene.ts`). The shown parts are merged into one mesh
  that knows each triangle's part, so a tap names the part. A
  vertex-clustered copy draws moving frames. Clusters are split by part and
  by normal octant, so a thin shell's two sheets never merge.
- **Rig and motion.**
  - `rig.ts` joins rigid bones at fitted centres and poses each joint by
    flexion, abduction and twist. `poseMesh` moves bones rigidly and blends
    everything else by skin weights.
  - `bvh.ts` reads BVH and retargets it onto the rig. `gait.ts` grounds the
    feet and measures foot slip.
  - Muscles can be coloured by stretch.
- **Other bodies' organs.**
  - `glb.ts` reads glTF binary meshes.
  - `organ-fit.ts` fits the HuBMAP reference organs into the body with
    anchors shared by both bodies: Horn's closed-form similarity, then ICP.
  - `organ-warp.ts` adds a bend: regularised non-rigid steps built from
    Wendland's compactly supported functions, with each step's gradient
    capped so it cannot fold.

## Editing (`editor-seg`, `measure`)

Segmentation operations include:

- threshold, region grow, connected components and fill holes;
- brush paint and erase, and flood fill;
- a marker-free watershed split, which only cuts shape necks and never adds
  voxels;
- filling between painted slices (`render-cpu/slice-fill.ts`): exact 2D
  distance maps interpolated by a cubic across the painted slices, per
  label.

Every operation is a pure function, undoable, and testable without a UI. The
mask's undo stack holds states: the loaded one, then a snapshot after every
edit (a stroke, an operation, a clear, an import).

Measurements are also pure: lengths, angles, ellipse and rectangle ROI
statistics, Cobb angle, RECIST and TID 1500.

## The app (`packages/app`)

- **Routes.** `App.tsx` routes between Studies, Viewer, Report, Protein,
  Cells, Tracks, Atlas and Learn.
  - Only the viewer is in the entry chunk. The other routes are
    `React.lazy` chunks behind `ui/RouteSuspense`, whose error boundary
    turns a chunk that 404s after a redeploy into a "reload" card.
  - React and Radix sit in their own chunks, so their hashes survive app
    releases.
- **Loading.** The viewer boots with NIfTI only (`lib/loaders.ts`). DICOM,
  NRRD, OME-TIFF, SEG/RTSTRUCT and the PACS client load on first use,
  reached only through `import()`.
  - Rollup assigns chunks by module. A boot-path file that needs a format
    sniffer or a SOP constant therefore imports it from an io module that
    holds nothing else (`io/sniff.ts`, `sop-names.ts`, `us-names.ts`).
  - `npm run check:entry` fails when the entry exceeds its byte budget or
    contains a decoder's string literal.
- **State.** One `UiState` store (`lib/store.ts`). Components subscribe to
  it, and canvases paint imperatively from the same state.
  - Appearance preferences persist to `localStorage`; view and session
    state do not.
  - Stale asynchronous results are dropped by token (`paintToken`,
    `vrToken`).
- **Workers.**
  - `workers/extract.ts` runs surfaces, level of detail and volume-render
    rows, through the pool in `lib/extractor.ts`.
  - `workers/parse.ts` decodes uploads, through `lib/parseClient.ts`.
  - Both are module workers emitted as files, not `blob:` URLs, so the CSP
    can stay `worker-src 'self'`.
- **Display tools.** The viewer's display tools sit behind pop-outs in its
  bar (`ui/PopOut.tsx`): Display, Reformat, Compare, Time, Segment, 3D and
  Export.
  - Only one pop-out is open at a time. Escape or a press outside closes
    it.
  - A closed panel stays mounted but hidden, so its readouts keep their
    values.

### Design system (`src/styles`, `src/ui`)

Tailwind v4 supplies utilities and the `@theme` token store. Radix backs the
popover and tooltip, whose hand-rolled versions got outside-click, Escape
and focus restore wrong. Sliders stay native `<input type="range">`, so
keyboard and assistive technology work unchanged.

```
styles/tokens.css      colour, type, rhythm and rounding: the only literals
styles/base.css        reset, document chrome, focus, scrollbars
styles/components.css  shared classes every view uses
styles/shell.css       rail, top bar, main grid, inspector, status
styles/viewport.css    viewport grid and the 3D-tool treatment
styles/responsive.css  desktop >1280 / tablet 981–1280 / mobile ≤980
```

The layout has three real modes:

- **Desktop** pairs an icon rail with the viewport grid and the inspector
  column.
- **Tablet** moves the inspector under the stage.
- **Mobile** gives the top half to imaging and the bottom half to a
  permanent control deck, so tools never cover the image they act on.

980px is the mobile edge, shared with `lib/isMobile.ts`. Control height is
26px under a mouse and 44px under a finger, set by one variable, so the
touch-target floor and desktop density do not fight.

The viewport borrows a 3D tool's look: a graded stage, a floor grid, corner
brackets and an orientation gizmo. Every pixel of imagery is still
CPU-rasterised. The gizmo is SVG chrome that reflects the orbit and snaps
the camera when an axis is clicked. The anatomical edge letters are drawn on
the canvas from the volume's patient geometry, so NIfTI gets them too.

## Serving (`Dockerfile`, `deploy/`)

The image is nginx serving three trees from one origin:

- the Vite bundle, at `/packages/app/dist/`;
- `digests/`, the data sets the app fetches at runtime;
- the read-only `samples/` mount.

Beyond that:

- `/` redirects to the app, and `/healthz` answers from nginx itself.
- Cache policy follows naming:
  - hashed assets are immutable for a year;
  - everything unhashed revalidates;
  - `samples/` is private and short-lived.
- The CSP is `'self'` for scripts, styles, fonts and workers, with nothing
  inline, no `eval` and no `blob:` workers. Fonts are bundled. No request
  leaves the origin except to the stores a user types in (`connect-src`).
- A change that needs a wider policy must change `deploy/nginx.conf` in the
  same commit. `npm run test:image` fails on any CSP violation.

[DEPLOYMENT.md](DEPLOYMENT.md) covers running it, and
[SECURITY.md](SECURITY.md) covers the headers and the access gate.
